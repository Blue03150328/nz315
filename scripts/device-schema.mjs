// 专用增量迁移：不更改历史生产数据。
export const deviceDDL = [
  `CREATE TABLE IF NOT EXISTS production_device (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, enterprise_id BIGINT NOT NULL,
    name VARCHAR(100) NOT NULL, line_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', instance_id CHAR(36) NULL,
    credential_hash CHAR(64) NULL, model VARCHAR(100) NULL, android_id VARCHAR(100) NULL,
    reported_pending INT NULL, last_seen_at DATETIME NULL, last_sync_at DATETIME NULL,
    created_by BIGINT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at DATETIME NULL, UNIQUE KEY uq_device_instance(instance_id),
    UNIQUE KEY uq_device_credential(credential_hash), KEY idx_device_enterprise(enterprise_id,id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS production_device_activation (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, device_id BIGINT NOT NULL,
    token_hash CHAR(64) NOT NULL, expires_at DATETIME NOT NULL,
    consumed_at DATETIME NULL, revoked_at DATETIME NULL,
    instance_id CHAR(36) NULL, credential_hash CHAR(64) NULL,
    created_by BIGINT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_activation_token(token_hash), KEY idx_activation_device(device_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS production_device_change (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, device_id BIGINT NOT NULL,
    actor_id BIGINT NULL, action VARCHAR(30) NOT NULL, detail JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_device_change(device_id,id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
]
export async function migrateDeviceSchema(db) {
  for (const ddl of deviceDDL) await db.query(ddl)
  const [columns] = await db.query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='production_collection_session' AND COLUMN_NAME='device_id'")
  if (!columns.length) await db.query('ALTER TABLE production_collection_session ADD COLUMN device_id BIGINT NULL, ADD KEY idx_collection_device(device_id,state)')
}
