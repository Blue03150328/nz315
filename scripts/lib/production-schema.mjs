// 生产绑定与更正的增量结构；只增加字段和表，不改写历史生产资料。
export async function migrateProductionSchema(conn) {
  const [columns] = await conn.query("SHOW COLUMNS FROM trace_code LIKE 'production_override'");
  if (!columns.length) await conn.query('ALTER TABLE trace_code ADD COLUMN production_override JSON NULL');
  await conn.query(`CREATE TABLE IF NOT EXISTS production_operation (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    request_key VARCHAR(64) NOT NULL,
    enterprise_id BIGINT NOT NULL,
    actor_id BIGINT NOT NULL,
    reviewer_id BIGINT NULL,
    kind VARCHAR(24) NOT NULL,
    scope_id BIGINT NOT NULL,
    status VARCHAR(16) NOT NULL,
    payload JSON NOT NULL,
    result JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME NULL,
    UNIQUE KEY uq_actor_request (actor_id, request_key),
    KEY idx_enterprise_status (enterprise_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await conn.query(`CREATE TABLE IF NOT EXISTS production_change (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    operation_id BIGINT NOT NULL,
    code_id BIGINT NULL,
    before_value JSON NOT NULL,
    after_value JSON NOT NULL,
    KEY idx_operation (operation_id),
    KEY idx_code (code_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
