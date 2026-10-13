// 采集上传批次的整任务更正（2026-10-12 码库去子批次：已删除上传子批次列表查询，只保留更正预览与执行）。
import { createHash } from 'node:crypto'
import type { AuthUser } from './auth'
import { query } from './db'
import { transaction, lockedTask, productionReviewer } from './production-task'
import { productionRequestId } from '../../shared/utils/production-task-input'
import { productionPatch } from './production-patch'
import { isInputDate } from '../../shared/utils/input-date'
import { taskProduction } from './task-production'
import { requireUsageBatchSchema } from './usage-batch-schema'
import { resolveCodeScope } from './code-scope'
import { refreshUploadSnapshots } from './upload-snapshot'

const fail = (message: string, statusCode = 409): never => { throw createError({ statusCode, statusMessage: message }) }

async function taskImpact(taskId: number) {
  return query<any[]>(`SELECT ub.id,ub.file_name AS fileName,COUNT(*) AS count,SUM(d.state='used') AS usedCount
    FROM production_task_code d JOIN trace_code c ON c.id=d.code_id JOIN upload_batch ub ON ub.id=c.upload_batch_id
    WHERE d.task_id=? GROUP BY ub.id,ub.file_name ORDER BY ub.id`, [taskId])
}
export async function usageBatchCorrectionPreview(user: AuthUser, childId: number) {
  const { row } = await resolveCodeScope(user, { usageBatchId: childId })
  const [task] = await query<any[]>('SELECT * FROM production_task WHERE id=?', [row.task_id])
  const [batch] = await query<any[]>('SELECT * FROM batch WHERE id=?', [task.batch_id])
  const [active] = await query<any[]>("SELECT (SELECT COUNT(*) FROM production_collection_session WHERE task_id=? AND state='active')+(SELECT COUNT(*) FROM worker_session s JOIN worker_run r ON r.id=s.run_id WHERE r.task_id=? AND s.state='active') AS n", [task.id,task.id])
  const [unfinished] = await query<any[]>("SELECT COUNT(*) AS n FROM production_collection_upload WHERE task_id=? AND state<>'completed'", [task.id])
  const [abnormal] = await query<any[]>("SELECT COUNT(*) AS n FROM production_task_code d JOIN trace_code c ON c.id=d.code_id WHERE d.task_id=? AND d.state='used' AND c.abnormal_flag<>0", [task.id])
  const roots = await taskImpact(Number(task.id)), production = taskProduction(task, batch)
  const allowed = Number(task.created_by) === user.id || productionReviewer(user)
  return { task: { id: Number(task.id), name: task.name, batchNo: production.batch_no, produceDate: production.produce_date, expireDate: production.expire_date, qcResult: production.qc_result, qualityCertNo: production.quality_cert_no },
    roots: roots.map(root => ({ ...root, id: Number(root.id), count: Number(root.count), usedCount: Number(root.usedCount) })), rootCount: roots.length, totalCodes: roots.reduce((n, root) => n + Number(root.count), 0), usedCodes: roots.reduce((n, root) => n + Number(root.usedCount), 0),
    canCorrect: user.role !== 'viewer' && allowed && !Number(active?.n) && !Number(unfinished?.n) && !Number(abnormal?.n), reason: user.role === 'viewer' ? '只读账号不能更正生产资料' : !allowed ? '仅任务创建人或管理员可以更正生产资料' : Number(active?.n) || Number(unfinished?.n) ? '请先完成全部上传并结束所有设备采集后再更正生产资料' : Number(abnormal?.n) ? '关联任务含冻结或作废码，请先处理' : null }
}

/** 全任务更正使用独立快照，不修改共享业务批次、不挪动二维码或固定上传子批。 */
export async function correctUsageBatchProduction(user: AuthUser, childId: number, body: any) {
  await requireUsageBatchSchema()
  const { row } = await resolveCodeScope(user, { usageBatchId: childId })
  let requestId: string, fields: Record<string, string | number>
  try { requestId = productionRequestId(body); fields = productionPatch(body) } catch (error) { fail((error as Error).message, 400) }
  if (body.batchNo !== undefined && body.batchNo !== '') {
    const batchNo = String(body.batchNo).trim()
    if (!batchNo || batchNo.length > 64) fail('生产批号须为1至64字', 400)
    fields!.batch_no = batchNo
  }
  if (!Object.keys(fields!).length) fail('请至少选择一个需要更正的生产字段', 400)
  const hash = createHash('sha256').update(JSON.stringify({ action: 'correct_production', fields: fields! })).digest('hex')
  return transaction(async conn => {
    const task = await lockedTask(conn, user, Number(row.task_id))
    if (Number(task.created_by) !== user.id && !productionReviewer(user)) fail('仅任务创建人或管理员可以更正生产资料', 403)
    const [[prior]] = await conn.query<any[]>('SELECT request_hash,detail FROM production_task_change WHERE task_id=? AND actor_id=? AND request_id=?', [task.id, user.id, requestId!])
    if (prior) { if (prior.request_hash !== hash) fail('相同提交标识不能用于不同生产资料'); const saved = typeof prior.detail === 'string' ? JSON.parse(prior.detail) : prior.detail; return { ...saved.result, duplicate: true } }
    const [[active]] = await conn.query<any[]>("SELECT (SELECT COUNT(*) FROM production_collection_session WHERE task_id=? AND state='active')+(SELECT COUNT(*) FROM worker_session s JOIN worker_run r ON r.id=s.run_id WHERE r.task_id=? AND s.state='active') AS n", [task.id,task.id])
    if (Number(active.n)) fail('请先同步并结束所有设备采集后再更正生产资料')
    const [[unfinished]] = await conn.query<any[]>("SELECT COUNT(*) AS n FROM production_collection_upload WHERE task_id=? AND state<>'completed'", [task.id])
    if (Number(unfinished.n)) fail('请先完成所有上传，再更正生产资料')
    const [[batch]] = await conn.query<any[]>('SELECT * FROM batch WHERE id=? FOR UPDATE', [task.batch_id])
    const before = taskProduction(task, batch), after = { ...before, ...fields! }
    if (!isInputDate(String(after.produce_date).slice(0, 10)) || !isInputDate(String(after.expire_date).slice(0, 10)) || String(after.expire_date) < String(after.produce_date)) fail('生产日期和有效期须有效，且有效期不能早于生产日期', 400)
    const [usedCodes] = await conn.query<any[]>("SELECT c.id,c.abnormal_flag FROM production_task_code d JOIN trace_code c ON c.id=d.code_id WHERE d.task_id=? AND d.state='used' ORDER BY c.id FOR UPDATE", [task.id])
    if (usedCodes.some(code => Number(code.abnormal_flag) !== 0)) fail('关联任务含冻结或作废码，请先处理，不能更正生产资料', 400)
    const snapshot = Object.fromEntries(['batch_no', 'produce_date', 'expire_date', 'quality_cert_no', 'qc_result'].map(key => [key, after[key]]))
    await conn.execute('UPDATE production_task SET production_snapshot=? WHERE id=?', [JSON.stringify(snapshot), task.id])
    const columns = Object.keys(fields!)
    await conn.execute('UPDATE trace_code c JOIN production_task_code d ON d.code_id=c.id AND d.task_id=? AND d.state=\'used\' SET ' + columns.map(key => `c.${key}=?`).join(','), [task.id, ...Object.values(fields!)])
    const [roots] = await conn.query<any[]>('SELECT DISTINCT c.upload_batch_id AS id FROM production_task_code d JOIN trace_code c ON c.id=d.code_id WHERE d.task_id=? AND c.upload_batch_id IS NOT NULL ORDER BY c.upload_batch_id', [task.id])
    await refreshUploadSnapshots(conn, roots.map(root => Number(root.id)))
    const result = { ok: true, taskId: Number(task.id), rootCount: roots.length }
    await conn.execute('INSERT INTO production_task_change(task_id,actor_id,action,request_id,request_hash,detail) VALUES (?,?,?,?,?,?)', [task.id, user.id, 'correct_production', requestId!, hash, JSON.stringify({ before: { batchNo: before.batch_no, produceDate: before.produce_date, expireDate: before.expire_date, qualityCertNo: before.quality_cert_no, qcResult: before.qc_result }, after: snapshot, roots: roots.map(root => root.id), result })])
    return { ...result, duplicate: false }
  })
}
