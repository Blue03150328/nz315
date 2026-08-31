// POST /api/admin/users —— 新增用户（PRD 5.12.3）
import { query, execute } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'
import { logOperation } from '../../utils/audit'
import bcrypt from 'bcryptjs'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const body = await readBody(event) || {}

  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  const name = String(body.name || '').trim()
  const phone = String(body.phone || '').trim()
  const role = String(body.role || 'code_admin')
  const allowedRoles = ['enterprise_admin', 'code_admin', 'viewer']

  if (!username) throw createError({ statusCode: 400, statusMessage: '请输入登录名' })
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) throw createError({ statusCode: 400, statusMessage: '登录名需为 3-30 位字母/数字/下划线' })
  if (password.length < 6) throw createError({ statusCode: 400, statusMessage: '密码至少 6 位' })
  if (!allowedRoles.includes(role)) throw createError({ statusCode: 400, statusMessage: '角色不合法' })

  // 企业归属：platform_admin 指定企业；enterprise_admin 只能建本企业且只能建 code_admin/viewer
  let enterpriseId: number | null
  if (user.role === 'platform_admin') {
    enterpriseId = Number(body.enterpriseId) || null
    if (!enterpriseId) throw createError({ statusCode: 400, statusMessage: '请选择所属企业' })
  } else {
    enterpriseId = user.enterprise_id
    if (role === 'enterprise_admin') throw createError({ statusCode: 400, statusMessage: '厂家账号只能创建码管理员/只读账号' })
  }

  const [dup] = await query<any[]>('SELECT id FROM \`user\` WHERE username = ? LIMIT 1', [username])
  if (dup) throw createError({ statusCode: 400, statusMessage: '该登录名已存在' })

  const hash = await bcrypt.hash(password, 10)
  const result = await execute(
    'INSERT INTO \`user\` (enterprise_id, username, password, name, phone, role, status) VALUES (?,?,?,?,?,?,1)',
    [enterpriseId, username, hash, name || null, phone || null, role])
  await logOperation(event, { module: '用户管理', action: '新增用户', content: JSON.stringify({ username, name, role, enterpriseId }) })
  return { ok: true, id: result.insertId }
})
