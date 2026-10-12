import type { PoolConnection } from 'mysql2/promise'
import type { AuthUser } from './auth'
import { collectionId } from '../../shared/utils/collection-input'
import { transaction, lockedTask, productionReviewer } from './production-task'
import { requireUsageBatchSchema } from './usage-batch-schema'

const fail = (message: string, statusCode = 409): never => { throw createError({ statusCode, statusMessage: message }) }
export function uploadIdInput(value: unknown) {
  try { return collectionId(value) } catch { return fail('上传批次标识无效', 400) }
}
function sequenceInput(value: unknown) {
  const sequence = Number(value)
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 10000000) fail('上传序号无效', 400)
  return sequence
}
function sessionOwner(user: AuthUser, session: any) {
  if (user.device_id ? Number(session.device_id) !== user.device_id : session.device_id || (Number(session.user_id) !== user.id && !productionReviewer(user))) fail('不能操作其他采集会话的上传记录', 403)
}
function uploadOwner(user: AuthUser, upload: any) {
  if (user.device_id ? Number(upload.device_id) !== user.device_id : upload.device_id || Number(upload.owner_user_id) !== user.id) fail('请使用本次上传的原账号或设备完成和重试', 403)
}
const resultOf = (row: any) => ({ ok: true, sessionId: row.session_id, uploadId: row.id, firstSequence: Number(row.first_sequence), lastSequence: row.last_sequence === null ? null : Number(row.last_sequence), state: row.state })

export async function startProductionUpload(user: AuthUser, taskId: number, sessionId: string, body: any) {
  await requireUsageBatchSchema()
  const id = uploadIdInput(body.uploadId), first = sequenceInput(body.firstSequence)
  const sid = uploadIdInput(sessionId)
  return transaction(async conn => {
    const task = await lockedTask(conn, user, taskId)
    const [[session]] = await conn.query<any[]>('SELECT * FROM production_collection_session WHERE id=? AND task_id=? FOR UPDATE', [sid, taskId])
    if (!session) fail('采集会话不存在', 404)
    sessionOwner(user, session)
    const [[prior]] = await conn.query<any[]>('SELECT * FROM production_collection_upload WHERE id=? FOR UPDATE', [id])
    if (prior) {
      uploadOwner(user, prior)
      if (prior.session_id !== sid || Number(prior.task_id) !== taskId || Number(prior.first_sequence) !== first) fail('相同上传标识不能用于另一会话或序号范围')
      return resultOf(prior)
    }
    if (task.status !== 'active' || session.state !== 'active') fail('生产任务或采集会话已结束，不能新建上传批次')
    const [[previous]] = await conn.query<any[]>('SELECT * FROM production_collection_upload WHERE session_id=? ORDER BY first_sequence DESC LIMIT 1 FOR UPDATE', [sid])
    if (previous?.last_sequence === null) fail('请先完成上一次上传再开始下一次上传')
    const expected = previous ? Number(previous.last_sequence) + 1 : Number(session.last_sequence) + 1
    if (first !== expected) fail('上传起始序号不连续，请恢复原上传记录并重试')
    await conn.execute('INSERT INTO production_collection_upload(id,session_id,task_id,first_sequence,owner_user_id,device_id,uploader_id,uploader_username,uploader_name) VALUES (?,?,?,?,?,?,?,?,?)', [id, sid, taskId, first, user.device_id ? 0 : user.id, user.device_id || null, user.device_id ? null : user.id, user.device_id ? null : user.username, user.device_id ? null : user.name])
    return resultOf({ id, session_id: sid, first_sequence: first, last_sequence: null, state: 'open' })
  })
}

/** 上传身份和边界一经登记不能更换；完成后仅允许读取原序号的收据。 */
export async function lockedProductionUpload(conn: PoolConnection, user: AuthUser, taskId: number, sessionId: string, uploadId: string, sequence: number) {
  const [[upload]] = await conn.query<any[]>('SELECT * FROM production_collection_upload WHERE id=? AND task_id=? AND session_id=? FOR UPDATE', [uploadId, taskId, sessionId])
  if (!upload) fail('上传批次尚未登记，请先恢复本次上传', 404)
  uploadOwner(user, upload)
  if (sequence < Number(upload.first_sequence) || (upload.last_sequence !== null && sequence > Number(upload.last_sequence))) fail('事件超出本次上传的固定序号范围')
  return upload
}

/** accepted 收据、码绑定和固定子批归属共用调用者事务，重复上传不改归属。 */
export async function assignUsageBatch(conn: PoolConnection, upload: any, code: string) {
  const [[row]] = await conn.query<any[]>('SELECT id,upload_batch_id,usage_batch_id FROM trace_code WHERE code=?', [code])
  if (!row?.upload_batch_id) fail('追溯码缺少原始码批次，无法建立使用子批次')
  if (row.usage_batch_id) fail('追溯码已有固定使用子批次，不得重新分类')
  const [[root]] = await conn.query<any[]>('SELECT spec_name_snapshot FROM upload_batch WHERE id=?', [row.upload_batch_id])
  const [insert]: any = await conn.execute('INSERT INTO code_usage_batch(parent_upload_batch_id,upload_id,task_id,spec_name_snapshot) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)', [row.upload_batch_id, upload.id, upload.task_id, root?.spec_name_snapshot || null])
  const childId = Number(insert.insertId)
  const [changed]: any = await conn.execute('UPDATE trace_code SET usage_batch_id=? WHERE id=? AND usage_batch_id IS NULL', [childId, row.id])
  if (Number(changed.affectedRows) !== 1) fail('追溯码子批次归属已变化，请读取原上传收据')
  return childId
}

export async function completeProductionUpload(user: AuthUser, taskId: number, sessionId: string, uploadId: string, body: any) {
  await requireUsageBatchSchema()
  const id = uploadIdInput(uploadId), sid = uploadIdInput(sessionId), last = sequenceInput(body.lastSequence)
  return transaction(async conn => {
    await lockedTask(conn, user, taskId)
    const [[session]] = await conn.query<any[]>('SELECT * FROM production_collection_session WHERE id=? AND task_id=? FOR UPDATE', [sid, taskId])
    if (!session) fail('采集会话不存在', 404)
    sessionOwner(user, session)
    const upload = await lockedProductionUpload(conn, user, taskId, sid, id, last)
    if (upload.last_sequence !== null && Number(upload.last_sequence) !== last) fail('完成上传的序号上界不能更改')
    const [[counts]] = await conn.query<any[]>('SELECT COUNT(*) AS n,MAX(sequence_no) AS maximum FROM production_collection_event WHERE upload_id=?', [id])
    if (Number(counts.maximum || 0) > last) fail('完成序号不能小于已经上传的序号')
    const expected = last - Number(upload.first_sequence) + 1
    const pending = Math.max(0, expected - Number(counts.n))
    const state = pending ? 'closing' : 'completed'
    await conn.execute('UPDATE production_collection_upload SET last_sequence=?,state=?,completed_at=IF(?=\'completed\',COALESCE(completed_at,NOW()),NULL) WHERE id=?', [last, state, state, id])
    return { ...resultOf({ ...upload, last_sequence: last, state }), pending }
  })
}
