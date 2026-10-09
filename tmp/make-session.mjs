// 造一个本机验证用的消费者会话（合法签名，等价于微信登录后的 cookie）
// 用途：让本地 dev 通过 requireConsumer，从而真浏览器点「保存」走完整链路
import { createRequire } from 'node:module'
import { createHmac } from 'node:crypto'
import fs from 'node:fs'
const require = createRequire(import.meta.url)
const mysql = require('mysql2/promise')

const SECRET = 'ivg3yVgtzDaH6PFzwcZx7USG8qjsPzAdvHYqKNi8nRTTI9Q8mo7SWvUoDunRNLQI'
const OPENID = 'dev-verify-bill-openid'

const conn = await mysql.createConnection({
  host: '127.0.0.1', port: 3306, user: 'root', password: 'ruijie', database: 'nz315',
})

const [found] = await conn.query('SELECT id FROM consumer WHERE openid = ? LIMIT 1', [OPENID])
let id
if (found.length) {
  id = found[0].id
  console.log('[1] 复用已有验证账号 id =', id)
} else {
  const [r] = await conn.query(
    "INSERT INTO consumer (openid, nickname, status) VALUES (?, '本机验证账号', 1)",
    [OPENID],
  )
  id = r.insertId
  console.log('[1] 新建验证账号 id =', id, '(openid=' + OPENID + ')')
}
await conn.end()

// 与 server/utils/consumer-auth.ts 的 createConsumerToken 同算法
const payload = 'consumer:' + id + '.' + (Date.now() + 30 * 24 * 60 * 60 * 1000)
const sig = createHmac('sha256', SECRET).update(payload).digest('base64url')
const token = Buffer.from(payload).toString('base64url') + '.' + sig

fs.writeFileSync(new URL('./session.json', import.meta.url), JSON.stringify({ consumerId: id, openid: OPENID, token }, null, 2), 'utf8')
console.log('[2] 会话 token 已生成并写入 tmp/session.json，长度 =', token.length)
console.log('[3] 清理方式：DELETE FROM farm_bill WHERE consumer_id=' + id + '; DELETE FROM consumer WHERE id=' + id + ';')
