import { createHash } from 'node:crypto'
import { createError } from 'h3'
import type { PoolConnection } from 'mysql2/promise'
import type { AuthUser } from './auth'
import type { ExternalCollectionReceipt } from '../../shared/types/external-collection'
import { getPool, query } from './db'
import { lockProductionDevice } from './production-device-auth'
import { externalCollectionId, externalEventInput, externalRawCode, externalSequence, externalStartInput, EXTERNAL_EVENT_LIMIT } from '../../shared/utils/external-collection-input'

export const externalFail = (message: string, statusCode = 409): never => { throw createError({ statusCode, statusMessage: message }) }
export const externalHash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

/** 不缓存缺表状态，完成迁移后无需重启；只将结构缺失转成明确升级提示。 */
export async function requireExternalCollectionSchema() {
  try {
    await query(`SELECT b.id,b.enterprise_id,b.device_id,b.worker_no,b.line_name_snapshot,b.device_name_snapshot,
      b.state,b.last_sequence,b.accepted_count,b.duplicate_count,b.rejected_count,b.product_id,b.product_name_snapshot,
      b.batch_no,b.produce_date,b.production_quantity,b.metadata_updated_at,b.completed_at,
      c.raw_code,c.raw_hash,c.sequence_no,c.captured_at,c.received_at,e.event_id,e.payload_hash,e.result_state,e.reason
      FROM external_collection_batch b, external_trace_code c, external_collection_event e LIMIT 0`)
  } catch (error: any) {
    if (error?.code === 'ER_NO_SUCH_TABLE' || error?.code === 'ER_BAD_FIELD_ERROR') externalFail('外部采集数据库尚未升级，请由管理员执行数据库迁移后重试；设备本机记录仍保留', 503)
    throw error
  }
}

async function externalTransaction<T>(work: (conn: PoolConnection) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const conn = await getPool().getConnection()
    try {
      await conn.beginTransaction()
      const result = await work(conn)
      await conn.commit()
      return result
    } catch (error: any) {
      await conn.rollback()
      // 死锁由数据库回滚整笔事务，可用相同标识安全重试。
      if ((error?.code === 'ER_LOCK_DEADLOCK' || error?.code === 'ER_LOCK_WAIT_TIMEOUT') && attempt < 2) continue
      throw error
    } finally { conn.release() }
  }
}

export function externalBatchRow(row: any) {
  return { ...row, line_name: row.line_name_snapshot, device_name: row.device_name_snapshot,
    code_count: Number(row.accepted_count), effective_production_quantity: Number(row.production_quantity ?? row.accepted_count) }
}

export function externalScope(user: AuthUser, row: any) {
  if (!row || (user.role !== 'platform_admin' && Number(row.enterprise_id) !== Number(user.enterprise_id))) externalFail('外部采集批次不存在或不属于本企业', 404)
}

function owner(user: AuthUser, row: any) {
  if (row?.source_kind === 'worker') externalFail('工人采集请通过原工人会话接口上传和完成', 403)
  if (!row || Number(row.enterprise_id) !== Number(user.enterprise_id) || Number(row.device_id) !== Number(user.device_id)) externalFail('请使用本次采集的原设备上传和完成', 403)
  if (row.state === 'active' && row.line_name_snapshot !== user.device_line) externalFail('本批生产线与设备当前归属不一致，请联系管理员恢复设备归属', 409)
}

const startResult = (row: any) => ({ ok: true, batch: externalBatchRow(row), batchId: row.id, lastSequence: Number(row.last_sequence), state: row.state, lineName: row.line_name_snapshot, workerNo: row.worker_no })

export async function startExternalCollection(user: AuthUser, body: Record<string, unknown>) {
  await requireExternalCollectionSchema()
  let input: ReturnType<typeof externalStartInput>
  try { input = externalStartInput(body) } catch (error) { return externalFail((error as Error).message, 400) }
  if (!user.device_id || !user.enterprise_id) externalFail('请使用已激活的采集设备', 403)
  return externalTransaction(async conn => {
    await lockProductionDevice(conn, user)
    // 与企业删除共用企业行锁，认证后企业被删除或停用不能产生孤立新批次。
    const [[enterprise]] = await conn.query<any[]>('SELECT id,status,renew_expire,CURDATE() AS today FROM enterprise WHERE id=? FOR UPDATE', [user.enterprise_id])
    if (!enterprise || Number(enterprise.status) !== 1 || !enterprise.renew_expire || String(enterprise.renew_expire).slice(0, 10) < String(enterprise.today).slice(0, 10)) externalFail('所属企业已停用、到期或不存在', 403)
    const [[prior]] = await conn.query<any[]>('SELECT * FROM external_collection_batch WHERE id=? FOR UPDATE', [input.batchId])
    if (prior) {
      owner(user, prior)
      if (prior.worker_no !== input.workerNo) externalFail('相同采集标识不能更换工号')
      if (input.lineName !== undefined && input.lineName !== prior.line_name_snapshot) externalFail('相同采集标识不能更换生产线快照')
      return startResult(prior)
    }
    if (input.lineName !== undefined && input.lineName !== user.device_line) externalFail('生产线与已激活设备不一致，请刷新设备信息', 409)
    const [[active]] = await conn.query<any[]>("SELECT id FROM external_collection_batch WHERE device_id=? AND state='active' LIMIT 1 FOR UPDATE", [user.device_id])
    if (active) externalFail('请先上传并完成设备上一批外部采集，再开始新批次')
    await conn.execute('INSERT INTO external_collection_batch(id,enterprise_id,device_id,device_name_snapshot,line_name_snapshot,worker_no) VALUES (?,?,?,?,?,?)', [input.batchId, user.enterprise_id, Number(user.device_id), user.name, user.device_line || '', input.workerNo])
    const [[row]] = await conn.query<any[]>('SELECT * FROM external_collection_batch WHERE id=?', [input.batchId])
    return startResult(row)
  })
}

async function lockedBatch(conn: PoolConnection, user: AuthUser, batchId: string) {
  await lockProductionDevice(conn, user)
  const [[row]] = await conn.query<any[]>('SELECT * FROM external_collection_batch WHERE id=? FOR UPDATE', [batchId])
  if (!row) externalFail('外部采集批次尚未登记，请先恢复本次采集', 404)
  owner(user, row)
  return row
}

function receipt(row: any): ExternalCollectionReceipt {
  return { eventId: row.event_id, sequence: Number(row.sequence_no), state: row.result_state, reason: row.reason }
}

/** 一个事件一笔完整事务：码、收据、序号和计数同时成功或同时回滚。 */
export async function syncExternalCollection(user: AuthUser, id: string, body: Record<string, any>) {
  await requireExternalCollectionSchema()
  let batchId: string, events: ReturnType<typeof externalEventInput>[]
  try {
    batchId = externalCollectionId(id)
    if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > EXTERNAL_EVENT_LIMIT) throw new Error('每次请上传1至20条采集记录')
    events = body.events.map(value => externalEventInput(value || {}))
  } catch (error) { return externalFail((error as Error).message, 400) }
  const receipts: ExternalCollectionReceipt[] = []
  for (const event of events) {
    try {
      const result = await externalTransaction(async conn => {
        const batch = await lockedBatch(conn, user, batchId)
        const payloadHash = externalHash(JSON.stringify(event))
        const [[prior]] = await conn.query<any[]>('SELECT * FROM external_collection_event WHERE batch_id=? AND sequence_no=?', [batchId, event.sequence])
        if (prior) {
          if (prior.event_id !== event.eventId || prior.payload_hash !== payloadHash) externalFail('相同采集序号不能更换原文、时间或事件标识，请保留原记录重试')
          return receipt(prior)
        }
        if (batch.state !== 'active') externalFail('本次采集已完成，不能继续增加新记录')
        if (event.sequence !== Number(batch.last_sequence) + 1) externalFail('采集序号不连续，请先补传前面的记录')
        const [[occupied]] = await conn.query<any[]>('SELECT batch_id FROM external_collection_event WHERE event_id=?', [event.eventId])
        if (occupied) externalFail('事件标识已用于其他采集记录，请恢复原记录')
        let state: ExternalCollectionReceipt['state'] = 'accepted', reason = ''
        try { externalRawCode(event.rawCode) } catch (error) { state = 'rejected'; reason = (error as Error).message }
        const capturedAt = new Date(event.capturedAt).toISOString().slice(0, 23).replace('T', ' ')
        if (state === 'accepted') {
          const rawHash = externalHash(event.rawCode)
          try {
            await conn.execute('INSERT INTO external_trace_code(enterprise_id,batch_id,raw_code,raw_hash,sequence_no,captured_at) VALUES (?,?,?,?,?,?)', [batch.enterprise_id, batchId, event.rawCode, rawHash, event.sequence, capturedAt])
          } catch (error: any) {
            if (error?.code !== 'ER_DUP_ENTRY') throw error
            // 唯一索引串行裁定同企业重复；读取锁取得并发事务已经提交的原文。
            const [[existing]] = await conn.query<any[]>('SELECT raw_code FROM external_trace_code WHERE enterprise_id=? AND raw_hash=? FOR UPDATE', [batch.enterprise_id, rawHash])
            if (!existing) throw error
            if (existing.raw_code !== event.rawCode) externalFail('溯源码摘要发生冲突，原记录未被替换，请联系管理员核查')
            state = 'duplicate'; reason = '本企业已采集相同溯源码，不重复新增'
          }
        }
        await conn.execute('INSERT INTO external_collection_event(batch_id,sequence_no,event_id,payload_hash,result_state,reason,captured_at) VALUES (?,?,?,?,?,?,?)', [batchId, event.sequence, event.eventId, payloadHash, state, reason, capturedAt])
        const countColumn = state === 'accepted' ? 'accepted_count' : state === 'duplicate' ? 'duplicate_count' : 'rejected_count'
        await conn.execute(`UPDATE external_collection_batch SET last_sequence=?,${countColumn}=${countColumn}+1 WHERE id=?`, [event.sequence, batchId])
        await conn.execute('UPDATE production_device SET last_sync_at=NOW() WHERE id=?', [user.device_id || 0])
        return { eventId: event.eventId, sequence: event.sequence, state, reason }
      })
      receipts.push(result)
    } catch (error: any) {
      // 未返回收据的事件仍留在设备队列；此前已经提交的收据可以安全确认。
      if (receipts.length === 0 && error?.statusCode) throw error
      return { ok: false, batchId, receipts, statusCode: error?.statusCode || 503, retryable: !error?.statusCode || error.statusCode >= 500, message: error?.statusMessage || '上传暂未完成，请保留本机记录并重试' }
    }
  }
  return { ok: true, batchId, receipts }
}

export async function completeExternalCollection(user: AuthUser, id: string, body: Record<string, unknown>) {
  await requireExternalCollectionSchema()
  let batchId: string, lastSequence: number
  try { batchId = externalCollectionId(id); lastSequence = externalSequence(body.lastSequence, true) } catch (error) { return externalFail((error as Error).message, 400) }
  return externalTransaction(async conn => {
    const batch = await lockedBatch(conn, user, batchId)
    if (Number(batch.last_sequence) !== lastSequence) externalFail('本次采集记录尚未全部上传，或完成序号与已保存记录不一致，请补传后再完成')
    if (batch.state === 'active') await conn.execute("UPDATE external_collection_batch SET state='completed',completed_at=NOW(3) WHERE id=?", [batchId])
    return { ok: true, batchId, state: 'completed', acceptedCount: Number(batch.accepted_count), duplicateCount: Number(batch.duplicate_count), rejectedCount: Number(batch.rejected_count), lastSequence }
  })
}

export { externalTransaction }
