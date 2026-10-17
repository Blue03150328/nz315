import type { AuthUser } from './auth'

/** 产品列表与批量导出保持相同搜索范围和企业边界。 */
export function productFilters(user: AuthUser, q: Record<string, any>) {
  const conds: string[] = [], params: any[] = []
  if (user.role !== 'platform_admin') {
    conds.push('p.enterprise_id = ?'); params.push(user.enterprise_id)
  } else if (q.enterpriseId !== undefined && q.enterpriseId !== '') {
    const enterpriseId = Number(q.enterpriseId)
    if (!Number.isSafeInteger(enterpriseId) || enterpriseId <= 0) throw createError({ statusCode: 400, statusMessage: '企业筛选无效' })
    conds.push('p.enterprise_id = ?'); params.push(enterpriseId)
  }
  if (q.keyword) {
    const kw = '%' + String(q.keyword).trim().slice(0, 64) + '%'
    conds.push('(p.name LIKE ? OR p.trademark LIKE ? OR p.registration_no LIKE ? OR s.spec_name LIKE ? OR s.spec_code LIKE ?)'); params.push(kw, kw, kw, kw, kw)
  }
  if (q.category) { conds.push('p.category = ?'); params.push(String(q.category)) }
  if (q.status !== undefined && q.status !== '') { conds.push('p.status = ?'); params.push(Number(q.status)) }
  if (q.specId) { conds.push('p.spec_id = ?'); params.push(Number(q.specId)) }
  if (q.productId !== undefined) {
    const id = Number(q.productId)
    if (!Number.isSafeInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '产品编号无效' })
    conds.push('p.id = ?'); params.push(id)
  }
  return { whereSql: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params }
}
