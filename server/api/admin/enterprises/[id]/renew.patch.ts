// PATCH /api/admin/enterprises/:id/renew —— 设置厂家续费到期日（2026-09-09）
// 总部管理员专用：续费动作在线下完成后由平台登记到期日；清空（'' / null）= 到期未续费（该厂全部账号禁止登录）。
import { query, execute } from '../../../../utils/db'
import { requirePlatformAdmin } from '../../../../utils/auth'
import { logOperation } from '../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requirePlatformAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的企业ID' })

  const [ent] = await query<any[]>('SELECT id, name, renew_expire FROM enterprise WHERE id = ?', [id])
  if (!ent) throw createError({ statusCode: 404, statusMessage: '企业不存在' })

  const body = await readBody(event) || {}
  const raw = body.renewExpire === undefined || body.renewExpire === null ? '' : String(body.renewExpire).trim()
  if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw createError({ statusCode: 400, statusMessage: '续费到期日格式应为 YYYY-MM-DD' })
  const renewExpire = raw || null

  await execute('UPDATE enterprise SET renew_expire = ? WHERE id = ?', [renewExpire, id])
  await logOperation(event, {
    module: '系统设置',
    action: renewExpire ? '设置续费到期日' : '清空续费到期日',
    content: JSON.stringify({ id, name: ent.name, before: ent.renew_expire || null, after: renewExpire }),
  })
  return { ok: true, renew_expire: renewExpire }
})
