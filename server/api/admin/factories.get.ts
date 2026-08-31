// GET /api/admin/factories —— 企业列表（系统设置·用户管理选企业用）
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  if (user.role !== 'platform_admin') {
    throw createError({ statusCode: 403, statusMessage: '需要总部管理员权限' })
  }
  const q = getQuery(event)
  const conds: string[] = []
  const params: any[] = []
  if (q.keyword) {
    const kw = '%' + String(q.keyword).trim() + '%'
    conds.push('(name LIKE ? OR contact LIKE ?)'); params.push(kw, kw)
  }
  if (q.status !== undefined && q.status !== '') { conds.push('status = ?'); params.push(Number(q.status)) }
  const whereSql = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '20'))))
  const offset = (page - 1) * pageSize

  const [cntRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM enterprise ' + whereSql, params)
  const rows = await query<any[]>(
    `SELECT e.*, (SELECT COUNT(*) FROM \`user\` u WHERE u.enterprise_id = e.id) AS user_count
     FROM enterprise e ` + whereSql + ' ORDER BY e.id DESC LIMIT ? OFFSET ?', [...params, pageSize, offset])
  return { total: Number(cntRow?.c || 0), page, pageSize, rows }
})
