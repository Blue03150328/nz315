import { createHash } from 'node:crypto'
import type { PoolConnection } from 'mysql2/promise'
import type { AuthUser } from './auth'
import { query } from './db'
import { transaction, lockedTask, bindProductionInTransaction, endProductionInTransaction, productionReviewer } from './production-task'
import { collectionId, collectionEvents } from '../../shared/utils/collection-input'

const fail = (message: string, statusCode = 409): never => { throw createError({ statusCode, statusMessage: message }) }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const asJson = (value: any) => typeof value === 'string' ? JSON.parse(value) : value
async function contextOf(conn: PoolConnection, task: any) {
  const [[batch]] = await conn.query<any[]>('SELECT * FROM batch WHERE id=? FOR UPDATE', [task.batch_id])
  if (!batch) fail('生产批次不存在')
  return { taskId: Number(task.id), productId: Number(task.product_id), batchId: Number(task.batch_id), batchNo: batch.batch_no, produceDate: String(batch.produce_date).slice(0, 10), expireDate: String(batch.expire_date).slice(0, 10), qcResult: Number(batch.qc_result), qualityCertNo: batch.quality_cert_no }
}
function owner(user: AuthUser, session: any) {
  if (user.device_id) { if (Number(session.device_id) !== user.device_id) fail('不能同步其他设备的采集记录',403); return }
  if (session.device_id) fail('设备采集记录请使用原设备凭证同步',403)
  if (Number(session.user_id) !== Number(user.id) && !productionReviewer(user)) fail('请使用原采集账号或管理员账号同步此设备记录', 403)
}
async function lockedSession(conn: PoolConnection, user: AuthUser, taskId: number, id: string) {
  const [[session]] = await conn.query<any[]>('SELECT * FROM production_collection_session WHERE id=? AND task_id=? FOR UPDATE', [id, taskId])
  if (!session) fail('设备采集会话不存在', 404)
  owner(user, session); return session
}
function receipt(row: any) { return { eventId: row.event_id, sequence: Number(row.sequence_no), code: row.code || null, kind: row.event_kind, state: row.result_state, reason: row.reason } }

/** 创建可恢复的设备采集会话，注册后结束任务和修改生产资料均被锁住。 */
export async function startCollection(user: AuthUser, taskId: number, body: Record<string, any>) {
  let id: string
  try { id = collectionId(body.sessionId) } catch (error) { fail((error as Error).message, 400) }
  const device = user.device_id ? `${user.name} / 设备${user.device_id}`.slice(0,100) : String(body.device || '').trim()
  if (!device || device.length > 100) fail('请提供100字以内的设备名称', 400)
  return transaction(async conn => {
    const task = await lockedTask(conn, user, taskId)
    const [[prior]] = await conn.query<any[]>('SELECT * FROM production_collection_session WHERE id=? FOR UPDATE', [id!])
    if (user.device_id && !prior && task.line_name !== user.device_line) fail('任务不属于本设备生产线',403)
    if (prior) owner(user,prior)
    if (prior && (Number(prior.task_id) !== taskId || Number(prior.user_id) !== Number(user.id) || (!user.device_id && prior.device !== device))) fail('会话标识已被其他资料使用')
    if (task.status !== 'active' || prior?.state === 'completed') fail('生产任务或设备采集已结束，不能重新开始')
    const context = await contextOf(conn, task)
    if (prior && hash(context) !== prior.context_hash) fail('本批生产资料发生变化，请管理员核对未同步记录')
    const [[product]] = await conn.query<any[]>('SELECT name FROM product WHERE id=?', [task.product_id])
    const saved = prior ? asJson(prior.context_json) : { ...context, productName: product?.name, name: task.name, lineName: task.line_name || task.name, userId: Number(user.id), userName: user.name || user.username, enterpriseId: task.enterprise_id, deviceId:user.device_id || null, serverTaskCreatedBy: Number(task.created_by) }
    if (!prior && user.device_id) await conn.execute('INSERT INTO production_collection_session(id,task_id,user_id,device_id,device,line_snapshot,context_hash,context_json) VALUES (?,?,?,?,?,?,?,?)', [id!,taskId,0,user.device_id,device,saved.lineName,hash(context),JSON.stringify(saved)])
    else if (!prior) await conn.execute('INSERT INTO production_collection_session(id,task_id,user_id,device,line_snapshot,context_hash,context_json) VALUES (?,?,?,?,?,?,?)', [id!, taskId, user.id, device, saved.lineName, hash(context), JSON.stringify(saved)])
    const codes = await conn.query<any[]>(`SELECT d.code,d.state,c.abnormal_flag,
      (d.state='reserved' AND d.active_code_id=c.id AND c.status=1 AND c.batch_id IS NULL AND c.abnormal_flag=0) AS eligible
      FROM production_task_code d JOIN trace_code c ON c.id=d.code_id WHERE d.task_id=? ORDER BY d.code_id`, [taskId])
    return { ok: true, sessionId: id!, state: 'active', context: saved, codes: codes[0], lastSequence: Number(prior?.last_sequence || 0) }
  })
}

/** 每条事件的码绑定、异常留痕和序号推进共用事务；丢失整批响应可逐条幂等重放。 */
export async function syncCollection(user: AuthUser, taskId: number, rawId: string, body: Record<string, any>) {
  let id: string, events: ReturnType<typeof collectionEvents>
  try { id = collectionId(rawId); events = collectionEvents(body) } catch (error) { fail((error as Error).message, 400) }
  const receipts = []
  for (const event of events!) {
    try {
      const result = await transaction(async conn => {
        const task = await lockedTask(conn, user, taskId), session = await lockedSession(conn, user, taskId, id!)
        const payloadHash = hash(event)
        const [[prior]] = await conn.query<any[]>('SELECT * FROM production_collection_event WHERE session_id=? AND sequence_no=? FOR UPDATE', [id!, event.sequence])
        if (prior) { if (prior.event_id !== event.eventId || prior.payload_hash !== payloadHash) fail('事件序号被不同资料使用，请核对设备记录'); return receipt(prior) }
        if (session.state !== 'active' || task.status !== 'active') fail('采集或生产已经结束，未确认记录不得转绑其他任务')
        if (event.sequence !== Number(session.last_sequence) + 1) fail('采集序号存在缺口，请先重传较早的记录')
        if (hash(await contextOf(conn, task)) !== session.context_hash) fail('生产资料发生变化，保留本机记录并请管理员核对')
        let resultState = event.kind === 'duplicate' ? 'duplicate' : 'rejected', reason = event.reason || (event.kind === 'duplicate' ? '重复码已剔除，不重复绑定' : '错误码已剔除并记录')
        if (event.kind === 'valid') {
          await conn.query('SAVEPOINT collection_binding')
          try {
            if (!event.code) fail('不是完整的本系统32位追溯码', 400)
            const bound = await bindProductionInTransaction(conn, user, taskId, { code: event.code, device: session.device }, task, session.line_snapshot)
            resultState = bound.duplicate ? 'duplicate' : 'accepted'; reason = bound.duplicate ? '云端此前已绑定，不重复计数' : ''
          } catch (error: any) {
            await conn.query('ROLLBACK TO SAVEPOINT collection_binding')
            if (!error?.statusCode || error.statusCode >= 500) throw error
            resultState = 'rejected'; reason = String(error.statusMessage || error.message || '码未通过生产绑定校验').slice(0, 500)
          }
        }
        await conn.execute('INSERT INTO production_collection_event(event_id,session_id,sequence_no,payload_hash,code,raw_code,event_kind,result_state,reason,captured_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [event.eventId, id!, event.sequence, payloadHash, event.code, event.rawCode, event.kind, resultState, reason, event.capturedAt.replace('T', ' ').replace('Z', '')])
        const countColumn = resultState === 'accepted' ? 'accepted_count' : resultState === 'duplicate' ? 'duplicate_count' : 'rejected_count'
        await conn.execute(`UPDATE production_collection_session SET last_sequence=?,${countColumn}=${countColumn}+1 WHERE id=?`, [event.sequence, id!])
        if(user.device_id) await conn.execute('UPDATE production_device SET last_sync_at=NOW() WHERE id=?',[user.device_id])
        return { eventId: event.eventId, sequence: event.sequence, code: event.code, kind: event.kind, state: resultState, reason }
      })
      receipts.push(result)
    } catch (error: any) {
      // 未确认的尾部仍留在设备；不把事务失败当成已剔除或已同步。
      return { ok: false, sessionId: id!, receipts, retryable: true, statusCode: Number(error.statusCode || 503), message: String(error.statusMessage || '云端暂未确认，请保留本机记录并重试').slice(0, 500) }
    }
  }
  return { ok: true, sessionId: id!, receipts }
}

/** 停止采集后传最终序号；云端必须收齐包含重复/错误码在内的全部事件才可结束。 */
export async function completeCollection(user: AuthUser, taskId: number, rawId: string, body: Record<string, any>) {
  let id: string
  try { id = collectionId(rawId) } catch (error) { fail((error as Error).message, 400) }
  const last = Number(body.lastSequence)
  if (!Number.isSafeInteger(last) || last < 0 || last > 10000000 || typeof body.endTask !== 'boolean') fail('最终采集序号或结束选项不正确', 400)
  return transaction(async conn => {
    const task = await lockedTask(conn, user, taskId), session = await lockedSession(conn, user, taskId, id!)
    if (session.state === 'completed') {
      if (last !== Number(session.last_sequence)) fail('结束收据与设备最终序号不一致')
      return asJson(session.completion_result)
    }
    const [[count]] = await conn.query<any[]>('SELECT COUNT(*) AS n FROM production_collection_event WHERE session_id=?', [id!])
    if (Number(session.last_sequence) !== last || Number(count.n) !== last) fail('云端尚未收齐本机全部记录，不能结束采集')
    await conn.execute("UPDATE production_collection_session SET state='completed',completed_at=NOW() WHERE id=?", [id!])
    const [[active]] = await conn.query<any[]>("SELECT COUNT(*) AS n FROM production_collection_session WHERE task_id=? AND state='active'", [taskId])
    let ended = false, taskStatus = task.status
    if (body.endTask && !Number(active.n) && (Number(task.created_by) === Number(user.id) || productionReviewer(user) || user.device_id)) {
      const result = await endProductionInTransaction(conn, user, taskId, task); ended = true; taskStatus = result.status
    }
    const result = { ok: true, sessionId: id!, state: 'completed', lastSequence: last, taskEnded: ended, taskStatus, otherDevices: Number(active.n), accepted: Number(session.accepted_count), duplicates: Number(session.duplicate_count), rejected: Number(session.rejected_count) }
    await conn.execute('UPDATE production_collection_session SET completion_result=? WHERE id=?', [JSON.stringify(result), id!])
    return result
  })
}

export async function collectionAnomalies(user: AuthUser, taskId: number, page: number) {
  const [task] = await query<any[]>('SELECT * FROM production_task WHERE id=?', [taskId])
  if (!task || (user.role !== 'platform_admin' && Number(task.enterprise_id) !== Number(user.enterprise_id))) fail('生产任务不存在或不属于本企业', 404)
  const offset = (Math.max(1, page) - 1) * 50
  const rows = await query<any[]>(`SELECT e.*,s.device,s.line_snapshot,u.name AS operator_name FROM production_collection_event e
    JOIN production_collection_session s ON s.id=e.session_id LEFT JOIN user u ON u.id=s.user_id
    WHERE s.task_id=? AND e.result_state<>'accepted' ORDER BY e.received_at DESC,e.sequence_no DESC LIMIT 50 OFFSET ?`, [taskId, offset])
  const sessions = await query<any[]>('SELECT id,device,device_id,line_snapshot,state,last_sequence,accepted_count,duplicate_count,rejected_count,created_at,completed_at FROM production_collection_session WHERE task_id=? ORDER BY created_at DESC', [taskId])
  const [count] = await query<any[]>("SELECT COUNT(*) AS n FROM production_collection_event e JOIN production_collection_session s ON s.id=e.session_id WHERE s.task_id=? AND e.result_state<>'accepted'", [taskId])
  return { rows, sessions, total: Number(count.n), page }
}
