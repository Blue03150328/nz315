// 只在独立临时数据库测试增量同步、真实失败回滚与并发锁，不修改nz315业务资料。
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { randomUUID } from 'node:crypto'
import { loadLocalDbConfig } from '../scripts/sync-alpha-prices.mjs'
import { ensureAlphaTables } from '../scripts/alpha-sync/schema.mjs'
import { PRODUCT_HEADERS, normalizeSnapshot, applySnapshot, hash } from '../scripts/alpha-sync/core.mjs'

const config = await loadLocalDbConfig()
const database = `nz315_alpha_test_${randomUUID().replaceAll('-', '')}`
const admin = await mysql.createConnection(config)
let conn, second
let passed = 0
const product = (sku, sale = '1.00') => ({ ...Object.fromEntries(PRODUCT_HEADERS.map(header => [header, ''])),
  '商品ID': '10', '商品名称': '同步测试商品', 'SKU ID': sku, '销售价': sale })
const listing = (shop = '20') => ({ '店铺ID': shop, '店铺名称': '同步测试店铺', '商品ID': '10', '商品名称': '同步测试商品' })
const metadata = (date, content) => ({ date, file: `阿尔法农资全平台产品价格表_${date}.xlsx`, sha256: hash(content) })
const mark = label => { passed++; console.log(`通过：${label}`) }

try {
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`)
  conn = await mysql.createConnection({ ...config, database })
  second = await mysql.createConnection({ ...config, database })
  await conn.query("SET time_zone='+00:00'")
  await ensureAlphaTables(conn)
  const first = normalizeSnapshot([product('100'), product('101')], [listing()])
  const firstMeta = metadata('2026-10-01', '第一份')
  let result = await applySnapshot(conn, first, firstMeta)
  assert.equal(result.inserted, 2)
  mark('首次导入两条规格和店铺关系')

  result = await applySnapshot(conn, first, firstMeta)
  assert.equal(result.status, 'skipped')
  const [[{ count }]] = await conn.query('SELECT COUNT(*) AS count FROM alpha_sync_run')
  assert.equal(count, 1)
  mark('同一文件重试不重复写入或推进周期')

  const changed = normalizeSnapshot([product('100', '2.00'), product('101'), product('102')], [listing()])
  result = await applySnapshot(conn, changed, metadata('2026-10-02', '第二份'))
  assert.deepEqual([result.inserted, result.updated, result.unchanged], [1, 1, 1])
  const [[price]] = await conn.query("SELECT sale_price FROM alpha_product_price WHERE sku_id='100'")
  assert.equal(price.sale_price, '2.0000')
  mark('新增、价格变更、未变化分别计数且金额正确')

  await conn.query(`CREATE TRIGGER alpha_test_failure BEFORE INSERT ON alpha_shop_listing FOR EACH ROW
    BEGIN IF NEW.shop_id='999' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='测试事务失败'; END IF; END`)
  await assert.rejects(() => applySnapshot(conn,
    normalizeSnapshot([product('100', '9.00'), product('101'), product('102')], [listing('999')]),
    metadata('2026-10-03', '事务失败')), /测试事务失败/)
  const [[rolledBack]] = await conn.query("SELECT sale_price FROM alpha_product_price WHERE sku_id='100'")
  const [[runs]] = await conn.query('SELECT COUNT(*) AS count FROM alpha_sync_run')
  assert.equal(rolledBack.sale_price, '2.0000')
  assert.equal(runs.count, 2)
  mark('店铺表真实失败时价格及成功日期一起回滚')

  await assert.rejects(() => applySnapshot(conn, first, metadata('2026-09-30', '旧文件')), /旧采集/)
  await assert.rejects(() => applySnapshot(conn,
    normalizeSnapshot([product('100')], [listing()]), metadata('2026-10-04', '残缺文件')), /减少超过40%/)
  mark('旧资料和明显残缺采集拒绝覆盖')

  result = await applySnapshot(conn, normalizeSnapshot([product('100'), product('101')], [listing()]),
    metadata('2026-10-05', '第三份'))
  const [[missing]] = await conn.query("SELECT present_in_latest FROM alpha_product_price WHERE sku_id='102'")
  assert.equal(missing.present_in_latest, 0)
  assert.equal(result.missing, 1)
  mark('本轮消失规格保留原资料，只标记未出现')

  const lockName = `${database}:lock`
  const [[acquired]] = await conn.query('SELECT GET_LOCK(?,0) AS value', [lockName])
  const [[blocked]] = await second.query('SELECT GET_LOCK(?,0) AS value', [lockName])
  assert.equal(acquired.value, 1)
  assert.equal(blocked.value, 0)
  await conn.query('SELECT RELEASE_LOCK(?)', [lockName])
  mark('独立连接并发锁阻止重叠同步')
  console.log(JSON.stringify({ passed, databaseIsolated: true }))
} finally {
  if (second) await second.end()
  if (conn) await conn.end()
  // 名称在本脚本生成且只含固定前缀与UUID，绝不删除业务数据库。
  if (!/^nz315_alpha_test_[a-f0-9]{32}$/.test(database)) throw new Error('临时库名称安全校验失败')
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``)
  await admin.end()
}
