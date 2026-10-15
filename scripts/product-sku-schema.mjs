// SKU 唯一性只约束同厂家、登记证号、规格和商标；不改任何历史产品或码归属。
export async function migrateProductSkuSchema(db) {
  const [[lock]] = await db.query("SELECT GET_LOCK(CONCAT(DATABASE(), ':product-sku-schema'), 30) AS acquired")
  if (Number(lock.acquired) !== 1) throw Error('产品规格结构正在更新，请稍后重试')
  try {
    const [columns] = await db.query("SHOW COLUMNS FROM product LIKE 'sku_trademark'")
    const [indexes] = await db.query('SHOW INDEX FROM product')
    const sku = indexes.filter(row => row.Key_name === 'uq_product_sku').sort((a, b) => a.Seq_in_index - b.Seq_in_index)
    if (sku.length && (sku.some(row => row.Non_unique) || sku.map(row => row.Column_name).join(',') !== 'enterprise_id,registration_no,spec_id,sku_trademark')) throw Error('uq_product_sku 索引结构异常，未修改数据库')
    const old = [...new Set(indexes.filter(row => !row.Non_unique && row.Key_name !== 'PRIMARY').map(row => row.Key_name))]
      .filter(name => { const rows = indexes.filter(row => row.Key_name === name); return rows.length === 1 && rows[0].Column_name === 'registration_no' })
    const clauses = []
    if (!columns.length) clauses.push("ADD COLUMN sku_trademark VARCHAR(100) GENERATED ALWAYS AS (TRIM(COALESCE(trademark, ''))) VIRTUAL")
    if (!sku.length) {
      const [duplicates] = await db.query("SELECT id FROM product WHERE spec_id IS NOT NULL AND (enterprise_id, registration_no, spec_id, TRIM(COALESCE(trademark, ''))) IN (SELECT enterprise_id, registration_no, spec_id, TRIM(COALESCE(trademark, '')) FROM product WHERE spec_id IS NOT NULL GROUP BY enterprise_id, registration_no, spec_id, TRIM(COALESCE(trademark, '')) HAVING COUNT(*) > 1) LIMIT 1")
      if (duplicates.length) throw Error('已有同厂家、登记证号、规格、商标重复的产品，请先核对；未合并或删除数据')
      clauses.push('ADD UNIQUE KEY uq_product_sku (enterprise_id, registration_no, spec_id, sku_trademark)')
    }
    if (!indexes.some(row => row.Column_name === 'registration_no' && row.Seq_in_index === 1 && row.Non_unique)) clauses.push('ADD KEY idx_product_registration (registration_no)')
    for (const name of old) clauses.push('DROP INDEX `' + name.replaceAll('`', '``') + '`')
    // 一个 ALTER 同时增加新约束并移除旧约束，避免失去唯一性保护的中间状态。
    if (clauses.length) await db.query('ALTER TABLE product ' + clauses.join(', '))
  } finally {
    await db.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':product-sku-schema'))")
  }
}
