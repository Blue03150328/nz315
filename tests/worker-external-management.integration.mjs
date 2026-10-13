import fs from 'node:fs'
import assert from 'node:assert/strict'
import { parseEnv } from 'node:util'
import { randomUUID, randomBytes } from 'node:crypto'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import { backfillWorkerExternal } from '../scripts/backfill-worker-external.mjs'
const env = parseEnv(fs.readFileSync(process.env.NZ315_TEST_ENV || '.env', 'utf8'))
assert.equal(env.DB_HOST, '127.0.0.1')
assert.match(process.env.NZ315_TEST_DB || '', /^pda_worker_test_\d+$/)
const base = process.env.NZ315_TEST_URL || 'http://127.0.0.1:38125'
assert.equal(new URL(base).hostname, '127.0.0.1')
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: process.env.NZ315_TEST_DB })
const password = randomBytes(16).toString('hex'), tag = randomBytes(6).toString('hex')
let checks = 0
async function request(url, auth, body, method = body === undefined ? 'GET' : 'POST') {
  const headers = { 'Content-Type': 'application/json' }
  if (auth?.startsWith('nz315_user=')) headers.Cookie = auth
  else if (auth) headers.Authorization = 'Bearer ' + auth
  const response = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text(); let data; try { data = JSON.parse(text) } catch { data = text }
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] }
}
function ok(r) { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data }
async function check(name, work) { await work(); console.log('通过：' + name); checks++ }
async function user(role, ent) {
  const username = role.slice(0, 8) + tag + randomBytes(2).toString('hex')
  const [r] = await db.execute('INSERT INTO user(username,password,name,role,enterprise_id,status) VALUES(?,?,?,?,?,1)', [username, await bcrypt.hash(password, 4), '外码工人', role, ent])
  return { id: r.insertId, username }
}
try {
  const [e] = await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES(?,'2099-12-31',1)", ['外码对接验收' + tag])
  const admin = await user('enterprise_admin', e.insertId), worker = await user('production_operator', e.insertId)
  const cookie = (await request('/api/auth/login', '', { username: admin.username, password })).cookie
  const registered = ok(await request('/api/admin/production-devices', cookie, { name: '外码设备', lineName: '三号线' }))
  const activation = JSON.parse(Buffer.from(registered.activationCode.slice(13), 'base64url')), secret = randomBytes(32).toString('hex')
  ok(await request('/api/device/activate', '', { token: activation.token, credential: secret, instanceId: randomUUID(), model: 'isolated' }))
  const grant = ok(await request('/api/device/operator/login', secret, { username: worker.username, password }))
  const runId = randomUUID(), sessionId = randomUUID()
  ok(await request('/api/device/worker-sessions', secret, { runId, sessionId, context: { mode: 'external' }, grant: grant.grant, startedAt: new Date().toISOString() }))
  const code = '00000000000000000000000000000001', raw = '  https://外码.test/q?code=' + code + '&name=产品\n原文  '
  const events = [raw, 'half?anything=' + code, '外厂任意字符串'].map((rawCode, i) => ({ eventId: randomUUID(), sequence: i + 1, rawCode, kind: 'valid', capturedAt: new Date().toISOString() }))
  let result
  await check('工人外码事务进入管理表，原文与可信姓名工号设备保持完整', async () => {
    result = ok(await request('/api/device/worker-sessions/' + sessionId + '/events', secret, { events }))
    assert.deepEqual(result.receipts.map(x => x.state), ['saved', 'duplicate', 'saved'])
    const detail = ok(await request('/api/admin/external-collections/' + sessionId, cookie))
    assert.equal(detail.batch.accepted_count, 2); assert.equal(detail.batch.duplicate_count, 1)
    assert.equal(detail.batch.worker_user_id, worker.id); assert.equal(detail.batch.worker_no, worker.username)
    assert.equal(detail.batch.worker_name_snapshot, '外码工人'); assert.equal(detail.rows[0].raw_code, raw)
  })
  await check('响应丢失重传不重复入库，旧接口不能修改工人管理批次', async () => {
    assert.deepEqual(ok(await request('/api/device/worker-sessions/' + sessionId + '/events', secret, { events })), result)
    assert.equal((await request('/api/device/external-collections/' + sessionId + '/events', secret, { events })).status, 403)
    assert.equal((await request('/api/device/worker-sessions/' + sessionId + '/complete', secret, { lastSequence: 4 })).status, 409)
    assert.equal((await request('/api/admin/external-collections', secret)).status, 401)
  })
  await check('完整结束后管理页面可补资料和鉴权导出完整原文', async () => {
    ok(await request('/api/device/worker-sessions/' + sessionId + '/complete', secret, { lastSequence: 3, stoppedAt: new Date().toISOString() }))
    ok(await request('/api/device/worker-runs/' + runId + '/complete', secret, { sessions: [{ id: sessionId, lastSequence: 3 }] }))
    const list = ok(await request('/api/admin/external-codes?batchId=' + sessionId, cookie)); assert.equal(list.total, 2)
    const txt = ok(await request('/api/admin/external-collections/' + sessionId + '/export?format=txt', cookie))
    assert.equal(txt, raw + '\r\n外厂任意字符串\r\n')
    assert.equal((await request('/api/admin/external-collections/' + sessionId + '/export?format=txt', '')).status, 401)
    ok(await request('/api/admin/external-collections/' + sessionId, cookie, { productName: '外厂产品', productId: null, batchNo: 'A', produceDate: '2026-10-13', productionQuantity: null }, 'PATCH'))
  })
  await check('历史投影重复执行不改变收据或管理资料，跨企业不能查询导出', async () => {
    const before = JSON.stringify((await db.query('SELECT * FROM worker_event WHERE session_id=? ORDER BY sequence_no', [sessionId]))[0])
    await backfillWorkerExternal(db); await backfillWorkerExternal(db)
    assert.equal(JSON.stringify((await db.query('SELECT * FROM worker_event WHERE session_id=? ORDER BY sequence_no', [sessionId]))[0]), before)
    assert.equal(ok(await request('/api/admin/external-collections/' + sessionId, cookie)).batch.product_name_snapshot, '外厂产品')
    const [other] = await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES(?,'2099-12-31',1)", ['隔离他厂' + tag])
    const outsider = await user('enterprise_admin', other.insertId), otherCookie = (await request('/api/auth/login', '', { username: outsider.username, password })).cookie
    assert.equal((await request('/api/admin/external-collections/' + sessionId, otherCookie)).status, 404)
  })
  console.log('工人外码管理对接：' + checks + '组真实接口通过')
} finally { await db.end() }
