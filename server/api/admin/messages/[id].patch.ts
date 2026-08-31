// PATCH /api/admin/messages/:id —— 标记已读（PRD 5.11）
import { query, execute } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的消息ID' })
  const body = await readBody(event) || {}
  const isRead = body.isRead === 1 ? 1 : 0

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [msg] = await query<any[]>(
    'SELECT id FROM message WHERE id = ?' + (fid ? ' AND (enterprise_id = ? OR enterprise_id IS NULL)' : ''),
    fid ? [id, fid] : [id])
  if (!msg) throw createError({ statusCode: 404, statusMessage: '消息不存在' })

  await execute('UPDATE message SET is_read = ? WHERE id = ?', [isRead, id])
  return { ok: true }
})
