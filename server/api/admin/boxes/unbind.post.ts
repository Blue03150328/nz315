// POST /api/admin/boxes/unbind —— 外箱码解绑（PRD 5.5.6：解绑需二次确认并记录日志）
import { query, execute } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'
import { logOperation } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const body = await readBody(event) || {}
  const outer = String(body.outer || '').trim()
  const confirm = String(body.confirm || '')
  if (!outer) throw createError({ statusCode: 400, statusMessage: '缺少外箱码' })
  if (confirm !== '确认解绑') throw createError({ statusCode: 400, statusMessage: '请输入"确认解绑"以确认操作' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const result = await execute(
    'UPDATE trace_code SET outer_box_code = NULL WHERE outer_box_code = ?' + (fid ? ' AND enterprise_id = ?' : ''),
    fid ? [outer, fid] : [outer])
  if (result.affectedRows === 0) throw createError({ statusCode: 404, statusMessage: '外箱码不存在' })

  await logOperation(event, {
    module: '码库管理',
    action: '外箱码解绑',
    content: JSON.stringify({ outer, count: result.affectedRows }),
  })
  return { ok: true, unbound: result.affectedRows }
})
