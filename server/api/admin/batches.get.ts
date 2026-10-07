// GET /api/admin/batches —— 生产批号列表（PRD 5.6）
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const conds: string[] = []
  const params: any[] = []

  if (user.role !== 'platform_admin') {
    conds.push('b.enterprise_id = ?'); params.push(user.enterprise_id)
  }
  if (q.keyword) {
    const kw = '%' + String(q.keyword).trim() + '%'
    conds.push('(b.batch_no LIKE ? OR p.name LIKE ? OR b.quality_cert_no LIKE ?)'); params.push(kw, kw, kw)
  }
  if (q.productId) { conds.push('b.product_id = ?'); params.push(Number(q.productId)) }
  if (q.bindable === '1' || q.bindable === 1) conds.push("b.qc_result = 1 AND b.produce_date IS NOT NULL AND TRIM(COALESCE(b.quality_cert_no, '')) <> ''")

  const whereSql = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '20'))))
  const offset = (page - 1) * pageSize

  const [cntRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM batch b ' + whereSql, params)
  const rows = await query<any[]>(
    `SELECT b.*, p.name AS product_name, p.shelf_life, s.spec_name,
       (SELECT COUNT(*) FROM trace_code t WHERE t.batch_id = b.id) AS code_count
     FROM batch b
     LEFT JOIN product p ON b.product_id = p.id
     LEFT JOIN product_spec s ON p.spec_id = s.id ` + whereSql +
    ' ORDER BY b.id DESC LIMIT ? OFFSET ?', [...params, pageSize, offset])

  // 批号状态（PRD 5.6：待上传/已上传/部分上传/已完成）
  return {
    total: Number(cntRow?.c || 0),
    page, pageSize,
    rows: rows.map(r => {
      const codeCount = Number(r.code_count || 0)
      const quantity = Number(r.quantity || 0)
      let batchStatus = '待上传'
      if (codeCount > 0 && codeCount < quantity) batchStatus = '部分上传'
      else if (codeCount >= quantity && quantity > 0) batchStatus = '已完成'
      else if (codeCount > 0) batchStatus = '已上传'
      return { ...r, batchStatus }
    }),
  }
})
