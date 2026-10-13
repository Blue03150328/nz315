// 外部采集独立三表，仅建表，不回填或改动既有业务数据。
export const externalCollectionDDL = [
  `CREATE TABLE IF NOT EXISTS external_collection_batch (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    enterprise_id BIGINT NOT NULL, device_id BIGINT NOT NULL,
    device_name_snapshot VARCHAR(100) NOT NULL, line_name_snapshot VARCHAR(100) NOT NULL,
    worker_no VARCHAR(64) NOT NULL, state VARCHAR(20) NOT NULL DEFAULT 'active',
    last_sequence INT NOT NULL DEFAULT 0, accepted_count INT NOT NULL DEFAULT 0,
    duplicate_count INT NOT NULL DEFAULT 0, rejected_count INT NOT NULL DEFAULT 0,
    product_id BIGINT NULL, product_name_snapshot VARCHAR(200) NULL,
    batch_no VARCHAR(100) NULL, produce_date DATE NULL, production_quantity INT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), completed_at DATETIME(3) NULL,
    metadata_updated_at DATETIME(3) NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    KEY idx_external_batch_enterprise(enterprise_id,created_at,id),
    KEY idx_external_batch_device(device_id,state), KEY idx_external_batch_number(enterprise_id,batch_no)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS external_trace_code (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, enterprise_id BIGINT NOT NULL,
    batch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    raw_code MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    raw_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sequence_no INT NOT NULL, captured_at DATETIME(3) NOT NULL,
    received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_external_code_enterprise_hash(enterprise_id,raw_hash),
    UNIQUE KEY uq_external_code_batch_sequence(batch_id,sequence_no),
    KEY idx_external_code_enterprise(enterprise_id,id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS external_collection_event (
    batch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sequence_no INT NOT NULL, event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    result_state VARCHAR(20) NOT NULL, reason VARCHAR(255) NOT NULL DEFAULT '',
    captured_at DATETIME(3) NOT NULL, received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY(batch_id,sequence_no), UNIQUE KEY uq_external_event_id(event_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
]

export async function migrateExternalCollectionSchema(db) {
  for (const ddl of externalCollectionDDL) await db.query(ddl)
  for (const [column, type] of [
    ['source_kind', "VARCHAR(20) NOT NULL DEFAULT 'legacy'"],
    ['worker_user_id', 'BIGINT NULL'],
    ['worker_name_snapshot', 'VARCHAR(100) NULL'],
  ]) {
    const [found] = await db.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', ['external_collection_batch', column])
    if (!found.length) await db.query(`ALTER TABLE external_collection_batch ADD COLUMN ${column} ${type}`)
  }
}
