// GET /api/admin/specs —— 产品规格列表（PRD 5.3：分页/筛选）
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const conds: string[] = []
  const params: any[] = []

  if (user.role !== 'platform_admin') {
    conds.push('s.enterprise_id = ?'); params.push(user.enterprise_id)
  }
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
    rows: rows.map(r => ({
      ...r,
      // mysql2 默认已解析 JSON 列（返回数组）；兼容字符串形式做二次解析
      dosage_forms: (() => {
        if (Array.isArray(r.dosage_forms)) return r.dosage_forms
        if (!r.dosage_forms) return []
        try { return JSON.parse(r.dosage_forms) } catch { return [] }
      })(),
    })),
  }
})