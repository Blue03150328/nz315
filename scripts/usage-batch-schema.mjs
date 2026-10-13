// 固定上传边界与已用子批次，仅增结构；不创建或重分类任何历史子批次。
export const usageBatchDDL = [
  `CREATE TABLE IF NOT EXISTS production_collection_upload (
    id CHAR(36) PRIMARY KEY, session_id CHAR(36) NOT NULL, task_id BIGINT NOT NULL,
    first_sequence INT NOT NULL, last_sequence INT NULL,
    state VARCHAR(20) NOT NULL DEFAULT 'open',
    owner_user_id BIGINT NOT NULL DEFAULT 0, device_id BIGINT NULL,
    uploader_id BIGINT NULL, uploader_username VARCHAR(50) NULL, uploader_name VARCHAR(100) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME NULL,
    UNIQUE KEY uq_upload_first (session_id,first_sequence),
    KEY idx_upload_task_state (task_id,state),
    CONSTRAINT fk_upload_session FOREIGN KEY (session_id) REFERENCES production_collection_session(id),
    CONSTRAINT fk_upload_task FOREIGN KEY (task_id) REFERENCES production_task(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS code_usage_batch (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, parent_upload_batch_id BIGINT NOT NULL,
    upload_id CHAR(36) NOT NULL, task_id BIGINT NOT NULL,
    spec_name_snapshot VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_usage_upload_root (parent_upload_batch_id,upload_id),
    KEY idx_usage_task (task_id,id),
    CONSTRAINT fk_usage_root FOREIGN KEY (parent_upload_batch_id) REFERENCES upload_batch(id),
    CONSTRAINT fk_usage_upload FOREIGN KEY (upload_id) REFERENCES production_collection_upload(id),
    CONSTRAINT fk_usage_task FOREIGN KEY (task_id) REFERENCES production_task(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
]

export async function migrateUsageBatchSchema(db) {
  for (const ddl of usageBatchDDL) await db.query(ddl)
  for (const [table, column, type] of [
    ['upload_batch', 'spec_name_snapshot', 'VARCHAR(255) NULL'],
    ['production_task', 'production_snapshot', 'JSON NULL'],
    ['trace_code', 'usage_batch_id', 'BIGINT NULL'],
    ['production_collection_event', 'upload_id', 'CHAR(36) NULL'],
  ]) {
    const [columns] = await db.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [table, column])
    if (!columns.length) await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
  for (const [table, name, columns] of [
    ['trace_code', 'idx_usage_codes', '(usage_batch_id,id)'],
    ['production_collection_event', 'idx_collection_upload', '(upload_id,sequence_no)'],
    ['production_collection_event', 'idx_collection_upload_code', '(upload_id,code,result_state)'],
  ]) {
    const [index] = await db.query('SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?', [table, name])
    if (!index.length) await db.query(`ALTER TABLE ${table} ADD KEY ${name} ${columns}`)
  }
}
