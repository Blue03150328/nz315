// 设备采集会话与逐条收据：只增加结构，不写入业务演示数据。
export const collectionDDL = [
  `CREATE TABLE IF NOT EXISTS production_collection_session (
    id CHAR(36) PRIMARY KEY,
    task_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    device VARCHAR(100) NOT NULL,
    line_snapshot VARCHAR(100) NOT NULL,
    context_hash CHAR(64) NOT NULL,
    context_json JSON NOT NULL,
    state VARCHAR(20) NOT NULL DEFAULT 'active',
    last_sequence INT NOT NULL DEFAULT 0,
    accepted_count INT NOT NULL DEFAULT 0,
    duplicate_count INT NOT NULL DEFAULT 0,
    rejected_count INT NOT NULL DEFAULT 0,
    completion_result JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    KEY idx_collection_task_state (task_id,state),
    CONSTRAINT fk_collection_task FOREIGN KEY (task_id) REFERENCES production_task(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS production_collection_event (
    event_id CHAR(36) PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    sequence_no INT NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    code CHAR(32) NULL,
    raw_code TEXT NOT NULL,
    event_kind VARCHAR(20) NOT NULL,
    result_state VARCHAR(20) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    captured_at DATETIME(3) NOT NULL,
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_collection_sequence (session_id,sequence_no),
    KEY idx_collection_anomaly (session_id,result_state),
    CONSTRAINT fk_collection_event_session FOREIGN KEY (session_id) REFERENCES production_collection_session(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
]
