// 生产任务独立增量结构：不改旧表，不写业务数据。
export const productionDDL = [
  `CREATE TABLE IF NOT EXISTS production_task (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    enterprise_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    batch_id BIGINT NOT NULL,
    name VARCHAR(100) NOT NULL,
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
    PRIMARY KEY (task_id, code_id),
    UNIQUE KEY uq_production_active_code (active_code_id),
    KEY idx_production_code_history (code_id),
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
]
