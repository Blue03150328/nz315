// 只增加产线协调与设备心跳结构，不改已有任务、码或采集资料。
export async function migrateProductionMonitorSchema(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS production_line_runtime (
    enterprise_id BIGINT NOT NULL,line_key CHAR(64) NOT NULL,line_name VARCHAR(100) NOT NULL,
    current_task_id BIGINT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY(enterprise_id,line_key),KEY idx_line_task(current_task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  const [supervisor]=await db.query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='production_line_runtime' AND COLUMN_NAME='supervisor_name'")
  if(!supervisor.length)await db.query("ALTER TABLE production_line_runtime ADD COLUMN supervisor_name VARCHAR(100) NOT NULL DEFAULT ''")
  for (const [name, definition] of [
    ['heartbeat_ms','BIGINT NULL'],['report_version','BIGINT NOT NULL DEFAULT 0'],
    ['capture_state',"VARCHAR(20) NULL"],['reported_sequence','BIGINT NULL'],
    ['local_valid','BIGINT NULL'],['local_duplicate','BIGINT NULL'],['local_exception','BIGINT NULL'],['local_pending','BIGINT NULL'],
  ]) {
    const [found]=await db.query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='worker_session' AND COLUMN_NAME=?",[name])
    if(!found.length) await db.query(`ALTER TABLE worker_session ADD COLUMN ${name} ${definition}`)
  }
}
