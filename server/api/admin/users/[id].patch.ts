// PATCH /api/admin/users/:id —— 编辑用户 / 禁用启用（PRD 5.12.3）
import { query, execute } from '../../../utils/db'
import { requireWritableUser } from '../../../utils/auth'
import { logOperation } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的用户ID' })
  if (id === user.id) throw createError({ statusCode: 400, statusMessage: '不能修改自己的账号' })

  const [target] = await query<any[]>('SELECT * FROM \`user\` WHERE id = ?', [id])
  if (!target) throw createError({ statusCode: 404, statusMessage: '用户不存在' })

  // 权限（2026-09-19 修复提权漏洞）：用户管理仅总部管理员与厂家主账号；
  // 此前角色判断只拦 enterprise_admin，码管理员/只读账号穿透——viewer 可禁用厂家主账号，一律 403
  if (user.role !== 'platform_admin' && user.role !== 'enterprise_admin') {
    throw createError({ statusCode: 403, statusMessage: '需要厂家主账号权限' })
  }
  // platform_admin 可管理全部（除其他 platform_admin 外）；enterprise_admin 仅本企业非管理员账号
  if (user.role === 'enterprise_admin') {
    if (target.enterprise_id !== user.enterprise_id) throw createError({ statusCode: 403, statusMessage: '无权操作其他企业用户' })
    if (target.role === 'enterprise_admin' || target.role === 'platform_admin') throw createError({ statusCode: 403, statusMessage: '无权操作该账号' })
  }
  if (user.role !== 'platform_admin' && target.role === 'platform_admin') {
    throw createError({ statusCode: 403, statusMessage: '无权操作总部管理员账号' })
  }

  const body = await readBody(event) || {}
  const name = String(body.name || '').trim()
  const phone = String(body.phone || '').trim()
  // status 未传时保留原值（body.status === 0 ? 0 : 1 会把未传值误判为启用——
  // 编辑被禁用用户的名字/电话会将其静默复活，属账号状态安全缺陷）
  const nextStatus = body.status === undefined || body.status === null
    ? (Number(target.status) === 0 ? 0 : 1)
    : (Number(body.status) === 0 ? 0 : 1)
  const action = nextStatus === 0 ? '禁用用户' : Number(target.status) === 0 ? '启用用户' : '编辑用户'

  await execute('UPDATE \`user\` SET name = ?, phone = ?, status = ? WHERE id = ?', [name || null, phone || null, nextStatus, id])
  await logOperation(event, {
    module: '用户管理',
    action,
    content: JSON.stringify({ id, username: target.username, name, phone, status: nextStatus }),
  })
  return { ok: true }
})
