// 清理本机验证产生的测试数据（只删本次造的 consumer 及其账单）
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const mysql = require('mysql2/promise')

const conn = await mysql.createConnection({
  host: '127.0.0.1', port: 3306, user: 'root', password: 'ruijie', database: 'nz315',
})

const [b] = await conn.query('DELETE FROM farm_bill WHERE consumer_id = 10')
console.log('[1] 删除测试账单行数:', b.affectedRows)
const [c] = await conn.query("DELETE FROM consumer WHERE id = 10 AND openid = 'dev-verify-bill-openid'")
console.log('[2] 删除测试消费者行数:', c.affectedRows)

const [fb] = await conn.query('SELECT COUNT(*) AS n FROM farm_bill')
const [cc] = await conn.query('SELECT COUNT(*) AS n FROM consumer')
console.log('[3] 残留检查 farm_bill =', fb[0].n, ', consumer =', cc[0].n, '(应均为 0)')
await conn.end()
