// GET /api/admin/statistics —— 扫码统计（PRD 5.10：总量/趋势/产品/地区/时间分布/明细）
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const isPlatform = user.role === 'platform_admin'
  const fid = user.enterprise_id
  const fidSql = isPlatform ? '' : ' AND s.enterprise_id = ?'
  const fidParams = isPlatform ? [] : [fid]

  // 总量与今日
  const [totalRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM scan_log s WHERE 1=1' + fidSql, fidParams)
  const [todayRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM scan_log s WHERE DATE(s.scan_time) = CURDATE()' + fidSql, fidParams)

  // 近 30 天趋势
  const trendRows = await query<any[]>(
    `SELECT DATE(s.scan_time) AS d, COUNT(*) AS c FROM scan_log s
     WHERE s.scan_time >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)` + fidSql +
    ' GROUP BY DATE(s.scan_time) ORDER BY d', fidParams)

  // 产品分布 Top 10
  const productRows = await query<any[]>(
    `SELECT p.name AS name, COUNT(*) AS c FROM scan_log s
     LEFT JOIN product p ON s.product_id = p.id
     WHERE 1=1` + fidSql + ' GROUP BY s.product_id, p.name ORDER BY c DESC LIMIT 10', fidParams)

  // 地区分布 Top 10（省）
  const regionRows = await query<any[]>(
    `SELECT s.province AS name, COUNT(*) AS c FROM scan_log s
     WHERE s.province <> ''` + fidSql + ' GROUP BY s.province ORDER BY c DESC LIMIT 10', fidParams)

  // 时间分布（24 小时）
  const hourRows = await query<any[]>(
    'SELECT HOUR(s.scan_time) AS h, COUNT(*) AS c FROM scan_log s WHERE 1=1' + fidSql + ' GROUP BY HOUR(s.scan_time) ORDER BY h', fidParams)

  // 扫码明细（分页 + 筛选）
  const conds: string[] = []
  const params: any[] = []
  if (!isPlatform) { conds.push('s.enterprise_id = ?'); params.push(fid) }
  if (q.keyword) {
    const kw = '%' + String(q.keyword).trim() + '%'
    conds.push('(s.code LIKE ? OR p.name LIKE ?)'); params.push(kw, kw)
  }
  if (q.province) { conds.push('s.province = ?'); params.push(String(q.province)) }
  if (q.dateFrom) { conds.push('s.scan_time >= ?'); params.push(String(q.dateFrom) + ' 00:00:00') }
  if (q.dateTo) { conds.push('s.scan_time <= ?'); params.push(String(q.dateTo) + ' 23:59:59') }
  const whereSql = conds.length ? 'WHERE ' + conds.join(' AND ') : ''

  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '20'))))
  const offset = (page - 1) * pageSize

  const [cntRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM scan_log s LEFT JOIN product p ON s.product_id = p.id ' + whereSql, params)
  const detailRows = await query<any[]>(
    `SELECT s.id, s.code, s.scan_time, s.province, s.city, s.shop_name, s.price, s.scan_device, s.scan_subject, s.ip_location,
       p.name AS product_name
     FROM scan_log s LEFT JOIN product p ON s.product_id = p.id ` + whereSql +
    ' ORDER BY s.id DESC LIMIT ? OFFSET ?', [...params, pageSize, offset])

  return {
    totalScans: Number(totalRow?.c || 0),
    todayScans: Number(todayRow?.c || 0),
    trend: trendRows.map(r => ({ date: String(r.d), count: Number(r.c) })),
    productDist: productRows.map(r => ({ name: r.name || '未绑定产品', count: Number(r.c) })),
    regionDist: regionRows.map(r => ({ name: r.name, count: Number(r.c) })),
    hourDist: hourRows.map(r => ({ hour: Number(r.h), count: Number(r.c) })),
    detail: {
      total: Number(cntRow?.c || 0),
      page, pageSize,
      rows: detailRows.map(r => ({
        ...r,
        scan_subject: Number(r.scan_subject) === 2 ? '监管' : Number(r.scan_subject) === 3 ? '内部盘点' : '消费者',
      })),
    },
  }
})
