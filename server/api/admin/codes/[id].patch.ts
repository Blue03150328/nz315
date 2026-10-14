// PATCH /api/admin/codes/:id —— 异常标记操作（PRD 5.5.5：正常/已冻结/已作废）
// 作废为终态需原因 + 记录审计日志；冻结可解冻；已作废/已冻结码不可绑定与修改
import { query } from '../../../utils/db'
import { transaction } from '../../../utils/production-task'
import { requireWritableUser } from '../../../utils/auth'
import { logOperation } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  if (user.role !== 'platform_admin' && !user.enterprise_id) throw createError({ statusCode: 403, statusMessage: '账号未关联企业' })
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的码ID' })

  const body = await readBody(event) || {}
  const flag = Number(body.flag)   // 0正常 1已冻结 2已作废
  const reason = String(body.reason || '').trim()
  if (![0, 1, 2].includes(flag)) throw createError({ statusCode: 400, statusMessage: '无效的异常标记' })
  if (flag === 2 && !reason) throw createError({ statusCode: 400, statusMessage: '作废必须填写原因' })
  if (reason.length > 500) throw createError({ statusCode: 400, statusMessage: '原因不能超过500字' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [code] = await query<any[]>(
    'SELECT * FROM trace_code WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''), fid ? [id, fid] : [id])
  if (!code) throw createError({ statusCode: 404, statusMessage: '追溯码不存在' })

  // 与整批和批量编辑共用产品锁，锁后重读终态，避免迟到恢复把刚作废的码复活。
  await transaction(async conn => {
    await conn.query('SELECT id FROM product WHERE id=? FOR UPDATE', [code.product_id])
    const [[current]] = await conn.query<any[]>('SELECT abnormal_flag FROM trace_code WHERE id=? AND enterprise_id=? FOR UPDATE', [id, code.enterprise_id])
    if (!current) throw createError({ statusCode: 404, statusMessage: '追溯码不存在' })
    if (Number(current.abnormal_flag) === 2 && flag !== 2) throw createError({ statusCode: 400, statusMessage: '该码已作废（终态），不可恢复' })
    await conn.execute('UPDATE trace_code SET abnormal_flag=?,abnormal_reason=? WHERE id=?', [flag, flag === 0 ? null : reason, id])
  })

  const FLAG_LABEL: Record<number, string> = { 0: '恢复正常', 1: '冻结', 2: '作废' }
  const flagLabel = FLAG_LABEL[flag] || '标记'
  await logOperation(event, {
    module: '码库管理',
    action: flagLabel,
    content: JSON.stringify({ code: code.code, flag, reason, flagLabel }),
  })
  return { ok: true, flag, flagLabel }
})
