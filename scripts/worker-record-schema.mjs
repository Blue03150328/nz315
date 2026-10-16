export async function migrateWorkerRecordSchema(db) {
 await db.query(`CREATE TABLE IF NOT EXISTS worker_action(
 id CHAR(36) PRIMARY KEY,session_id CHAR(36) NOT NULL,sequence_no INT NOT NULL,
 kind VARCHAR(12) NOT NULL,captured_at DATETIME(3) NOT NULL,
 received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),payload_hash CHAR(64) NOT NULL,
 UNIQUE KEY uq_worker_action_sequence(session_id,sequence_no),
 FOREIGN KEY(session_id) REFERENCES worker_session(id)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
}
