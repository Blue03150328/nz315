/** 将既有工人外码投影到管理表；不改工人事件、原收据或生产码。可重复执行。 */
export async function backfillWorkerExternal(db) {
  await db.beginTransaction()
  try {
    await db.query(`INSERT INTO external_collection_batch
      (id,enterprise_id,device_id,device_name_snapshot,line_name_snapshot,worker_no,worker_name_snapshot,worker_user_id,source_kind,state,last_sequence,accepted_count,duplicate_count,rejected_count,created_at,completed_at)
      SELECT s.id,r.enterprise_id,s.device_id,
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.device_snapshot,'$.name')),JSON_UNQUOTE(JSON_EXTRACT(s.identity_json,'$.deviceName')),''),
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.device_snapshot,'$.lineName')),JSON_UNQUOTE(JSON_EXTRACT(s.identity_json,'$.lineName')),''),
        JSON_UNQUOTE(JSON_EXTRACT(s.identity_json,'$.username')),JSON_UNQUOTE(JSON_EXTRACT(s.identity_json,'$.name')),s.user_id,'worker',
        IF(s.state='completed' AND s.final_sequence=s.last_sequence,'completed','active'),s.last_sequence,
        (SELECT COUNT(*) FROM worker_event e WHERE e.session_id=s.id AND e.result_state='saved'),
        (SELECT COUNT(*) FROM worker_event e WHERE e.session_id=s.id AND e.result_state='duplicate'),
        (SELECT COUNT(*) FROM worker_event e WHERE e.session_id=s.id AND e.result_state NOT IN ('saved','duplicate')),
        COALESCE(s.started_at,r.created_at),IF(s.state='completed' AND s.final_sequence=s.last_sequence,COALESCE(s.completed_at,r.ended_at,NOW(3)),NULL)
      FROM worker_session s JOIN worker_run r ON r.id=s.run_id
      WHERE r.mode='external' AND NOT EXISTS(SELECT 1 FROM external_collection_batch b WHERE b.id=s.id)`)
    await db.query(`INSERT INTO external_trace_code(enterprise_id,batch_id,raw_code,raw_hash,sequence_no,captured_at,received_at)
      SELECT r.enterprise_id,s.id,e.raw_code,SHA2(CONCAT('worker:',r.id,':',e.dedup_key),256),e.sequence_no,e.captured_at,e.received_at
      FROM worker_event e JOIN worker_session s ON s.id=e.session_id JOIN worker_run r ON r.id=s.run_id
      JOIN external_collection_batch b ON b.id=s.id AND b.source_kind='worker'
      WHERE r.mode='external' AND e.result_state='saved'
        AND NOT EXISTS(SELECT 1 FROM external_trace_code c WHERE c.batch_id=s.id AND c.sequence_no=e.sequence_no)`)
    await db.query(`INSERT INTO external_collection_event(batch_id,sequence_no,event_id,payload_hash,result_state,reason,captured_at,received_at)
      SELECT s.id,e.sequence_no,e.id,e.payload_hash,CASE e.result_state WHEN 'saved' THEN 'accepted' WHEN 'duplicate' THEN 'duplicate' ELSE 'rejected' END,
        LEFT(e.reason,255),e.captured_at,e.received_at
      FROM worker_event e JOIN worker_session s ON s.id=e.session_id JOIN worker_run r ON r.id=s.run_id
      JOIN external_collection_batch b ON b.id=s.id AND b.source_kind='worker'
      WHERE r.mode='external' AND NOT EXISTS(SELECT 1 FROM external_collection_event x WHERE x.event_id=e.id)`)
    await db.commit()
  } catch (error) { await db.rollback(); throw error }
}
