// 本机验证准备：探测 MySQL 连通性 + 找一个可用的消费者账号
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const mysql = require('mysql2/promise')

const conn = await mysql.createConnection({
  host: '127.0.0.1', port: 3306, user: 'root', password: 'ruijie', database: 'nz315',
})
console.log('[1] MySQL 连接成功')

const [tables] = await conn.query("SHOW TABLES LIKE 'consumer'")
console.log('[2] consumer 表存在:', tables.length > 0)

const [cols] = await conn.query(
  "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='nz315' AND TABLE_NAME='consumer' ORDER BY ORDINAL_POSITION",
)
console.log('[3] consumer 列:', cols.map(c => c.COLUMN_NAME + '(' + c.COLUMN_TYPE + ',' + (c.IS_NULLABLE === 'YES' ? 'null' : 'notnull') + ')').join(' '))

const [rows] = await conn.query('SELECT id, openid, nickname, status FROM consumer ORDER BY id LIMIT 10')
console.log('[4] consumer 现有记录数:', rows.length)
for (const r of rows) console.log('    id=' + r.id, 'openid=' + r.openid, 'nickname=' + r.nickname, 'status=' + r.status)

const [fb] = await conn.query(
  "SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='nz315' AND TABLE_NAME='farm_bill' AND COLUMN_NAME IN ('total_amount','store_name','dosage')",
)
console.log('[5] farm_bill 关键列:', fb.map(c => c.COLUMN_NAME + '=' + c.COLUMN_TYPE).join(' '))

const [billCnt] = await conn.query('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM farm_bill')
console.log('[6] farm_bill 现有条数:', billCnt[0].n, '最后写入:', billCnt[0].last)

await conn.end()
