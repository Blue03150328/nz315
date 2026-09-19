// POST /api/admin/codes/batch-flag —— 批量异常标记（PRD 5.5.5：批量冻结/作废）
import { query, execute } from '../../../utils/db'
import { requireWritableUser } from '../../../utils/auth'
import { logOperation } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const body = await readBody(event) || {}
  const ids = Array.isArray(body.ids) ? body.ids.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0) : []
  const flag = Number(body.flag)
  const reason = String(body.reason || '').trim()
  if (ids.length === 0) throw createError({ statusCode: 400, statusMessage: '请选择追溯码' })
  if (ids.length > 5000) throw createError({ statusCode: 400, statusMessage: '单次最多 5000 条' })
  if (![0, 1, 2].includes(flag)) throw createError({ statusCode: 400, statusMessage: '无效的异常标记' })
  if (flag === 2 && !reason) throw createError({ statusCode: 400, statusMessage: '作废必须填写原因' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const idList = ids.join(',')
  const [cntRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM trace_code WHERE id IN (' + idList + ')' + (fid ? ' AND enterprise_id = ?' : ''),
    fid ? [fid] : [])
  if (Number(cntRow?.c || 0) !== ids.length) {
    throw createError({ statusCode: 400, statusMessage: '部分追溯码不存在或不属于本企业' })
  }

  // 终态保护（PRD 5.5.5）：已作废为终态，不可被恢复/冻结；同批中存在已作废码时整批拒绝
  if (flag !== 2) {
    const [voidRow] = await query<any[]>(
      'SELECT COUNT(*) AS c FROM trace_code WHERE id IN (' + idList + ') AND abnormal_flag = 2' + (fid ? ' AND enterprise_id = ?' : ''),
      fid ? [fid] : [])
    if (Number(voidRow?.c || 0) > 0) {
      throw createError({ statusCode: 400, statusMessage: '所选码中包含已作废的码（终态不可恢复），请先剔除后再操作' })
    }
  }

  const result = await execute(
    'UPDATE trace_code SET abnormal_flag = ?, abnormal_reason = ? WHERE id IN (' + idList + ')' + (fid ? ' AND enterprise_id = ?' : ''),
    flag === 0 ? [flag, null, ...(fid ? [fid] : [])] : [flag, reason, ...(fid ? [fid] : [])]
  )
  const FLAG_LABEL: Record<number, string> = { 0: '恢复正常', 1: '冻结', 2: '作废' }
  await logOperation(event, {
    module: '码库管理',
    action: '批量' + FLAG_LABEL[flag],
    content: JSON.stringify({ count: result.affectedRows, flag, reason, ids: ids.slice(0, 50) }),
  })
  return { ok: true, affected: result.affectedRows, flagLabel: FLAG_LABEL[flag] }
})