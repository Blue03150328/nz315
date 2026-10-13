// 保留旧任务、码池与未完成队列；新任务延后由工人建立生产批次。
export async function migrateLineSchema(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS production_task_member(task_id BIGINT NOT NULL,user_id BIGINT NOT NULL,added_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),removed_at DATETIME(3) NULL,PRIMARY KEY(task_id,user_id),KEY ix_task_member(user_id,removed_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  const [batch] = await db.query("SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='production_task' AND COLUMN_NAME='batch_id'")
  if (batch[0]?.IS_NULLABLE === 'NO') await db.query('ALTER TABLE production_task MODIFY batch_id BIGINT NULL')
  for (const [table, column, definition] of [
    ['production_task','workflow',"VARCHAR(20) NOT NULL DEFAULT 'legacy'"],
    ['production_task','draft_qc_result','TINYINT NULL'],
    ['production_task','draft_quality_cert_no','VARCHAR(100) NULL'],
    ['production_task','records_confirmed_by','BIGINT NULL'],
    ['production_task','records_confirmed_at','DATETIME NULL'],
    ['production_task','source_upload_id','BIGINT NULL'],
    ['worker_session','started_at','DATETIME(3) NULL'],
    ['worker_session','stopped_at','DATETIME(3) NULL'],
    ['worker_session','completed_at','DATETIME(3) NULL'],
    ['worker_session','started_ms','BIGINT NULL'],
    ['worker_session','stopped_ms','BIGINT NULL'],
    ['worker_run','task_id','BIGINT NULL'],
    ['worker_run','file_end_sessions','JSON NULL'],
    ['worker_event','resolution_state','VARCHAR(20) NULL'],
    ['worker_event','resolution_reason','VARCHAR(500) NULL'],
    ['worker_event','resolved_by','BIGINT NULL'],
    ['worker_event','resolved_at','DATETIME NULL'],
  ]) {
    const [found] = await db.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column])
    if (!found.length) await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
  const [index] = await db.query("SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='worker_run' AND INDEX_NAME='ix_worker_task'")
  if (!index.length) await db.query('ALTER TABLE worker_run ADD INDEX ix_worker_task(task_id,state)')
}
