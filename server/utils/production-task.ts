import { createHash } from 'node:crypto'
import type { PoolConnection } from 'mysql2/promise'
import { getPool, query } from './db'
import type { AuthUser } from './auth'
import { productionTaskInput, productionTaskMetadata, productionRequestId } from '../../shared/utils/production-task-input'
import { collectionCode } from '../../shared/utils/collection-input'
import { assertBindingAllowed, assertCodesCorrectable } from './binding-guard'
import { refreshUploadSnapshots } from './upload-snapshot'
import { headOf } from './code-head'
import { productionAllocationInput } from '../../shared/utils/production-allocation-input'
import { freeProductionCode, productionUsage, selectProductionAllocation, recordProductionAllocation } from './production-allocation'
import { lockProductionDevice, assertDeviceTask } from './production-device-auth'

const fail = (message: string, statusCode = 409): never => { throw createError({ statusCode, statusMessage: message }) }
export const productionReviewer = (user: AuthUser) => ['platform_admin', 'enterprise_admin'].includes(user.role)
function inScope(user: AuthUser, row: any) {
  if (user.role !== 'platform_admin' && Number(row.enterprise_id) !== Number(user.enterprise_id)) fail('生产任务不存在或不属于本企业', 404)
}
export async function transaction<T>(work: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection()
  try { await conn.beginTransaction(); const result = await work(conn); await conn.commit(); return result }
  catch (e: any) {
    await conn.rollback()
    if (e?.code === 'ER_DUP_ENTRY' || e?.code === 'ER_LOCK_DEADLOCK') fail('领用发生并发冲突，请刷新并重试')
    throw e
  } finally { conn.release() }
}
/** 所有写操作按产品→任务→批次→码加锁，与旧生产绑定的产品锁保持一致。 */
export async function lockedTask(conn: PoolConnection, user: AuthUser, id: number) {
  await lockProductionDevice(conn, user)
  if (!Number.isSafeInteger(id) || id <= 0) fail('任务编号无效', 400)
  const [[seed]] = await conn.query<any[]>('SELECT * FROM production_task WHERE id = ?', [id])
  if (!seed) fail('生产任务不存在', 404)
  inScope(user, seed)
  await conn.query('SELECT id FROM product WHERE id = ? FOR UPDATE', [seed.product_id])
  const [[task]] = await conn.query<any[]>('SELECT * FROM production_task WHERE id = ? FOR UPDATE', [id])
  inScope(user, task)
  await assertDeviceTask(conn, user, task)
  return task
}
async function recordTaskChange(conn: PoolConnection, taskId: number, user: AuthUser, action: string, requestId: string, hash: string, detail: any) {
  const [r]: any = await conn.execute('INSERT INTO production_task_change (task_id,actor_id,action,request_id,request_hash,detail) VALUES (?,?,?,?,?,?)', [taskId, user.id, action, requestId, hash, JSON.stringify(detail)])
  return Number(r.insertId)
}
async function priorTaskChange(conn: PoolConnection, taskId: number, user: AuthUser, requestId: string, hash: string) {
  const [[row]] = await conn.query<any[]>('SELECT request_hash,detail FROM production_task_change WHERE task_id=? AND actor_id=? AND request_id=?', [taskId, user.id, requestId])
  if (!row) return null
  if (row.request_hash !== hash) fail('相同提交标识不能用于不同修改')
  const detail = typeof row.detail === 'string' ? JSON.parse(row.detail) : row.detail
  return { ok: true, duplicate: true, ...detail.result }
}
function assertTaskEditor(user: AuthUser, task: any) {
  if (Number(task.created_by) !== Number(user.id) && !productionReviewer(user)) fail('仅任务创建人或管理员可以编辑和追加领用', 403)
}
export async function appendProductionTask(user: AuthUser, id: number, body: Record<string, any>) {
  let input: ReturnType<typeof productionAllocationInput>, requestId: string
  try { input = productionAllocationInput(body); requestId = productionRequestId(body) } catch (e) { fail((e as Error).message, 400) }
  const hash = createHash('sha256').update(JSON.stringify({ action: 'append', ...input! })).digest('hex')
  return transaction(async conn => {
    const task = await lockedTask(conn, user, id)
    assertTaskEditor(user, task)
    const prior = await priorTaskChange(conn, id, user, requestId!, hash)
    if (prior) return prior
    if (task.status !== 'active') fail('结束的任务不能追加领用，请新建下一批任务')
    const [[product]] = await conn.query<any[]>('SELECT p.*,s.spec_code FROM product p LEFT JOIN product_spec s ON s.id=p.spec_id WHERE p.id=?', [task.product_id])
    if (!product || Number(product.status) !== 1) fail('产品已停用，不能追加领用')
    const allocation = await selectProductionAllocation(conn, product, input!)
    const result = { id, added: allocation.rows.length }
    const eventId = await recordTaskChange(conn, id, user, 'append', requestId!, hash, { sourceTaskId: allocation.sourceTaskId, count: allocation.rows.length, codes: allocation.rows.map(c => c.code), result })
    await recordProductionAllocation(conn, id, allocation.rows, eventId, allocation.sourceTaskId)
    return { ok: true, duplicate: false, ...result }
  })
}
export async function editProductionTask(user: AuthUser, id: number, body: Record<string, any>) {
  let requestId: string
  let extra: ReturnType<typeof productionAllocationInput> | null = null
  try { requestId = productionRequestId(body); if (body.allocation) extra = productionAllocationInput(body.allocation) } catch (e) { fail((e as Error).message, 400) }
  const patch = Object.fromEntries(['name', 'lineName', 'batchNo', 'produceDate', 'expireDate', 'qualityCertNo', 'qcResult', 'productId'].filter(k => body[k] !== undefined).map(k => [k, body[k]]))
  const hash = createHash('sha256').update(JSON.stringify({ action: 'edit', ...patch, allocation: extra })).digest('hex')
  return transaction(async conn => {
    const task = await lockedTask(conn, user, id)
    assertTaskEditor(user, task)
    const prior = await priorTaskChange(conn, id, user, requestId!, hash)
    if (prior) return prior
    if (body.productId !== undefined && Number(body.productId) !== Number(task.product_id)) fail('任务产品不能更换，其他产品请新建任务', 400)
    const [[batch]] = await conn.query<any[]>('SELECT * FROM batch WHERE id=? FOR UPDATE', [task.batch_id])
    const [[captureCount]] = await conn.query<any[]>("SELECT COUNT(*) AS n FROM production_collection_session WHERE task_id=? AND state='active'", [id])
    const before = { name: task.name, lineName: task.line_name || task.name, batchNo: batch.batch_no, produceDate: String(batch.produce_date).slice(0, 10), expireDate: String(batch.expire_date).slice(0, 10), qualityCertNo: batch.quality_cert_no, qcResult: Number(batch.qc_result) }
    let after: ReturnType<typeof productionTaskMetadata>
    try { after = productionTaskMetadata({ ...before, ...patch, productId: Number(task.product_id) }) } catch (e) { fail((e as Error).message, 400) }
    const changedProduction = ['batchNo', 'produceDate', 'expireDate', 'qualityCertNo', 'qcResult'].some(k => (before as any)[k] !== (after! as any)[k])
    let batchId = Number(task.batch_id)
    if (changedProduction) {
      const [[used]] = await conn.query<any[]>("SELECT COUNT(*) AS n FROM production_task_code WHERE task_id=? AND state='used'", [id])
      if (task.status !== 'active' || Number(used.n) || Number(captureCount.n)) fail('任务已生产、设备已开始采集或已结束，不能修改日期、批号等生产资料')
      const [[target]] = await conn.query<any[]>('SELECT * FROM batch WHERE product_id=? AND batch_no=? FOR UPDATE', [task.product_id, after!.batchNo])
      if (target && Number(target.id) === batchId) {
        const [[others]] = await conn.query<any[]>('SELECT COUNT(*) AS n FROM production_task WHERE batch_id=? AND id<>?', [batchId, id])
        const [[bound]] = await conn.query<any[]>('SELECT COUNT(*) AS n FROM trace_code WHERE batch_id=?', [batchId])
        if (Number(others.n) || Number(bound.n)) fail('同批号被其他任务使用，请填写新的批号，避免改变其他产品资料')
        await conn.execute('UPDATE batch SET produce_date=?,expire_date=?,quality_cert_no=?,qc_result=? WHERE id=?', [after!.produceDate, after!.expireDate, after!.qualityCertNo, after!.qcResult, batchId])
      } else if (target) {
        if (String(target.produce_date).slice(0, 10) !== after!.produceDate || String(target.expire_date).slice(0, 10) !== after!.expireDate || target.quality_cert_no !== after!.qualityCertNo || Number(target.qc_result) !== after!.qcResult) fail('目标批号已有不同生产资料，请核对')
        batchId = Number(target.id)
      } else {
        const [r]: any = await conn.execute('INSERT INTO batch (enterprise_id,product_id,batch_no,produce_date,expire_date,qc_result,quality_cert_no,quantity) VALUES (?,?,?,?,?,?,?,0)', [task.enterprise_id, task.product_id, after!.batchNo, after!.produceDate, after!.expireDate, after!.qcResult, after!.qualityCertNo])
        batchId = Number(r.insertId)
      }
    }
    let allocation: Awaited<ReturnType<typeof selectProductionAllocation>> | null = null
    if (extra) {
      if (task.status !== 'active') fail('结束的任务不能追加领用，请新建下一批任务')
      const [[product]] = await conn.query<any[]>('SELECT p.*,s.spec_code FROM product p LEFT JOIN product_spec s ON s.id=p.spec_id WHERE p.id=?', [task.product_id])
      if (!product || Number(product.status) !== 1) fail('产品已停用，不能追加领用')
      allocation = await selectProductionAllocation(conn, product, extra)
    }
    await conn.execute('UPDATE production_task SET name=?,line_name=?,batch_id=? WHERE id=?', [after!.name, after!.lineName, batchId, id])
    const result = { id, batchId, added: allocation?.rows.length || 0 }
    const eventId = await recordTaskChange(conn, id, user, 'edit', requestId!, hash, { before, after: after!, result, codes: allocation?.rows.map(c => c.code), sourceTaskId: allocation?.sourceTaskId })
    if (allocation) await recordProductionAllocation(conn, id, allocation.rows, eventId, allocation.sourceTaskId)
    return { ok: true, ...result }
  })
}
export async function createProductionTask(user: AuthUser, body: Record<string, any>) {
  let input: ReturnType<typeof productionTaskInput>
  try { input = productionTaskInput(body) } catch (e) { fail((e as Error).message, 400) }
  const hash = createHash('sha256').update(JSON.stringify(input!)).digest('hex')
  return transaction(async conn => {
    const [[product]] = await conn.query<any[]>('SELECT p.*,s.spec_code FROM product p LEFT JOIN product_spec s ON s.id=p.spec_id WHERE p.id = ? FOR UPDATE', [input.productId])
    if (!product || Number(product.status) !== 1) fail('产品不存在或已停用', 400)
    inScope(user, product)
    const [[previous]] = await conn.query<any[]>('SELECT id, request_hash FROM production_task WHERE created_by = ? AND request_id = ?', [user.id, input.requestId])
    if (previous) {
      // 兼容上一版安卓尚未确认的清单提交，升级不使超时重试失去收据。
      const { productId, name, batchNo, qualityCertNo, produceDate, expireDate, qcResult, requestId, codes } = input
      const legacyHash = !input.sourceTaskId && !input.sourceUploadBatchId && body.lineName === undefined
        ? createHash('sha256').update(JSON.stringify({ productId, name, batchNo, qualityCertNo, produceDate, expireDate, qcResult, requestId, codes })).digest('hex') : ''
      if (previous.request_hash !== hash && previous.request_hash !== legacyHash) fail('相同提交标识不能用于不同任务')
      return { ok: true, id: Number(previous.id), duplicate: true }
    }
    const allocation = await selectProductionAllocation(conn, product, input)
    const codes = allocation.rows
    const [[oldBatch]] = await conn.query<any[]>('SELECT * FROM batch WHERE product_id = ? AND batch_no = ? FOR UPDATE', [input.productId, input.batchNo])
    let batchId: number
    if (oldBatch) {
      assertBindingAllowed(oldBatch, input.productId, Number(product.enterprise_id))
      if (String(oldBatch.produce_date).slice(0, 10) !== input.produceDate || String(oldBatch.expire_date).slice(0, 10) !== input.expireDate || oldBatch.quality_cert_no !== input.qualityCertNo) fail('同名批次已有不同生产资料，请核对批号', 400)
      batchId = Number(oldBatch.id)
    } else {
      const [result]: any = await conn.execute('INSERT INTO batch (enterprise_id,product_id,batch_no,produce_date,expire_date,qc_result,quality_cert_no,quantity) VALUES (?,?,?,?,?,1,?,0)', [product.enterprise_id, input.productId, input.batchNo, input.produceDate, input.expireDate, input.qualityCertNo])
      batchId = result.insertId
    }
    const [result]: any = await conn.execute('INSERT INTO production_task (enterprise_id,product_id,batch_id,name,line_name,request_id,request_hash,created_by) VALUES (?,?,?,?,?,?,?,?)', [product.enterprise_id, input.productId, batchId, input.name, input.lineName, input.requestId, hash, user.id])
    const eventId = await recordTaskChange(conn, Number(result.insertId), user, 'create', input.requestId, hash, { lineName: input.lineName, sourceTaskId: allocation.sourceTaskId, sourceUploadBatchId: input.sourceUploadBatchId, codes: codes.map(c => c.code), count: codes.length })
    await recordProductionAllocation(conn, Number(result.insertId), codes, eventId, allocation.sourceTaskId)
    return { ok: true, id: Number(result.insertId), duplicate: false, total: codes.length }
  })
}
export async function scanProductionCode(user: AuthUser, id: number, body: Record<string, any>) {
  return transaction(conn => bindProductionInTransaction(conn, user, id, body))
}
export async function bindProductionInTransaction(conn: PoolConnection, user: AuthUser, id: number, body: Record<string, any>, locked?: any, lineSnapshot?: string) {
  const code = collectionCode(String(body.code || '').trim()) || ''
  const device = String(body.device || '').trim()
  if (!/^\d{32}$/.test(code) || !device || device.length > 100) fail('请提供有效追溯码和设备名称', 400)
    const task = locked || await lockedTask(conn, user, id)
    const [[batch]] = await conn.query<any[]>('SELECT * FROM batch WHERE id = ? FOR UPDATE', [task.batch_id])
    if (!batch) fail('任务生产批次不存在')
    const [[tc]] = await conn.query<any[]>('SELECT * FROM trace_code WHERE code = ? FOR UPDATE', [code])
    const [[detail]] = tc ? await conn.query<any[]>('SELECT * FROM production_task_code WHERE task_id = ? AND code_id = ? FOR UPDATE', [id, tc.id]) : [[]]
    if (!detail || Number(tc.enterprise_id) !== Number(task.enterprise_id) || Number(tc.product_id) !== Number(task.product_id)) fail('此码不在本任务领用清单内', 400)
    // 超时后重试允许读取此前成功的收据，包括任务已结束后的重试，不再写库。
    if (detail.state === 'used') {
      if (Number(tc.batch_id) !== Number(task.batch_id) || Number(tc.status) !== 2) fail('已用码资料不一致，请管理员核对')
      return { ok: true, duplicate: true, code, usedAt: detail.used_at }
    }
    if (task.status !== 'active') fail('生产已结束，不能继续扫码')
    const [[product]] = await conn.query<any[]>('SELECT p.*,s.spec_code FROM product p LEFT JOIN product_spec s ON s.id=p.spec_id WHERE p.id=?', [task.product_id])
    if (!product || Number(product.status) !== 1 || !product.spec_code || !code.startsWith(headOf(product))) fail('产品已停用或规格资料发生变化，请先核对生产任务')
    if (detail.state !== 'reserved' || Number(detail.active_code_id) !== Number(tc.id) || Number(tc.status) !== 1 || tc.batch_id) fail('码状态已变化，不能覆盖生产批次')
    assertCodesCorrectable([tc])
    assertBindingAllowed(batch, Number(task.product_id), Number(task.enterprise_id))
    await conn.execute('UPDATE trace_code SET batch_id=?,batch_no=?,produce_date=?,expire_date=?,qc_result=?,quality_cert_no=?,status=2,bound_at=NOW() WHERE id=?', [batch.id, batch.batch_no, batch.produce_date, batch.expire_date, batch.qc_result, batch.quality_cert_no, tc.id])
    await conn.execute("UPDATE production_task_code SET state='used',used_by=?,device=?,used_line=?,used_at=NOW() WHERE task_id=? AND code_id=?", [user.device_id ? null : user.id, device, lineSnapshot || task.line_name || task.name, id, tc.id])
    await conn.execute('UPDATE batch SET code_count=(SELECT COUNT(*) FROM trace_code WHERE batch_id=?) WHERE id=?', [batch.id, batch.id])
    if (tc.upload_batch_id) await refreshUploadSnapshots(conn, [Number(tc.upload_batch_id)])
    return { ok: true, duplicate: false, code }
}
export async function endProductionTask(user: AuthUser, id: number) {
  return transaction(conn => endProductionInTransaction(conn, user, id))
}
export async function endProductionInTransaction(conn: PoolConnection, user: AuthUser, id: number, locked?: any) {
    const task = locked || await lockedTask(conn, user, id)
    if (Number(task.created_by) !== user.id && !productionReviewer(user) && !user.device_id) fail('仅任务创建人或管理员可以结束生产', 403)
    const [[deviceCount]] = await conn.query<any[]>("SELECT COUNT(*) AS n FROM production_collection_session WHERE task_id=? AND state='active'", [id])
    if (Number(deviceCount.n)) fail('有设备仍在采集或尚未完成同步，请先停止设备采集并同步全部记录')
    if (task.status !== 'active') return { ok: true, status: task.status, duplicate: true }
    const [[counts]] = await conn.query<any[]>("SELECT COUNT(*) AS total, SUM(state='used') AS usedCount FROM production_task_code WHERE task_id=?", [id])
    const remaining = Number(counts.total) - Number(counts.usedCount)
    await conn.execute("UPDATE production_task_code SET state='pending' WHERE task_id=? AND state='reserved'", [id])
    const status = remaining ? 'pending' : 'approved'
    await conn.execute('UPDATE production_task SET status=?,ended_at=NOW() WHERE id=?', [status, id])
    return { ok: true, status, total: Number(counts.total), used: Number(counts.usedCount), remaining }
}
export async function reviewProductionTask(user: AuthUser, id: number, body: Record<string, any>) {
  if (!productionReviewer(user)) fail('仅厂家管理员或总部管理员可以审核', 403)
  const decision = String(body.decision || '')
  const reason = String(body.reason || '').trim()
  if (!['approve', 'reject'].includes(decision) || !reason || reason.length > 500) fail('请选择审核结果并填写500字以内的原因', 400)
  return transaction(async conn => {
    const task = await lockedTask(conn, user, id)
    if (!['pending', 'rejected'].includes(task.status)) fail('任务不处于待审核状态，请刷新')
    const [details] = await conn.query<any[]>("SELECT * FROM production_task_code WHERE task_id=? AND state='pending' ORDER BY code_id", [id])
    for (let i = 0; i < details.length; i += 1000) {
      const chunk = details.slice(i, i + 1000)
      const [codes] = await conn.query<any[]>('SELECT * FROM trace_code WHERE id IN (' + chunk.map(() => '?').join(',') + ') ORDER BY id FOR UPDATE', chunk.map(c => c.code_id))
      if (codes.length !== chunk.length || codes.some(c => Number(c.status) !== 1 || c.batch_id || c.bound_at || c.produce_date || c.expire_date || c.quality_cert_no || c.batch_no || c.qc_result !== null || Number(c.enterprise_id) !== Number(task.enterprise_id) || Number(c.product_id) !== Number(task.product_id) || !chunk.some(d => Number(d.active_code_id) === Number(c.id)))) fail('剩余清单状态已变化，整单停止审核，请核对')
      assertCodesCorrectable(codes)
    }
    if (decision === 'approve') await conn.execute("UPDATE production_task_code SET state='released',active_code_id=NULL,released_at=NOW() WHERE task_id=? AND state='pending'", [id])
    await conn.execute('INSERT INTO production_task_review (task_id,reviewer_id,decision,reason,remaining_count) VALUES (?,?,?,?,?)', [id, user.id, decision, reason, details.length])
    const status = decision === 'approve' ? 'approved' : 'rejected'
    await conn.execute('UPDATE production_task SET status=?,reviewed_at=NOW() WHERE id=?', [status, id])
    return { ok: true, status, remaining: details.length }
  })
}
export async function productionTasks(user: AuthUser, page = 1) {
  const scope = user.device_id ? ' WHERE t.enterprise_id=? AND BINARY t.line_name=BINARY ?' : user.role === 'platform_admin' ? '' : ' WHERE t.enterprise_id=?'
  const params = user.device_id ? [user.enterprise_id, user.device_line] : scope ? [user.enterprise_id] : []
  const rows = await query<any[]>(`SELECT t.*, p.name AS product_name,b.batch_no,b.produce_date,b.expire_date,b.quality_cert_no,b.qc_result,
    (SELECT COUNT(*) FROM production_collection_session s WHERE s.task_id=t.id AND s.state='active') AS active_collection_count,
    (SELECT COUNT(*) FROM production_task_code d WHERE d.task_id=t.id) AS total,
    (SELECT COUNT(*) FROM production_task_code d WHERE d.task_id=t.id AND d.state='used') AS used_count
    FROM production_task t JOIN product p ON p.id=t.product_id JOIN batch b ON b.id=t.batch_id` + scope + ' ORDER BY t.id DESC LIMIT 30 OFFSET ?', [...params, (page - 1) * 30])
  const [[count]] = await getPool().query<any[]>('SELECT COUNT(*) AS n FROM production_task t' + scope, params)
  const usage = await productionUsage(getPool(), rows.map(t => Number(t.id)))
  return { rows: rows.map(t => ({ ...t, ...usage.get(Number(t.id)) })), total: Number(count.n), page }
}
export async function productionTaskDetail(user: AuthUser, id: number, state: string, page: number) {
  if (!Number.isSafeInteger(id) || id <= 0) fail('任务编号无效', 400)
  const [task] = await query<any[]>("SELECT t.*,p.name AS product_name,b.batch_no,b.produce_date,b.expire_date,b.quality_cert_no,b.qc_result,(SELECT COUNT(*) FROM production_collection_session s WHERE s.task_id=t.id AND s.state='active') AS active_collection_count FROM production_task t JOIN product p ON p.id=t.product_id JOIN batch b ON b.id=t.batch_id WHERE t.id=?", [id])
  if (!task) fail('任务不存在', 404)
  inScope(user, task)
  const counts = await query<any[]>('SELECT state,COUNT(*) AS count FROM production_task_code WHERE task_id=? GROUP BY state', [id])
  const cond = state === 'available' ? ` AND d.state='released' AND (${freeProductionCode})` : state === 'transferred' ? " AND d.state='released' AND a.task_id IS NOT NULL AND a.task_id<>d.task_id" : ['reserved', 'used', 'pending', 'released'].includes(state) ? ' AND d.state=?' : ''
  const args = ['reserved', 'used', 'pending', 'released'].includes(state) ? [id, state] : [id]
  const joins = ' FROM production_task_code d JOIN trace_code c ON c.id=d.code_id LEFT JOIN production_task_code a ON a.active_code_id=c.id'
  const rows = await query<any[]>(`SELECT d.*,a.task_id AS current_task_id,a.state AS current_state,ot.name AS current_task_name,ot.line_name AS current_line_name,
    CASE WHEN a.state='used' THEN COALESCE(NULLIF(a.used_line,''),'历史未记录') ELSE COALESCE(NULLIF(ot.line_name,''),ot.name) END AS actual_line_name,
    ob.batch_no AS current_batch_no,a.used_at AS current_used_at,a.device AS current_device,
    (d.state='released' AND (${freeProductionCode})) AS available_now` + joins +
    ' LEFT JOIN production_task ot ON ot.id=a.task_id LEFT JOIN batch ob ON ob.id=ot.batch_id WHERE d.task_id=?' + cond + ' ORDER BY d.code_id LIMIT 100 OFFSET ?', [...args, (page - 1) * 100])
  const [filtered] = await query<any[]>('SELECT COUNT(*) AS n' + joins + ' WHERE d.task_id=?' + cond, args)
  const reviews = await query<any[]>('SELECT r.*,u.name AS reviewer_name FROM production_task_review r LEFT JOIN `user` u ON u.id=r.reviewer_id WHERE task_id=? ORDER BY r.id', [id])
  const usage = await productionUsage(getPool(), [id])
  const changes = await query<any[]>("SELECT r.id,r.action,JSON_REMOVE(r.detail,'$.codes') AS detail,r.created_at,u.name AS actor_name FROM production_task_change r LEFT JOIN `user` u ON u.id=r.actor_id WHERE task_id=? ORDER BY r.id DESC LIMIT 30", [id])
  return { task: { ...task, ...usage.get(id) }, counts, rows, reviews, changes, page, filteredTotal: Number(filtered.n) }
}
export async function productionSources(user: AuthUser, productId: number) {
  if (!Number.isSafeInteger(productId) || productId < 0) fail('产品编号无效', 400)
  let product: any
  if (productId) {
    [product] = await query<any[]>('SELECT id,enterprise_id FROM product WHERE id=?', [productId])
    if (!product) fail('产品不存在', 404)
    inScope(user, product)
  }
  const params: any[] = []
  let scope = ''
  if (user.role !== 'platform_admin') { scope += ' AND t.enterprise_id=?'; params.push(user.enterprise_id) }
  if (productId) { scope += ' AND t.product_id=?'; params.push(productId) }
  // 未选产品时也可先选余码任务；先排除无可领码的任务，避免分页遮住较早的余码。
  const tasks = await query<any[]>(`SELECT t.id,t.name,t.line_name,t.product_id,t.enterprise_id,p.name AS product_name,e.name AS enterprise_name,b.batch_no
    FROM production_task t JOIN product p ON p.id=t.product_id JOIN enterprise e ON e.id=t.enterprise_id JOIN batch b ON b.id=t.batch_id
    WHERE t.status='approved' AND p.status=1${scope} AND EXISTS (
      SELECT 1 FROM production_task_code d JOIN trace_code c ON c.id=d.code_id LEFT JOIN production_task_code a ON a.active_code_id=c.id
      WHERE d.task_id=t.id AND d.state='released' AND ${freeProductionCode}) ORDER BY t.id DESC LIMIT 100`, params)
  const usage = await productionUsage(getPool(), tasks.map(t => Number(t.id)))
  const availableTasks = tasks.map(t => ({ ...t, ...usage.get(Number(t.id)) })).filter(t => t.available_count > 0)
  if (!productId) return { tasks: availableTasks, uploads: [], activeTasks: [] }
  const uploads = await query<any[]>(`SELECT u.id,u.file_name,COUNT(*) AS available_count FROM upload_batch u JOIN trace_code c ON c.upload_batch_id=u.id
    LEFT JOIN production_task_code a ON a.active_code_id=c.id WHERE u.product_id=? AND u.enterprise_id=? AND ${freeProductionCode}
    GROUP BY u.id,u.file_name ORDER BY u.id DESC LIMIT 100`, [productId, product.enterprise_id])
  const activeTasks = await query<any[]>("SELECT id,name,line_name,created_by FROM production_task WHERE product_id=? AND status='active'" + (productionReviewer(user) ? '' : ' AND created_by=?') + ' ORDER BY id DESC LIMIT 100', productionReviewer(user) ? [productId] : [productId, user.id])
  return { tasks: availableTasks, uploads, activeTasks }
}
export async function productionCodeHistory(user: AuthUser, id: number, codeId: number) {
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(codeId) || codeId <= 0) fail('任务或追溯码编号无效', 400)
  const [task] = await query<any[]>('SELECT * FROM production_task WHERE id=?', [id])
  if (!task) fail('任务不存在', 404)
  inScope(user, task)
  const [detail] = await query<any[]>('SELECT code FROM production_task_code WHERE task_id=? AND code_id=?', [id, codeId])
  if (!detail) fail('此码不在任务中', 404)
  const rows = await query<any[]>(`SELECT d.task_id,d.state,d.used_line,d.used_at,d.released_at,d.device,d.source_task_id,t.name,t.line_name,b.batch_no,u.name AS operator_name,
    COALESCE(e.created_at,t.created_at) AS allocated_at FROM production_task_code d JOIN production_task t ON t.id=d.task_id
    JOIN batch b ON b.id=t.batch_id LEFT JOIN production_task_change e ON e.id=d.allocation_id LEFT JOIN user u ON u.id=d.used_by
    WHERE d.code_id=? AND t.enterprise_id=? ORDER BY d.allocation_id DESC,d.task_id DESC LIMIT 100`, [codeId, task.enterprise_id])
  return { code: detail.code, rows }
}
