import { createHash } from 'node:crypto'
import type { PoolConnection } from 'mysql2/promise'

/** 工人外码与后台共用一次事务，管理视图不改变工人收据或本机队列。 */
export async function ensureWorkerExternalBatch(conn: PoolConnection, session: any, run: any) {
  const identity = typeof session.identity_json === 'string' ? JSON.parse(session.identity_json) : session.identity_json
  const device = typeof run.device_snapshot === 'string' ? JSON.parse(run.device_snapshot) : run.device_snapshot || {}
  const [[prior]] = await conn.query<any[]>('SELECT id,source_kind FROM external_collection_batch WHERE id=? FOR UPDATE', [session.id])
  if (prior) {
    if (prior.source_kind !== 'worker') throw new Error('外码采集标识冲突')
    return
  }
  const context = typeof run.context_json === 'string' ? JSON.parse(run.context_json) : run.context_json || {}
  const product = typeof run.product_snapshot === 'string' ? JSON.parse(run.product_snapshot) : run.product_snapshot || {}
  await conn.execute(`INSERT INTO external_collection_batch
    (id,enterprise_id,device_id,device_name_snapshot,line_name_snapshot,worker_no,worker_name_snapshot,worker_user_id,source_kind,created_at,product_id,product_name_snapshot,batch_no,produce_date)
    VALUES (?,?,?,?,?,?,?,?,'worker',?,?,?,?,?)`, [session.id, run.enterprise_id, session.device_id,
    device.name || identity.deviceName || '', device.lineName || identity.lineName || '',
    identity.username, identity.name || identity.username, session.user_id, session.started_at || run.created_at,
    context.unifiedScan ? run.product_id : null, context.unifiedScan ? product.name || null : null,
    context.unifiedScan ? context.batchNo : null, context.unifiedScan ? context.produceDate : null])
}

/** 企业原文唯一键裁定跨设备、跨产品和跨轮重复；插入和工人收据同事务。 */
export async function captureUnifiedExternal(conn: PoolConnection, session: any, run: any, event: any) {
  await ensureWorkerExternalBatch(conn, session, run)
  if (event.kind === 'invalid') return { result: 'exception', reason: '本机判定为异常，原文保留待核对' }
  const rawHash = createHash('sha256').update(event.rawCode).digest('hex')
  // 旧工人批次使用按轮签名的哈希，仍须与其完整原文核对，避免升级后再次入库。
  const [[historical]] = await conn.query<any[]>('SELECT id FROM external_trace_code WHERE enterprise_id=? AND raw_hash<>? AND BINARY raw_code=BINARY ? LIMIT 1', [run.enterprise_id, rawHash, event.rawCode])
  if (historical) return { result: 'duplicate', reason: '此标签已在本厂历史记录中采集，原文保留，不重复入库或计数' }
  const [inserted]: any = await conn.execute(`INSERT IGNORE INTO external_trace_code
    (enterprise_id,batch_id,raw_code,raw_hash,sequence_no,captured_at) VALUES (?,?,?,?,?,?)`,
    [run.enterprise_id, session.id, event.rawCode, rawHash, event.sequence, event.capturedAt.replace('T', ' ').replace('Z', '')])
  return inserted.affectedRows === 1 ? { result: 'saved', reason: '' } : { result: 'duplicate', reason: '此标签已被本厂采集，原文保留，不重复入库或计数' }
}

export async function projectWorkerExternalEvent(conn: PoolConnection, session: any, run: any, event: any) {
  await ensureWorkerExternalBatch(conn, session, run)
  // 全局旧原文唯一键与工人「每轮按解析码去重」分别保留；不同轮可审计同一原文。
  const rawHash = createHash('sha256').update('worker:' + run.id + ':' + event.dedup_key).digest('hex')
  const context = typeof run.context_json === 'string' ? JSON.parse(run.context_json) : run.context_json || {}
  if (event.result_state === 'saved' && !context.unifiedScan) await conn.execute(`INSERT INTO external_trace_code
    (enterprise_id,batch_id,raw_code,raw_hash,sequence_no,captured_at) VALUES (?,?,?,?,?,?)`,
    [run.enterprise_id, session.id, event.raw_code, rawHash, event.sequence_no, event.captured_at])
  const state = event.result_state === 'saved' ? 'accepted' : event.result_state === 'duplicate' ? 'duplicate' : 'rejected'
  await conn.execute(`INSERT INTO external_collection_event
    (batch_id,sequence_no,event_id,payload_hash,result_state,reason,captured_at) VALUES (?,?,?,?,?,?,?)`,
    [session.id, event.sequence_no, event.id, event.payload_hash, state, String(event.reason || '').slice(0, 255), event.captured_at])
  await conn.execute(`UPDATE external_collection_batch SET last_sequence=?,accepted_count=accepted_count+?,
    duplicate_count=duplicate_count+?,rejected_count=rejected_count+? WHERE id=?`,
    [event.sequence_no, state === 'accepted' ? 1 : 0, state === 'duplicate' ? 1 : 0, state === 'rejected' ? 1 : 0, session.id])
}
