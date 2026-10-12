import { createHash } from 'node:crypto'
import type { AuthUser } from './auth'
import { getPool, query } from './db'
import { transaction, lockedTask, productionReviewer } from './production-task'
import { productionRequestId } from '../../shared/utils/production-task-input'
import { productionPatch } from './production-patch'
import { isInputDate } from '../../shared/utils/input-date'
import { taskProduction } from './task-production'
import { usageBatchSchemaAvailable, requireUsageBatchSchema } from './usage-batch-schema'
import { resolveCodeScope, codeScopeSql } from './code-scope'
import { freeProductionCode } from './production-allocation'
import { refreshUploadSnapshots } from './upload-snapshot'

const fail = (message: string, statusCode = 409): never => { throw createError({ statusCode, statusMessage: message }) }
const beijing = (field: string) => `DATE_FORMAT(TIMESTAMPADD(SECOND,28800-TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),NOW()),${field}),'%Y-%m-%d %H:%i:%s')`
function abnormalSummary(total: number, frozen: number, voided: number) {
  return !total ? '空批次' : voided === total ? '全部作废' : voided ? '部分作废' : frozen === total ? '全部冻结' : frozen ? '部分冻结' : '正常'
}
function mappedStats(row: any, root: any, used: boolean) {
  const count = Number(row.code_total || 0), frozenCount = Number(row.frozen_count || 0), voidedCount = Number(row.voided_count || 0)
  return { count, codeTotal: count, usedCount: used ? count : 0, remainingCount: used ? 0 : count, frozenCount, voidedCount,
    normalCount: Math.max(0, count - frozenCount - voidedCount), summary: abnormalSummary(count, frozenCount, voidedCount),
    occupiedCount: Number(row.occupied_count || 0), availableCount: Number(row.available_count || 0), flagableCount: count - voidedCount,
    canDelete: !used && count > 0 && Number(row.history_count || 0) === 0,
    canCorrect: count > 0 && !frozenCount && !voidedCount && (used || !Number(row.occupied_count || 0)),
    canExport: count > 0 && String(root.file_name || '').startsWith('生成入库') }
}
export async function usageBatchChildren(user: AuthUser, rootId: number, page: number, pageSize: number) {
  const { row: root } = await resolveCodeScope(user, { uploadBatchId: rootId })
  if (!await usageBatchSchemaAvailable()) return { rows: [], total: 0, page, pageSize, productionRecordsAvailable: false, unavailableReason: '使用子批次结构尚未安装，请管理员完成数据库升级' }
  const [[totals]] = await getPool().query<any[]>(`SELECT COUNT(*) AS codeTotal,SUM(c.status=2 OR EXISTS(SELECT 1 FROM production_task_code d WHERE d.code_id=c.id AND d.state='used')) AS usedCount,
    SUM(c.usage_batch_id IS NULL AND (c.status=2 OR EXISTS(SELECT 1 FROM production_task_code d WHERE d.code_id=c.id AND d.state='used'))) AS legacyBoundCount FROM trace_code c WHERE c.upload_batch_id=? AND c.enterprise_id=?`, [rootId, root.enterprise_id])
  const [[count]] = await getPool().query<any[]>('SELECT COUNT(*) AS n FROM code_usage_batch WHERE parent_upload_batch_id=?', [rootId])
  const children = await query<any[]>(`SELECT cb.*,t.name AS task_name,t.production_snapshot,b.batch_no,b.produce_date,b.expire_date,b.qc_result,b.quality_cert_no,
    u.state AS upload_state,u.uploader_id,u.uploader_username,u.uploader_name,
    COUNT(c.id) AS code_total,SUM(c.abnormal_flag=1) AS frozen_count,SUM(c.abnormal_flag=2) AS voided_count,
    ${beijing('MIN(e.received_at)')} AS first_received_at,${beijing('MAX(e.received_at)')} AS last_received_at,
    DATE_FORMAT(TIMESTAMPADD(HOUR,8,MIN(e.captured_at)),'%Y-%m-%d %H:%i:%s') AS first_captured_at,
    DATE_FORMAT(TIMESTAMPADD(HOUR,8,MAX(e.captured_at)),'%Y-%m-%d %H:%i:%s') AS last_captured_at
    FROM (SELECT * FROM code_usage_batch WHERE parent_upload_batch_id=? ORDER BY id DESC LIMIT ? OFFSET ?) cb
    JOIN production_collection_upload u ON u.id=cb.upload_id JOIN production_task t ON t.id=cb.task_id JOIN batch b ON b.id=t.batch_id
    JOIN trace_code c ON c.usage_batch_id=cb.id AND c.upload_batch_id=cb.parent_upload_batch_id
    LEFT JOIN production_collection_event e ON e.upload_id=cb.upload_id AND e.code=c.code AND e.result_state='accepted'
    GROUP BY cb.id,cb.parent_upload_batch_id,cb.upload_id,cb.task_id,cb.spec_name_snapshot,cb.created_at,t.name,t.production_snapshot,b.batch_no,b.produce_date,b.expire_date,b.qc_result,b.quality_cert_no,u.state,u.uploader_id,u.uploader_username,u.uploader_name
    ORDER BY cb.id DESC`, [rootId, pageSize, (page - 1) * pageSize])
  const remaining = codeScopeSql({ uploadBatchId: rootId, remaining: true })
  const [rest] = await query<any[]>(`SELECT COUNT(*) AS code_total,SUM(c.abnormal_flag=1) AS frozen_count,SUM(c.abnormal_flag=2) AS voided_count,
    SUM(a.active_code_id IS NOT NULL) AS occupied_count,SUM(${freeProductionCode}) AS available_count,
    SUM(EXISTS(SELECT 1 FROM production_task_code h WHERE h.code_id=c.id)) AS history_count
    FROM trace_code c LEFT JOIN production_task_code a ON a.active_code_id=c.id WHERE ${remaining.sql} AND c.enterprise_id=?`, [...remaining.values, root.enterprise_id])
  const rows = children.map(row => {
    const production = taskProduction(row, { id: 0, batch_no: row.batch_no, produce_date: row.produce_date, expire_date: row.expire_date, qc_result: row.qc_result, quality_cert_no: row.quality_cert_no })
    return { id: Number(row.id), parentUploadBatchId: rootId, kind: 'used', taskId: Number(row.task_id), name: `${row.task_name} · 上传子批次${row.id}`,
      ...mappedStats(row, root, true), specName: row.spec_name_snapshot || null, batchNo: production.batch_no, produceDate: production.produce_date, expireDate: production.expire_date, qcResult: production.qc_result, qualityCertNo: production.quality_cert_no,
      uploadId: row.upload_id, uploadState: row.upload_state, uploaderId: row.uploader_id ? Number(row.uploader_id) : null, uploaderUsername: row.uploader_username || null, uploaderName: row.uploader_name || null,
      firstReceivedAt: row.first_received_at, lastReceivedAt: row.last_received_at, firstCapturedAt: row.first_captured_at, lastCapturedAt: row.last_captured_at }
  })
  const codeTotal = Number(totals.codeTotal || 0), usedCount = Number(totals.usedCount || 0)
  return { rows: [{ id: null, parentUploadBatchId: rootId, kind: 'remaining', taskId: null, name: '剩余未使用', ...mappedStats(rest || {}, root, false), specName: root.spec_name_snapshot || null, batchNo: null, produceDate: null, expireDate: null, qcResult: null, qualityCertNo: null }, ...rows], total: Number(count.n), page, pageSize, codeTotal, usedCount, remainingCount: codeTotal - usedCount, legacyBoundCount: Number(totals.legacyBoundCount || 0), productionRecordsAvailable: true, unavailableReason: null }
}

async function taskImpact(taskId: number) {
  return query<any[]>(`SELECT ub.id,ub.file_name AS fileName,COUNT(*) AS count,SUM(d.state='used') AS usedCount
    FROM production_task_code d JOIN trace_code c ON c.id=d.code_id JOIN upload_batch ub ON ub.id=c.upload_batch_id
    WHERE d.task_id=? GROUP BY ub.id,ub.file_name ORDER BY ub.id`, [taskId])
}
export async function usageBatchCorrectionPreview(user: AuthUser, childId: number) {
  const { row } = await resolveCodeScope(user, { usageBatchId: childId })
  const [task] = await query<any[]>('SELECT * FROM production_task WHERE id=?', [row.task_id])
  const [batch] = await query<any[]>('SELECT * FROM batch WHERE id=?', [task.batch_id])
  const [active] = await query<any[]>("SELECT COUNT(*) AS n FROM production_collection_session WHERE task_id=? AND state='active'", [task.id])
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
    const [[active]] = await conn.query<any[]>("SELECT COUNT(*) AS n FROM production_collection_session WHERE task_id=? AND state='active'", [task.id])
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
