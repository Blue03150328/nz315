// PATCH /api/admin/alerts/:id —— 处理预警（PRD 5.9：核实合规 / 确认违规→一键作废）
import { query, execute } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'
import { logOperation } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const id = Number(getRouterParam(event, 'id'))
  const body = await readBody(event) || {}
  const status = Number(body.status)  // 1已核实合规 2已确认违规
  const voidCode = body.voidCode === true  // 确认违规时是否一键作废关联码
  if (![1, 2].includes(status)) throw createError({ statusCode: 400, statusMessage: '无效的处理状态' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [alert] = await query<any[]>(
    'SELECT * FROM risk_alert WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''), fid ? [id, fid] : [id])
  if (!alert) throw createError({ statusCode: 404, statusMessage: '预警不存在' })

  await execute(
    'UPDATE risk_alert SET handle_status = ?, handler_id = ?, handle_time = NOW() WHERE id = ?',
    [status, user.id, id])

  let voided = 0
  if (status === 2 && voidCode && alert.code_id) {
    // 一键作废关联码（PRD 5.9 处理动作：确认违规可一键跳转批量作废）
    const [code] = await query<any[]>('SELECT * FROM trace_code WHERE id = ?', [alert.code_id])
    if (code && Number(code.abnormal_flag) !== 2) {
      await execute('UPDATE trace_code SET abnormal_flag = 2, abnormal_reason = ? WHERE id = ?',
        ['经风险预警确认违规作废', alert.code_id])
      voided = 1
    }
  }

  
  await logOperation(event, {
    module: '风险预警',
    action: status === 1 ? '核实合规' : '确认违规' + (voided ? '（已作废关联码）' : ''),
    content: JSON.stringify({ alertId: id, alertType: alert.alert_type, status, voided }),
  })
  return { ok: true, status, voided }
})
