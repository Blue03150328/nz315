// GET /api/admin/codes —— 码列表查询（PRD 5.5.7：筛选/分页/搜索）
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'

const STATUS_LABEL: Record<number, string> = { 1: '已生成', 2: '已绑定' }
const FLAG_LABEL: Record<number, string> = { 0: '正常', 1: '已冻结', 2: '已作废' }

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const isPlatform = user.role === 'platform_admin'
  const fid = user.enterprise_id

  const conds: string[] = []
  const params: any[] = []
  if (!isPlatform) { conds.push('t.enterprise_id = ?'); params.push(fid) }
  if (q.keyword) {
    const kw = '%' + String(q.keyword).trim().slice(0, 64) + '%'
    conds.push('(t.code LIKE ? OR t.batch_no LIKE ? OR p.name LIKE ?)')
    params.push(kw, kw, kw)
  }
  if (q.status) { conds.push('t.status = ?'); params.push(Number(q.status)) }
  if (q.abnormalFlag !== undefined && q.abnormalFlag !== '') { conds.push('t.abnormal_flag = ?'); params.push(Number(q.abnormalFlag)) }
  if (q.productId) { conds.push('t.product_id = ?'); params.push(Number(q.productId)) }
  if (q.dateFrom) { conds.push('t.created_at >= ?'); params.push(String(q.dateFrom) + ' 00:00:00') }
  if (q.dateTo) { conds.push('t.created_at <= ?'); params.push(String(q.dateTo) + ' 23:59:59') }

  const whereSql = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '20'))))
  const offset = (page - 1) * pageSize

  const [cntRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM trace_code t LEFT JOIN product p ON t.product_id = p.id ' + whereSql, params)
  const rows = await query<any[]>(
    `SELECT t.id, t.code, t.status, t.abnormal_flag, t.abnormal_reason, t.product_id,
       t.produce_date, t.batch_no, t.quality_cert_no, t.outer_box_code, t.created_at, t.bound_at,
       p.name AS product_name
     FROM trace_code t LEFT JOIN product p ON t.product_id = p.id ` + whereSql +
    ' ORDER BY t.id DESC LIMIT ? OFFSET ?', [...params, pageSize, offset])

  return {
    total: Number(cntRow?.c || 0),
    page,
    pageSize,
    rows: rows.map(r => ({
      ...r,
      statusLabel: STATUS_LABEL[Number(r.status)] || '未知',
      flagLabel: FLAG_LABEL[Number(r.abnormal_flag)] || '未知',
    })),
  }
})