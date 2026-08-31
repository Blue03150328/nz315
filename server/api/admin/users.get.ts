// GET /api/admin/users —— 用户列表（PRD 5.12.3：登录名/姓名/手机/角色/最后登录/状态）
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const conds: string[] = []
  const params: any[] = []

  // 权限：platform_admin 全量；enterprise_admin 仅本企业；code_admin 仅查看本企业（只读）
  if (user.role === 'platform_admin') {
    if (q.enterpriseId) { conds.push('u.enterprise_id = ?'); params.push(Number(q.enterpriseId)) }
  } else {
    conds.push('u.enterprise_id = ?'); params.push(user.enterprise_id)
  }
  if (q.keyword) {
    const kw = '%' + String(q.keyword).trim() + '%'
    conds.push('(u.username LIKE ? OR u.name LIKE ? OR u.phone LIKE ?)'); params.push(kw, kw, kw)
  }
  if (q.role) { conds.push('u.role = ?'); params.push(String(q.role)) }
  if (q.status !== undefined && q.status !== '') { conds.push('u.status = ?'); params.push(Number(q.status)) }

  const whereSql = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const page = Math.max(1, parseInt(String(q.page || '1')))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(q.pageSize || '20'))))
  const offset = (page - 1) * pageSize

  const [cntRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM \`user\` u ' + whereSql, params)
  const rows = await query<any[]>(
    `SELECT u.id, u.enterprise_id, u.username, u.name, u.phone, u.role, u.status, u.last_login_at, u.last_login_ip, u.created_at,
       e.name AS enterprise_name
     FROM \`user\` u LEFT JOIN enterprise e ON u.enterprise_id = e.id ` + whereSql +
    ' ORDER BY u.id DESC LIMIT ? OFFSET ?', [...params, pageSize, offset])

  const ROLE_LABEL: Record<string, string> = { platform_admin: '总部管理员', enterprise_admin: '厂家主账号', code_admin: '码管理员', viewer: '只读账号' }
  return {
    total: Number(cntRow?.c || 0),
    page, pageSize,
    rows: rows.map(r => ({ ...r, roleLabel: ROLE_LABEL[r.role] || r.role })),
  }
})
