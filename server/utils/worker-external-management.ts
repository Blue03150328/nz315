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
  await conn.execute(`INSERT INTO external_collection_batch
    (id,enterprise_id,device_id,device_name_snapshot,line_name_snapshot,worker_no,worker_name_snapshot,worker_user_id,source_kind,created_at)
    VALUES (?,?,?,?,?,?,?,?,'worker',?)`, [session.id, run.enterprise_id, session.device_id,
    device.name || identity.deviceName || '', device.lineName || identity.lineName || '',
    identity.username, identity.name || identity.username, session.user_id, session.started_at || run.created_at])
}

export async function projectWorkerExternalEvent(conn: PoolConnection, session: any, run: any, event: any) {
  await ensureWorkerExternalBatch(conn, session, run)
  // 全局旧原文唯一键与工人「每轮按解析码去重」分别保留；不同轮可审计同一原文。
  const rawHash = createHash('sha256').update('worker:' + run.id + ':' + event.dedup_key).digest('hex')
  if (event.result_state === 'saved') await conn.execute(`INSERT INTO external_trace_code
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
