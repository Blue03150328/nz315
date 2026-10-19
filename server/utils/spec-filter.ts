import { query } from './db'
import { normalizeOrgName } from './regdata'
import type { AuthUser } from './auth'

/** 列表与导出共用筛选；绑定回显例外只由列表传入，导出始终保持企业边界。 */
export async function specFilters(user: AuthUser, q: Record<string, any>, boundSpecId: number | null = null) {
  const conds: string[] = [], params: any[] = []
  if (user.role !== 'platform_admin') {
    conds.push(boundSpecId ? '(s.enterprise_id = ? OR s.id = ?)' : 's.enterprise_id = ?'); params.push(user.enterprise_id)
    if (boundSpecId) params.push(boundSpecId)
  } else if (q.company) {
    const enterprises = await query<any[]>('SELECT id, name FROM enterprise WHERE status = 1')
    const company = normalizeOrgName(String(q.company))
    const ids = enterprises.filter(row => normalizeOrgName(String(row.name)) === company).map(row => row.id)
    if (ids.length) { conds.push('s.enterprise_id IN (?)'); params.push(ids) } else conds.push('1 = 0')
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
  return { whereSql: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params }
}
