/** 完整上传的工人生产会话进入码库；不虚构旧设备会话，不改原生产资料。 */
export async function projectWorkerCodeUsage(conn, sessionId) {
  const [[s]] = await conn.query(`SELECT s.*,r.task_id,r.mode,r.product_id,r.context_json,r.created_at AS run_created_at,r.device_snapshot
    FROM worker_session s JOIN worker_run r ON r.id=s.run_id WHERE s.id=? FOR UPDATE`, [sessionId])
  if (!s || s.mode !== 'production' || !s.task_id || s.state !== 'completed' || s.final_sequence !== s.last_sequence) return
  const identity = typeof s.identity_json === 'string' ? JSON.parse(s.identity_json) : s.identity_json
  const device = typeof s.device_snapshot === 'string' ? JSON.parse(s.device_snapshot) : s.device_snapshot || {}
  const [[existing]] = await conn.query('SELECT id,worker_session_id FROM production_collection_upload WHERE id=? FOR UPDATE', [s.id])
  if (existing && existing.worker_session_id !== s.id) throw Error('工人上传标识与旧上传冲突')
  if (!existing) await conn.execute(`INSERT INTO production_collection_upload
    (id,session_id,worker_session_id,source_kind,task_id,first_sequence,last_sequence,state,owner_user_id,device_id,uploader_id,uploader_username,uploader_name,device_name_snapshot,created_at,completed_at)
    VALUES (?,NULL,?,'worker',?,1,?,'completed',?,?,?,?,?,?,?,?)`,
    [s.id,s.id,s.task_id,s.last_sequence,s.user_id,s.device_id,s.user_id,identity.username,identity.name || identity.username,
      device.name || identity.deviceName || '',s.started_at || s.run_created_at,s.completed_at || new Date()])
  const [roots] = await conn.query(`SELECT DISTINCT c.upload_batch_id AS id,ub.spec_name_snapshot
    FROM worker_event e JOIN trace_code c ON c.code=e.code JOIN upload_batch ub ON ub.id=c.upload_batch_id
    JOIN production_task_code d ON d.code_id=c.id AND d.task_id=? AND d.state='used'
    WHERE e.session_id=? AND (e.result_state='saved' OR e.resolution_state='bound') AND c.usage_batch_id IS NULL`, [s.task_id,s.id])
  for (const root of roots) {
    await conn.execute(`INSERT INTO code_usage_batch(parent_upload_batch_id,upload_id,task_id,spec_name_snapshot)
      VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,[root.id,s.id,s.task_id,root.spec_name_snapshot])
    const [[batch]] = await conn.query('SELECT id FROM code_usage_batch WHERE parent_upload_batch_id=? AND upload_id=?',[root.id,s.id])
    const context = typeof s.context_json === 'string' ? JSON.parse(s.context_json) : s.context_json
    if (context.stockWorkflow) await conn.execute('UPDATE code_usage_batch SET product_id=?,production_snapshot=? WHERE id=?',
      [s.product_id,JSON.stringify({batch_no:context.batchNo,produce_date:context.produceDate,expire_date:context.expireDate}),batch.id])
    await conn.execute(`UPDATE trace_code c JOIN worker_event e ON e.code=c.code AND e.session_id=? AND (e.result_state='saved' OR e.resolution_state='bound')
      JOIN production_task_code d ON d.code_id=c.id AND d.task_id=? AND d.state='used'
      SET c.usage_batch_id=? WHERE c.upload_batch_id=? AND c.usage_batch_id IS NULL`,[s.id,s.task_id,batch.id,root.id])
  }
}

export async function backfillWorkerCodeUsage(db) {
  const [sessions] = await db.query(`SELECT s.id FROM worker_session s JOIN worker_run r ON r.id=s.run_id
    WHERE r.mode='production' AND r.task_id IS NOT NULL AND s.state='completed' AND s.final_sequence=s.last_sequence ORDER BY s.id`)
  for (const session of sessions) {
    await db.beginTransaction()
    try { await projectWorkerCodeUsage(db,session.id); await db.commit() }
    catch (error) { await db.rollback(); throw error }
  }
}
