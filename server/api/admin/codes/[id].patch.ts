// PATCH /api/admin/codes/:id —— 异常标记操作（PRD 5.5.5：正常/已冻结/已作废）
// 作废为终态需原因 + 记录审计日志；冻结可解冻；已作废/已冻结码不可绑定与修改
import { query, execute } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'
import { logOperation } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的码ID' })

  const body = await readBody(event) || {}
  const flag = Number(body.flag)   // 0正常 1已冻结 2已作废
  const reason = String(body.reason || '').trim()
  if (![0, 1, 2].includes(flag)) throw createError({ statusCode: 400, statusMessage: '无效的异常标记' })
  if (flag === 2 && !reason) throw createError({ statusCode: 400, statusMessage: '作废必须填写原因' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [code] = await query<any[]>(
    'SELECT * FROM trace_code WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''), fid ? [id, fid] : [id])
  if (!code) throw createError({ statusCode: 404, statusMessage: '追溯码不存在' })

  // 终态保护：已作废不可再操作（除解冻场景外，作废即终态）
  if (Number(code.abnormal_flag) === 2 && flag !== 2) {
    throw createError({ statusCode: 400, statusMessage: '该码已作废（终态），不可恢复' })
  }
  // 已冻结/已作废的码不可执行绑定等修改（此处为标记操作本身，放行）

  await execute('UPDATE trace_code SET abnormal_flag = ?, abnormal_reason = ? WHERE id = ?', [flag, flag === 0 ? null : reason, id])

  const FLAG_LABEL: Record<number, string> = { 0: '恢复正常', 1: '冻结', 2: '作废' }
  const flagLabel = FLAG_LABEL[flag] || '标记'
  await logOperation(event, {
    module: '码库管理',
    action: flagLabel,
    content: JSON.stringify({ code: code.code, flag, reason, flagLabel }),
  })
  return { ok: true, flag, flagLabel }
})
