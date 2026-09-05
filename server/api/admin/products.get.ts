// GET /api/admin/products —— 产品列表（PRD 5.4：搜索/分页）
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const conds: string[] = []
  const params: any[] = []

  if (user.role !== 'platform_admin') {
    conds.push('p.enterprise_id = ?'); params.push(user.enterprise_id)
  }
  if (q.keyword) {
    const kw = '%' + String(q.keyword).trim().slice(0, 64) + '%'
    conds.push('(p.name LIKE ? OR p.trademark LIKE ? OR p.registration_no LIKE ?)'); params.push(kw, kw, kw)
  }
  if (q.category) { conds.push('p.category = ?'); params.push(String(q.category)) }
  if (q.status !== undefined && q.status !== '') { conds.push('p.status = ?'); params.push(Number(q.status)) }
  if (q.specId) { conds.push('p.spec_id = ?'); params.push(Number(q.specId)) }

  const whereSql = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '20'))))
  const offset = (page - 1) * pageSize

  const [cntRow] = await query<any[]>('SELECT COUNT(*) AS c FROM product p ' + whereSql, params)
  const rows = await query<any[]>(
    `SELECT p.*, s.spec_name, s.spec_code,
       (SELECT COUNT(*) FROM trace_code t WHERE t.product_id = p.id) AS code_count,
       (SELECT IF(COUNT(*) = 0, NULL, JSON_ARRAYAGG(JSON_OBJECT('regNo', o.reg_no, 'company', o.company)))
          FROM product_original o WHERE o.product_id = p.id) AS originals
     FROM product p LEFT JOIN product_spec s ON p.spec_id = s.id ` + whereSql +
    ' ORDER BY p.id DESC LIMIT ? OFFSET ?', [...params, pageSize, offset])

  return {
    total: Number(cntRow?.c || 0),
    page, pageSize,
    rows,
  }
})
