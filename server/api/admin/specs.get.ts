// GET /api/admin/specs —— 产品规格列表（PRD 5.3：分页/筛选）
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'
import { normalizeOrgName } from '../../utils/regdata'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const conds: string[] = []
  const params: any[] = []
  // 只为有权编辑的产品回显其原绑定规格（旧数据可能由总部绑定过外厂规格）。
  let boundSpecId: number | null = null
  if (q.id && q.productId) {
    const [product] = await query<any[]>('SELECT spec_id FROM product WHERE id = ?' + (user.role !== 'platform_admin' ? ' AND enterprise_id = ?' : ''), user.role !== 'platform_admin' ? [Number(q.productId), user.enterprise_id] : [Number(q.productId)])
    if (product && Number(product.spec_id) === Number(q.id)) boundSpecId = Number(product.spec_id)
  }

  if (user.role !== 'platform_admin') {
    conds.push(boundSpecId ? '(s.enterprise_id = ? OR s.id = ?)' : 's.enterprise_id = ?'); params.push(user.enterprise_id)
    if (boundSpecId) params.push(boundSpecId)
  } else if (q.company) {
    const enterprises = await query<any[]>('SELECT id, name FROM enterprise WHERE status = 1')
    const company = normalizeOrgName(String(q.company))
    const ids = enterprises.filter(row => normalizeOrgName(String(row.name)) === company).map(row => row.id)
    if (ids.length) { conds.push('s.enterprise_id IN (?)'); params.push(ids) }
    else conds.push('1 = 0')
  } else if (q.enterpriseId) {
    const enterpriseId = Number(q.enterpriseId)
    if (!Number.isSafeInteger(enterpriseId) || enterpriseId <= 0) throw createError({ statusCode: 400, statusMessage: '无效的厂家ID' })
    conds.push(boundSpecId ? '(s.enterprise_id = ? OR s.id = ?)' : 's.enterprise_id = ?'); params.push(enterpriseId)
    if (boundSpecId) params.push(boundSpecId)
  }
  if (q.id) { conds.push('s.id = ?'); params.push(Number(q.id)) }
  if (q.keyword) {
    const kw = '%' + String(q.keyword).trim().slice(0, 64) + '%'
    conds.push('(s.spec_name LIKE ? OR s.spec_code LIKE ?)'); params.push(kw, kw)
  }
  if (q.contentUnit) { conds.push('s.content_unit = ?'); params.push(String(q.contentUnit)) }
  if (q.packUnit) { conds.push('s.pack_unit = ?'); params.push(String(q.packUnit)) }
  if (q.status !== undefined && q.status !== '') { conds.push('s.status = ?'); params.push(Number(q.status)) }

  const whereSql = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '20'))))
  const offset = (page - 1) * pageSize

  const [cntRow] = await query<any[]>('SELECT COUNT(*) AS c FROM product_spec s ' + whereSql, params)
  const rows = await query<any[]>(
    `SELECT s.*, e.name AS enterprise_name,
       (SELECT COUNT(*) FROM product p WHERE p.spec_id = s.id) AS ref_count
     FROM product_spec s LEFT JOIN enterprise e ON s.enterprise_id = e.id ` + whereSql +
    ' ORDER BY s.id DESC LIMIT ? OFFSET ?', [...params, pageSize, offset])

  return {
    total: Number(cntRow?.c || 0),
    page, pageSize,
    rows,
  }
})
