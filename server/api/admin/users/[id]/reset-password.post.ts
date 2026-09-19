// POST /api/admin/users/:id/reset-password —— 重置密码（PRD 5.12.3）
import { query, execute } from '../../../../utils/db'
import { requireWritableUser } from '../../../../utils/auth'
import { logOperation } from '../../../../utils/audit'
import bcrypt from 'bcryptjs'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const id = Number(getRouterParam(event, 'id'))
  const body = await readBody(event) || {}
  const newPassword = String(body.password || '')
  if (newPassword.length < 6) throw createError({ statusCode: 400, statusMessage: '新密码至少 6 位' })

  const [target] = await query<any[]>('SELECT * FROM \`user\` WHERE id = ?', [id])
  if (!target) throw createError({ statusCode: 404, statusMessage: '用户不存在' })

  // 权限（2026-09-19 修复提权漏洞）：密码重置仅总部管理员与厂家主账号；
  // 此前角色判断只拦 enterprise_admin，码管理员/只读账号穿透——viewer 重置主账号密码即可接管账号，一律 403
  if (user.role !== 'platform_admin' && user.role !== 'enterprise_admin') {
    throw createError({ statusCode: 403, statusMessage: '需要厂家主账号权限' })
  }
  // 权限同编辑：厂家仅本企业非管理员；非平台管理员不可操作总部账号
  if (user.role === 'enterprise_admin') {
    if (target.enterprise_id !== user.enterprise_id || ['enterprise_admin', 'platform_admin'].includes(target.role)) {
      throw createError({ statusCode: 403, statusMessage: '无权重置该账号密码' })
    }
  }
  if (user.role !== 'platform_admin' && target.role === 'platform_admin') {
    throw createError({ statusCode: 403, statusMessage: '无权重置总部管理员密码' })
  }

  const hash = await bcrypt.hash(newPassword, 10)
  // 改密同时刷新 session_epoch（2026-09-19）：吊销该账号此前签发的全部会话——
  // 否则旧 token 在 7 天有效期内继续可用，改密形同虚设（账号被盗场景尤其关键）
  await execute('UPDATE \`user\` SET password = ?, session_epoch = ? WHERE id = ?', [hash, Date.now(), id])
  await logOperation(event, { module: '用户管理', action: '重置密码', content: JSON.stringify({ id, username: target.username }) })
  return { ok: true }
})
