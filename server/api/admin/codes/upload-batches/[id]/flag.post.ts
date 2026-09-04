// POST /api/admin/codes/upload-batches/:id/flag —— 整批异常标记（2026-09-04 码库聚合改造）
// 作用域 = 本上传批次（upload_batch）内全部追溯码；flag：0 恢复正常 / 1 冻结 / 2 作废
// 规则对齐单条/批量标记（PRD 5.5.5）：
//   ① 作废为终态必填原因，批次内全部码（含已冻结）统一置作废；
//   ② 冻结/恢复正常不动作废码（终态保护），仅作用于其余码；无操作对象时 400 提示；
//   ③ 企业隔离：厂家/码管理员只能操作本企业上传批次（platform_admin 全量）。
import { query, execute } from '../../../../../utils/db'
import { requireBackendUser } from '../../../../../utils/auth'
import { logOperation } from '../../../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const ubId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(ubId) || ubId <= 0) throw createError({ statusCode: 400, statusMessage: '无效的上传批次ID' })

  const body = await readBody(event) || {}
  const flag = Number(body.flag)
  const reason = String(body.reason || '').trim()
  if (![0, 1, 2].includes(flag)) throw createError({ statusCode: 400, statusMessage: '无效的异常标记' })
  if (flag === 2 && !reason) throw createError({ statusCode: 400, statusMessage: '作废必须填写原因' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  // 上传批次归属校验（防跨企业操作）
  const [ub] = await query<any[]>(
    'SELECT id, file_name FROM upload_batch WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
    fid ? [ubId, fid] : [ubId])
  if (!ub) throw createError({ statusCode: 404, statusMessage: '上传批次不存在' })

  const FLAG_LABEL: Record<number, string> = { 0: '恢复正常', 1: '冻结', 2: '作废' }
  // mysql2 affectedRows 为「匹配行数」语义（同值更新也返回匹配数），不能靠 UPDATE 返回值判断是否
  // 有实际变化——执行前按当前真实状态统计可操作数，无可操作对象直接 400 拒绝
  const [statRow] = await query<any[]>(
    flag === 2
      ? 'SELECT COUNT(*) AS c FROM trace_code WHERE upload_batch_id = ? AND abnormal_flag <> 2' + (fid ? ' AND enterprise_id = ?' : '')
      : flag === 1
        ? 'SELECT COUNT(*) AS c FROM trace_code WHERE upload_batch_id = ? AND abnormal_flag = 0' + (fid ? ' AND enterprise_id = ?' : '')
        : 'SELECT COUNT(*) AS c FROM trace_code WHERE upload_batch_id = ? AND abnormal_flag = 1' + (fid ? ' AND enterprise_id = ?' : ''),
    fid ? [ubId, fid] : [ubId])
  const operable = Number(statRow?.c || 0)
  if (operable === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: flag === 2 ? '本批次没有可作废的追溯码' : flag === 1 ? '本批次没有可冻结的码（已全部冻结或已作废）' : '本批次没有已冻结的码，无需恢复正常',
    })
  }

  let affected = 0
  if (flag === 2) {
    // 整批作废（终态）：全部码统一作废，已冻结码一并作废
    const r = await execute(
      'UPDATE trace_code SET abnormal_flag = 2, abnormal_reason = ? WHERE upload_batch_id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
      fid ? [reason, ubId, fid] : [reason, ubId])
    affected = Number(r.affectedRows || 0)
  } else {
    // 冻结 / 恢复正常：不动作废终态码
    const r = await execute(
      'UPDATE trace_code SET abnormal_flag = ?, abnormal_reason = ? WHERE upload_batch_id = ? AND abnormal_flag <> 2' + (fid ? ' AND enterprise_id = ?' : ''),
      flag === 0 ? [flag, null, ubId, ...(fid ? [fid] : [])] : [flag, reason || null, ubId, ...(fid ? [fid] : [])])
    affected = Number(r.affectedRows || 0)
  }

  await logOperation(event, {
    module: '码库管理',
    action: '整批' + FLAG_LABEL[flag],
    content: JSON.stringify({ uploadBatchId: ubId, fileName: ub.file_name, count: affected, flag, reason }),
  })
  return { ok: true, affected, flagLabel: FLAG_LABEL[flag], fileName: ub.file_name }
})
