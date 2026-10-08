import { createHash } from 'node:crypto'
import type { PoolConnection } from 'mysql2/promise'
import { getPool, query } from './db'
import type { AuthUser } from './auth'
import { productionTaskInput } from '../../shared/utils/production-task-input'
import { extractTraceCode } from '../../shared/utils/trace-code'
import { assertBindingAllowed, assertCodesCorrectable } from './binding-guard'
import { assertNoProductionReservation } from './production-reservation'
import { refreshUploadSnapshots } from './upload-snapshot'
import { headOf } from './code-head'

const fail = (message: string, statusCode = 409): never => { throw createError({ statusCode, statusMessage: message }) }
export const productionReviewer = (user: AuthUser) => ['platform_admin', 'enterprise_admin'].includes(user.role)
function inScope(user: AuthUser, row: any) {
  if (user.role !== 'platform_admin' && Number(row.enterprise_id) !== Number(user.enterprise_id)) fail('生产任务不存在或不属于本企业', 404)
}
async function transaction<T>(work: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection()
  try { await conn.beginTransaction(); const result = await work(conn); await conn.commit(); return result }
  catch (e: any) {
    await conn.rollback()
    if (e?.code === 'ER_DUP_ENTRY' || e?.code === 'ER_LOCK_DEADLOCK') fail('领用发生并发冲突，请刷新并重试')
    throw e
  } finally { conn.release() }
}
/** 所有写操作按产品→任务→批次→码加锁，与旧生产绑定的产品锁保持一致。 */
async function lockedTask(conn: PoolConnection, user: AuthUser, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) fail('任务编号无效', 400)
  const [[seed]] = await conn.query<any[]>('SELECT * FROM production_task WHERE id = ?', [id])
  if (!seed) fail('生产任务不存在', 404)
  inScope(user, seed)
  await conn.query('SELECT id FROM product WHERE id = ? FOR UPDATE', [seed.product_id])
  const [[task]] = await conn.query<any[]>('SELECT * FROM production_task WHERE id = ? FOR UPDATE', [id])
  inScope(user, task)
  return task
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
      if (previous.request_hash !== hash) fail('相同提交标识不能用于不同任务')
      return { ok: true, id: Number(previous.id), duplicate: true }
    }
    const codes: any[] = []
    for (let i = 0; i < input.codes.length; i += 1000) {
      const chunk = input.codes.slice(i, i + 1000)
      const [rows] = await conn.query<any[]>('SELECT * FROM trace_code WHERE code IN (' + chunk.map(() => '?').join(',') + ') ORDER BY id FOR UPDATE', chunk)
      codes.push(...rows)
    }
    if (codes.length !== input.codes.length || codes.some(c => Number(c.enterprise_id) !== Number(product.enterprise_id) || Number(c.product_id) !== input.productId)) fail('领用清单含不存在、跨企业或其他产品的码', 400)
    assertCodesCorrectable(codes)
    if (!product.spec_code || codes.some(c => !String(c.code).startsWith(headOf(product)))) fail('领用码前11位与当前产品规格或生产类型不一致', 400)
    if (codes.some(c => Number(c.status) !== 1 || c.batch_id || c.bound_at || c.produce_date || c.expire_date || c.quality_cert_no || c.batch_no || c.qc_result !== null)) fail('只能领用未绑定且没有生产覆盖资料的码；历史已绑定码不能按数量释放', 400)
    await assertNoProductionReservation(conn, codes.map(c => Number(c.id)))
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
    const [result]: any = await conn.execute('INSERT INTO production_task (enterprise_id,product_id,batch_id,name,request_id,request_hash,created_by) VALUES (?,?,?,?,?,?,?)', [product.enterprise_id, input.productId, batchId, input.name, input.requestId, hash, user.id])
    for (let i = 0; i < codes.length; i += 1000) {
      const chunk = codes.slice(i, i + 1000)
      await conn.query('INSERT INTO production_task_code (task_id,code_id,active_code_id,code) VALUES ' + chunk.map(() => '(?,?,?,?)').join(','), chunk.flatMap(c => [result.insertId, c.id, c.id, c.code]))
    }
    return { ok: true, id: Number(result.insertId), duplicate: false, total: codes.length }
  })
}
export async function scanProductionCode(user: AuthUser, id: number, body: Record<string, any>) {
  const code = extractTraceCode(String(body.code || '').trim())
  const device = String(body.device || '').trim()
  if (!/^\d{32}$/.test(code) || !device || device.length > 100) fail('请提供有效追溯码和设备名称', 400)
  return transaction(async conn => {
    const task = await lockedTask(conn, user, id)
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
    await conn.execute("UPDATE production_task_code SET state='used',used_by=?,device=?,used_at=NOW() WHERE task_id=? AND code_id=?", [user.id, device, id, tc.id])
    await conn.execute('UPDATE batch SET code_count=(SELECT COUNT(*) FROM trace_code WHERE batch_id=?) WHERE id=?', [batch.id, batch.id])
    if (tc.upload_batch_id) await refreshUploadSnapshots(conn, [Number(tc.upload_batch_id)])
    return { ok: true, duplicate: false, code }
  })
}
export async function endProductionTask(user: AuthUser, id: number) {
  return transaction(async conn => {
    const task = await lockedTask(conn, user, id)
    if (Number(task.created_by) !== user.id && !productionReviewer(user)) fail('仅任务创建人或管理员可以结束生产', 403)
    if (task.status !== 'active') return { ok: true, status: task.status, duplicate: true }
    const [[counts]] = await conn.query<any[]>("SELECT COUNT(*) AS total, SUM(state='used') AS usedCount FROM production_task_code WHERE task_id=?", [id])
    const remaining = Number(counts.total) - Number(counts.usedCount)
    await conn.execute("UPDATE production_task_code SET state='pending' WHERE task_id=? AND state='reserved'", [id])
    const status = remaining ? 'pending' : 'approved'
    await conn.execute('UPDATE production_task SET status=?,ended_at=NOW() WHERE id=?', [status, id])
    return { ok: true, status, total: Number(counts.total), used: Number(counts.usedCount), remaining }
  })
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
  const scope = user.role === 'platform_admin' ? '' : ' WHERE t.enterprise_id=?'
  const params = scope ? [user.enterprise_id] : []
  const rows = await query<any[]>(`SELECT t.*, p.name AS product_name,b.batch_no,b.produce_date,b.expire_date,b.quality_cert_no,b.qc_result,
    (SELECT COUNT(*) FROM production_task_code d WHERE d.task_id=t.id) AS total,
    (SELECT COUNT(*) FROM production_task_code d WHERE d.task_id=t.id AND d.state='used') AS used_count
    FROM production_task t JOIN product p ON p.id=t.product_id JOIN batch b ON b.id=t.batch_id` + scope + ' ORDER BY t.id DESC LIMIT 30 OFFSET ?', [...params, (page - 1) * 30])
  const [[count]] = await getPool().query<any[]>('SELECT COUNT(*) AS n FROM production_task t' + scope, params)
  return { rows, total: Number(count.n), page }
}
export async function productionTaskDetail(user: AuthUser, id: number, state: string, page: number) {
  if (!Number.isSafeInteger(id) || id <= 0) fail('任务编号无效', 400)
  const [task] = await query<any[]>('SELECT t.*,p.name AS product_name,b.batch_no,b.produce_date,b.expire_date,b.quality_cert_no,b.qc_result FROM production_task t JOIN product p ON p.id=t.product_id JOIN batch b ON b.id=t.batch_id WHERE t.id=?', [id])
  if (!task) fail('任务不存在', 404)
  inScope(user, task)
  const counts = await query<any[]>('SELECT state,COUNT(*) AS count FROM production_task_code WHERE task_id=? GROUP BY state', [id])
  const cond = ['reserved', 'used', 'pending', 'released'].includes(state) ? ' AND state=?' : ''
  const args = cond ? [id, state] : [id]
  const rows = await query<any[]>('SELECT * FROM production_task_code WHERE task_id=?' + cond + ' ORDER BY code_id LIMIT 100 OFFSET ?', [...args, (page - 1) * 100])
  const reviews = await query<any[]>('SELECT r.*,u.name AS reviewer_name FROM production_task_review r LEFT JOIN `user` u ON u.id=r.reviewer_id WHERE task_id=? ORDER BY r.id', [id])
  return { task, counts, rows, reviews, page }
}
