// PATCH /api/admin/users/:id —— 编辑用户 / 禁用启用（PRD 5.12.3）
import { query, execute } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'
import { logOperation } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的用户ID' })
  if (id === user.id) throw createError({ statusCode: 400, statusMessage: '不能修改自己的账号' })

  const [target] = await query<any[]>('SELECT * FROM \`user\` WHERE id = ?', [id])
  if (!target) throw createError({ statusCode: 404, statusMessage: '用户不存在' })

  // 权限：platform_admin 可管理全部（除其他 platform_admin 外）；enterprise_admin 仅本企业非管理员账号
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

  await execute('UPDATE \`user\` SET name = ?, phone = ?, status = ? WHERE id = ?', [name || null, phone || null, body.status === 0 ? 0 : 1, id])
  await logOperation(event, {
    module: '用户管理',
    action: body.status === 0 ? '禁用用户' : body.status === 1 && Number(target.status) === 0 ? '启用用户' : '编辑用户',
    content: JSON.stringify({ id, username: target.username, name, phone, status: body.status === 0 ? 0 : 1 }),
  })
  return { ok: true }
})
