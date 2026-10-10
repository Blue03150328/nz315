// POST /api/admin/users —— 新增用户（PRD 5.12.3）
import { query, execute } from '../../utils/db'
import { requireWritableUser } from '../../utils/auth'
import { logOperation } from '../../utils/audit'
import bcrypt from 'bcryptjs'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  // 权限（2026-09-19 修复提权漏洞）：用户管理仅总部管理员与厂家主账号；
  // 此前码管理员/只读账号可穿透角色判断（仅拦了 enterprise_admin）自行建号——viewer 建 code_admin 即成提权链，一律 403
  if (user.role !== 'platform_admin' && user.role !== 'enterprise_admin') {
    throw createError({ statusCode: 403, statusMessage: '需要厂家主账号权限' })
  }
  const body = await readBody(event) || {}

  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  const name = String(body.name || '').trim()
  const phone = String(body.phone || '').trim()
  const role = String(body.role || 'code_admin')
  // 总部管理员已纳入可创建角色（2026-10-10）；能否真正创建由下方提权闸判定
  const allowedRoles = ['platform_admin', 'enterprise_admin', 'code_admin', 'viewer']

  if (!username) throw createError({ statusCode: 400, statusMessage: '请输入登录名' })
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) throw createError({ statusCode: 400, statusMessage: '登录名需为 3-30 位字母/数字/下划线' })
  if (password.length < 6) throw createError({ statusCode: 400, statusMessage: '密码至少 6 位' })
  if (!allowedRoles.includes(role)) throw createError({ statusCode: 400, statusMessage: '角色不合法' })

  // 提权闸（2026-10-10）：总部管理员账号只能由总部管理员创建。
  // 厂家主账号若能创建 platform_admin 即形成「建号即提权」链路（同 2026-09-19 viewer 建 code_admin 一类越权面），一律 403。
  if (role === 'platform_admin' && user.role !== 'platform_admin') {
    throw createError({ statusCode: 403, statusMessage: '只有总部管理员可以创建总部管理员账号' })
  }

  // 企业归属：总部管理员不挂企业（enterprise_id = NULL）；
  // 平台管理员创建其他角色须指定企业；厂家主账号只能建本企业的码管理员/只读账号
  let enterpriseId: number | null
  if (role === 'platform_admin') {
    enterpriseId = null
  } else if (user.role === 'platform_admin') {
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
