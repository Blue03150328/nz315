// 生产任务独立增量结构：不改旧表，不写业务数据。
export const productionDDL = [
  `CREATE TABLE IF NOT EXISTS production_task (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    enterprise_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    batch_id BIGINT NOT NULL,
    name VARCHAR(100) NOT NULL,
    line_name VARCHAR(100) NOT NULL DEFAULT '',
    request_id CHAR(36) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    created_by BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME NULL,
    reviewed_at DATETIME NULL,
    UNIQUE KEY uq_production_request (created_by, request_id),
    KEY idx_production_enterprise (enterprise_id, id),
    CONSTRAINT fk_production_batch FOREIGN KEY (batch_id) REFERENCES batch(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS production_task_code (
    task_id BIGINT NOT NULL,
    code_id BIGINT NOT NULL,
    active_code_id BIGINT NULL COMMENT '领用及已用码持有唯一占用，剩余码批准后置空',
    code CHAR(32) NOT NULL,
    state VARCHAR(20) NOT NULL DEFAULT 'reserved',
    used_by BIGINT NULL,
    device VARCHAR(100) NULL,
    used_at DATETIME NULL,
    released_at DATETIME NULL,
    used_line VARCHAR(100) NULL,
    source_task_id BIGINT NULL,
    allocation_id BIGINT NULL,
    PRIMARY KEY (task_id, code_id),
    UNIQUE KEY uq_production_active_code (active_code_id),
    KEY idx_production_code_history (code_id),
    KEY idx_production_allocation (code_id, allocation_id),
    CONSTRAINT fk_production_detail_task FOREIGN KEY (task_id) REFERENCES production_task(id),
    CONSTRAINT fk_production_detail_code FOREIGN KEY (code_id) REFERENCES trace_code(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS production_task_review (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_id BIGINT NOT NULL,
    reviewer_id BIGINT NOT NULL,
    decision VARCHAR(20) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    remaining_count INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_production_review_task (task_id, id),
    CONSTRAINT fk_production_review_task FOREIGN KEY (task_id) REFERENCES production_task(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS production_task_change (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_id BIGINT NOT NULL,
    actor_id BIGINT NOT NULL,
    action VARCHAR(20) NOT NULL,
    request_id CHAR(36) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    detail JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_production_change_request (task_id, actor_id, request_id),
    CONSTRAINT fk_production_change_task FOREIGN KEY (task_id) REFERENCES production_task(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
]

/** 只增补生产任务字段，不回填或修改历史业务数据。 */
export async function migrateProductionSchema(db) {
  for (const [table, column, type] of [
    ['production_task', 'line_name', "VARCHAR(100) NOT NULL DEFAULT ''"],
    ['production_task_code', 'used_line', 'VARCHAR(100) NULL'],
    ['production_task_code', 'source_task_id', 'BIGINT NULL'],
    ['production_task_code', 'allocation_id', 'BIGINT NULL'],
  ]) {
    const [rows] = await db.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', [table, column])
    if (!rows.length) await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
  const [index] = await db.query("SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='production_task_code' AND INDEX_NAME='idx_production_allocation'")
  if (!index.length) await db.query('ALTER TABLE production_task_code ADD KEY idx_production_allocation (code_id,allocation_id)')
}
