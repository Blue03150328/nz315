// GET /api/admin/specs —— 产品规格列表（PRD 5.3：分页/筛选）
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'
import { specFilters } from '../../utils/spec-filter'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  // 只为有权编辑的产品回显其原绑定规格（旧数据可能由总部绑定过外厂规格）。
  let boundSpecId: number | null = null
  if (q.id && q.productId) {
    const [product] = await query<any[]>('SELECT spec_id FROM product WHERE id = ?' + (user.role !== 'platform_admin' ? ' AND enterprise_id = ?' : ''), user.role !== 'platform_admin' ? [Number(q.productId), user.enterprise_id] : [Number(q.productId)])
    if (product && Number(product.spec_id) === Number(q.id)) boundSpecId = Number(product.spec_id)
  }

  const { whereSql, params } = await specFilters(user, q, boundSpecId)
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
