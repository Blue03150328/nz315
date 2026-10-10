// PATCH /api/admin/users/:id —— 编辑用户 / 禁用启用（PRD 5.12.3）
import { query, execute, getPool } from '../../../utils/db'
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
  // platform_admin 可管理全部（2026-10-10 起含其他总部管理员，但受下方「须保留至少一个启用总部管理员」约束）；enterprise_admin 仅本企业非管理员账号
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

  // 防自锁（2026-10-10）：总部管理员账号现可由用户列表禁用。
  // 风险点在并发——若两个管理员同时禁用对方，各自校验时对方仍处于启用，双双放行即一个不剩、后台永久锁死。
  // 故禁用平台账号时把「判定 + 写入」放进同一事务，先 FOR UPDATE 锁住全部启用的平台账号行再计数。
  if (nextStatus === 0 && target.role === 'platform_admin') {
    const conn = await getPool().getConnection()
    try {
      await conn.beginTransaction()
      const [alive] = await conn.query<any[]>(
        "SELECT id FROM \`user\` WHERE role = 'platform_admin' AND status = 1 FOR UPDATE")
      if (alive.filter((r: any) => Number(r.id) !== id).length < 1) {
        throw createError({ statusCode: 400, statusMessage: '系统需保留至少一个启用的总部管理员账号，不能禁用最后一个' })
      }
      await conn.execute('UPDATE \`user\` SET name = ?, phone = ?, status = ? WHERE id = ?', [name || null, phone || null, nextStatus, id])
      await conn.commit()
    } catch (error) {
      await conn.rollback()
      throw error
    } finally {
      conn.release()
    }
  } else {
    await execute('UPDATE \`user\` SET name = ?, phone = ?, status = ? WHERE id = ?', [name || null, phone || null, nextStatus, id])
  }
  await logOperation(event, {
    module: '用户管理',
    action,
    content: JSON.stringify({ id, username: target.username, name, phone, status: nextStatus }),
  })
  return { ok: true }
})
