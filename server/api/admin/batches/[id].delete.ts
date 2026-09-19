// DELETE /api/admin/batches/:id —— 删除批次（已关联码的批次拒绝删除）
import { query, execute } from '../../../utils/db'
import { requireWritableUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的批次ID' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [batch] = await query<any[]>(
    'SELECT id FROM batch WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''), fid ? [id, fid] : [id])
  if (!batch) throw createError({ statusCode: 404, statusMessage: '批次不存在' })

  const [cntRow] = await query<any[]>('SELECT COUNT(*) AS c FROM trace_code WHERE batch_id = ?', [id])
  if (Number(cntRow?.c || 0) > 0) {
    throw createError({ statusCode: 400, statusMessage: '该批次已关联 ' + cntRow.c + ' 条追溯码，不可删除' })
  }
  await execute('DELETE FROM batch WHERE id = ?', [id])
  return { ok: true }
})
