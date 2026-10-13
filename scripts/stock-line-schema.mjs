// 生产线任务不再固定产品，历史产品与码归属保留。
export async function migrateStockLineSchema(db) {
  const [rows] = await db.query("SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='production_task' AND COLUMN_NAME='product_id'")
  if (rows[0]?.IS_NULLABLE === 'NO') await db.query('ALTER TABLE production_task MODIFY product_id BIGINT NULL')
  for (const [column, definition] of [['product_id', 'BIGINT NULL'], ['production_snapshot', 'JSON NULL']]) {
    const [found] = await db.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?', ['code_usage_batch', column])
    if (!found.length) await db.query(`ALTER TABLE code_usage_batch ADD COLUMN ${column} ${definition}`)
  }
}
