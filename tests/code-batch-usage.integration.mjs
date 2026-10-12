// 真实 HTTP/SQL 验收仅创建本机隔离库；不改项目 .env，不写 nz315 业务库。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import { productionDDL, migrateProductionSchema } from '../scripts/production-schema.mjs'
import { collectionDDL } from '../scripts/collection-schema.mjs'
import { migrateDeviceSchema } from '../scripts/device-schema.mjs'

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configured = parseEnv(fs.readFileSync(path.join(workspace, '.env'), 'utf8'))
const databaseName = 'nz315_usage_test_' + Date.now()
const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1'])
assert.ok(allowedHosts.has(configured.DB_HOST), '验收数据库主机必须明确为本机')
assert.match(databaseName, /^nz315_usage_test_[0-9]+$/)
assert.notEqual(databaseName, configured.DB_NAME, '不得复用业务数据库')
const port = 38125
const base = 'http://127.0.0.1:' + port
const credentials = {
  host: configured.DB_HOST,
  port: Number(configured.DB_PORT || 3306),
  user: configured.DB_USER,
  password: configured.DB_PASSWORD,
  dateStrings: true,
  charset: 'utf8mb4',
}
const password = randomBytes(24).toString('hex')
const logDirectory = path.join(workspace, 'logs', databaseName)
const startedAt = Date.now()
let control, db, application, logStream, created = false
const results = []
const queryTimings = []
const json = value => typeof value === 'string' ? JSON.parse(value) : value
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

async function check(name, run) {
  const started = Date.now()
  await run()
  const result = { name, passed: true, elapsedMs: Date.now() - started }
  results.push(result)
  console.log('通过：' + name)
}
async function measured(name, run) {
  const started = Date.now(), result = await run()
  queryTimings.push({ name, elapsedMs: Date.now() - started })
  return result
}
async function request(route, auth = '', body, method = body === undefined ? 'GET' : 'POST') {
  const headers = { 'Content-Type': 'application/json' }
  if (auth.startsWith('nz315_user=')) headers.cookie = auth
  else if (auth) headers.authorization = 'Bearer ' + auth
  const response = await fetch(base + route, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })
  const content = await response.text()
  let data
  try { data = JSON.parse(content) } catch { assert.fail('接口未返回 JSON：' + route + '，状态 ' + response.status) }
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] }
}
function ok(response) {
  assert.equal(response.status, 200, JSON.stringify(response.data))
  return response.data
}
const usagePath = id => '/api/admin/codes/upload-batches/' + id + '/usage'
async function usage(id, auth, query = '') { return ok(await request(usagePath(id) + query, auth)) }
async function batchRow(id, auth) {
  const response = ok(await request('/api/admin/codes/upload-batches?uploadBatchId=' + id, auth))
  assert.equal(response.rows.length, 1)
  return response.rows[0]
}
async function account(role, enterpriseId, name) {
  const username = 'usage_' + randomBytes(10).toString('hex')
  const [result] = await db.execute('INSERT INTO `user` (username,password,name,role,enterprise_id,status) VALUES (?,?,?,?,?,1)',
    [username, await bcrypt.hash(password, 4), name, role, enterpriseId])
  const response = await request('/api/auth/login', '', { username, password })
  const data = ok(response)
  assert.equal(Number(data.user.id), Number(result.insertId), '服务端必须使用自建隔离库中的账号')
  assert.equal(data.user.username, username)
  assert.ok(response.cookie?.startsWith('nz315_user='))
  return { id: Number(result.insertId), username, name, cookie: response.cookie }
}
async function enterprise(name, registrationNo) {
  const [company] = await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES (?,'2099-12-31',1)", [name])
  const [spec] = await db.execute("INSERT INTO product_spec(enterprise_id,spec_code,spec_name,net_content,content_unit,pack_unit) VALUES (?,'001','隔离规格',1,'克','袋')", [company.insertId])
  const [product] = await db.execute("INSERT INTO product(enterprise_id,name,registration_no,registration_expire,reg_category,produce_type,spec_id,status) VALUES (?,?,?,'2099-12-31',1,1,?,1)", [company.insertId, name + '产品', registrationNo, spec.insertId])
  return { id: Number(company.insertId), productId: Number(product.insertId), head: '1' + registrationNo.slice(-6) + '1001' }
}
async function upload(company, actor, name, count, firstSerial = 1) {
  const [batch] = await db.execute("INSERT INTO upload_batch(enterprise_id,file_name,product_id,created_by,created_at) VALUES (?,?,?,?,'2026-10-10 08:00:00')", [company.id, name, company.productId, actor.id])
  const codes = Array.from({ length: count }, (_, index) => company.head + String(index + firstSerial).padStart(21, '0'))
  for (let index = 0; index < count; index += 2000) {
    const chunk = codes.slice(index, index + 2000)
    await db.query('INSERT INTO trace_code(enterprise_id,product_id,upload_batch_id,code,status,abnormal_flag) VALUES ' + chunk.map(() => '(?,?,?,?,1,0)').join(','),
      chunk.flatMap(code => [company.id, company.productId, batch.insertId, code]))
  }
  return { id: Number(batch.insertId), codes }
}
function taskBody(company, label, allocation) {
  return { requestId: randomUUID(), name: label, lineName: '验收一号线', productId: company.productId,
    batchNo: label, produceDate: '2026-10-11', expireDate: '2027-10-11', qcResult: 1, qualityCertNo: '隔离合格证', ...allocation }
}
function event(code, sequence, kind = 'valid') {
  return { eventId: randomUUID(), sequence, rawCode: code ? 'https://example.invalid/?code=' + code : '错误扫码文本',
    code, kind, capturedAt: '2026-10-11T04:30:00.000Z', reason: kind === 'invalid' ? '隔离错误码' : '' }
}
async function start(taskId, actor, device) {
  const id = randomUUID(), route = '/api/admin/production-tasks/' + taskId + '/collection-sessions'
  ok(await request(route, actor.cookie, { sessionId: id, device }))
  return { id, route: route + '/' + id }
}
async function sync(session, actor, events) {
  const response = ok(await request(session.route + '/events', actor.cookie || actor, { events }))
  assert.equal(response.ok, true, JSON.stringify(response))
  return response
}
async function installSchema() {
  // 仅把初始化文件作为文本读取，禁止 import 它以免执行演示数据与旧码归档。
  const source = fs.readFileSync(path.join(workspace, 'scripts', 'db-init.mjs'), 'utf8')
  const marker = source.indexOf('const DDL = [')
  assert.ok(marker >= 0)
  const ending = source.indexOf('\n];', marker)
  assert.ok(ending > marker)
  const declarations = source.slice(marker, ending)
  const statements = [...declarations.matchAll(/`((?:\\[\s\S]|[^`])*)`/g)]
    .map(match => match[1].replace(/\\`/g, '`'))
    .filter(sql => /^CREATE TABLE IF NOT EXISTS /i.test(sql))
  assert.ok(statements.length >= 14, '核心 DDL 提取不完整')
  for (const statement of statements) await db.query(statement)
  await db.query('ALTER TABLE trace_code ADD COLUMN upload_batch_id BIGINT NULL, ADD KEY idx_upload_batch(upload_batch_id)')
  for (const statement of productionDDL) await db.query(statement)
  await migrateProductionSchema(db)
  for (const statement of collectionDDL) await db.query(statement)
  await migrateDeviceSchema(db)
}
async function startApplication() {
  assert.ok(fs.existsSync(path.join(workspace, '.output', 'server', 'index.mjs')), '先完成最新生产构建再运行验收')
  const probe = net.createServer()
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve) })
  await new Promise(resolve => probe.close(resolve))
  fs.mkdirSync(logDirectory, { recursive: true })
  logStream = fs.createWriteStream(path.join(logDirectory, 'server.log'))
  application = spawn(process.execPath, [path.join(workspace, '.output', 'server', 'index.mjs')], {
    cwd: workspace, windowsHide: true,
    env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port),
      DB_HOST: credentials.host, DB_PORT: String(credentials.port), DB_USER: credentials.user, DB_PASSWORD: credentials.password, DB_NAME: databaseName,
      NUXT_DB_HOST: credentials.host, NUXT_DB_PORT: String(credentials.port), NUXT_DB_USER: credentials.user, NUXT_DB_PASSWORD: credentials.password,
      NUXT_DB_NAME: databaseName, NUXT_SESSION_SECRET: randomBytes(48).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  application.stdout.pipe(logStream, { end: false })
  application.stderr.pipe(logStream, { end: false })
  let childError
  application.once('error', error => { childError = error })
  for (let attempt = 0; attempt < 120; attempt++) {
    if (childError) throw childError
    assert.equal(application.exitCode, null, '隔离服务提前退出，请查验本轮日志')
    try { if ((await request('/api/admin/codes/upload-batches')).status === 401) return } catch { /* 服务尚未开始监听。 */ }
    await delay(250)
  }
  assert.fail('隔离服务未在 30 秒内启动')
}
async function stopApplication() {
  if (!application || application.exitCode !== null || application.signalCode !== null) return
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 5000)
    application.once('exit', () => { clearTimeout(timer); resolve() })
    application.kill()
  })
  assert.ok(application.exitCode !== null || application.signalCode !== null, '自建隔离服务未退出，拒绝先删除其数据库')
}

try {
  control = await mysql.createConnection(credentials)
  const [[existing]] = await control.query('SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [databaseName])
  assert.equal(Number(existing.n), 0, '隔离库名必须全新，禁止删除既有数据库')
  await control.query('CREATE DATABASE `' + databaseName + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
  created = true
  db = await mysql.createConnection({ ...credentials, database: databaseName })
  const [[connected]] = await db.query('SELECT DATABASE() AS name')
  assert.equal(connected.name, databaseName)
  await installSchema()
  await startApplication()
  const company = await enterprise('隔离甲企业', 'PD20269101'), foreign = await enterprise('隔离乙企业', 'PD20269102')
  const admin = await account('enterprise_admin', company.id, '甲企业管理员')
  const worker = await account('code_admin', company.id, '移动上传员甲')
  const secondWorker = await account('code_admin', company.id, '在线上传员乙')
  const viewer = await account('viewer', company.id, '甲企业只读员')
  const other = await account('enterprise_admin', foreign.id, '乙企业管理员')
  const headquarters = await account('platform_admin', null, '隔离总部')
  const original = await upload(company, admin, '10月10日生成十万码', 100000)
  const secondary = await upload(company, admin, '第二份码文件', 4, 100001)
  const third = await upload(company, admin, '第三份码文件', 4, 100005)
  const foreignUpload = await upload(foreign, other, '乙企业码文件', 3)
  const mainTask = ok(await request('/api/admin/production-tasks', worker.cookie, taskBody(company, '十万规模生产任务', { sourceUploadBatchId: original.id, quantity: 3 }))).id
  const mainSession = await start(mainTask, worker, '移动采集器甲')
  const first = event(original.codes[0], 1)
  await sync(mainSession, worker, [first])

  // 规模夹具直接种入一致的逐码/收据状态，保留少量真实 HTTP 事件验证事务与重传。
  const [[main]] = await db.query('SELECT batch_id FROM production_task WHERE id=?', [mainTask])
  await db.query("INSERT INTO production_task_code(task_id,code_id,active_code_id,code) SELECT ?,c.id,c.id,c.code FROM trace_code c LEFT JOIN production_task_code d ON d.task_id=? AND d.code_id=c.id WHERE c.upload_batch_id=? AND d.code_id IS NULL", [mainTask, mainTask, original.id])
  await db.query("UPDATE production_task_code d JOIN trace_code c ON c.id=d.code_id SET d.state='used',d.used_by=?,d.device='移动采集器甲',d.used_line='验收一号线',d.used_at='2026-10-11 12:30:00' WHERE d.task_id=? AND c.code<=?", [worker.id, mainTask, original.codes[19999]])
  await db.query("UPDATE trace_code SET status=2,batch_id=?,batch_no='十万规模生产任务',produce_date='2026-10-11',expire_date='2027-10-11',quality_cert_no='隔离合格证',qc_result=1,bound_at='2026-10-11 12:30:00' WHERE upload_batch_id=? AND code<=?", [main.batch_id, original.id, original.codes[19999]])
  const [[fixtureClock]] = await db.query("SELECT DATE_FORMAT(TIMESTAMPADD(SECOND,TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),NOW())-28800,'2026-10-11 12:30:00'),'%Y-%m-%d %H:%i:%s') AS received_at")
  await db.execute("UPDATE production_collection_event SET captured_at='2026-10-11 04:30:00',received_at=? WHERE session_id=?", [fixtureClock.received_at, mainSession.id])
  for (let index = 1; index < 20000; index += 500) {
    const events = original.codes.slice(index, Math.min(index + 500, 20000)).map((code, offset) => event(code, index + offset + 1))
    await db.query('INSERT INTO production_collection_event(event_id,session_id,sequence_no,payload_hash,code,raw_code,event_kind,result_state,reason,captured_at,received_at) VALUES ' + events.map(() => "(?,?,?,?,?,?,'valid','accepted','','2026-10-11 04:30:00',?)").join(','),
      events.flatMap(row => [row.eventId, mainSession.id, row.sequence, hash(row), row.code, row.rawCode, fixtureClock.received_at]))
  }
  await db.execute('UPDATE production_collection_session SET accepted_count=20000,last_sequence=20000 WHERE id=?', [mainSession.id])
  await db.execute('UPDATE batch SET code_count=20000 WHERE id=?', [main.batch_id])

  await check('十万原批次显示已用两万、剩余八万、移动端时间和真实账号', async () => {
    const data = await measured('十万批次两万条使用记录聚合', () => usage(original.id, viewer.cookie))
    assert.equal(data.codeTotal, 100000); assert.equal(data.usedCount, 20000); assert.equal(data.remainingCount, 80000)
    assert.equal(data.taskUsedCount, 20000); assert.equal(data.legacyBoundCount, 0); assert.equal(data.productionRecordsAvailable, true)
    assert.equal(data.total, 1); assert.equal(data.rows.length, 1)
    const row = data.rows[0]
    assert.equal(row.taskId, mainTask); assert.equal(row.count, 20000); assert.equal(row.source, 'mobile')
    assert.equal(row.sourceLabel, '移动端上传'); assert.equal(row.usageDate, '2026-10-11')
    assert.equal(row.firstReceivedAt, '2026-10-11 12:30:00'); assert.equal(row.firstCapturedAt, '2026-10-11 12:30:00')
    assert.equal(row.uploaderId, worker.id); assert.equal(row.uploaderUsername, worker.username); assert.equal(row.uploaderName, worker.name)
    assert.ok(row.deviceName.includes('移动采集器甲'))
    const listed = await measured('筛选十万码批次列表计数', () => batchRow(original.id, viewer.cookie))
    assert.equal(listed.codeTotal, 100000); assert.equal(listed.usedCount, 20000); assert.equal(listed.remainingCount, 80000)
  })

  await check('同事件重传、新序号重复与错误码不重复扣减', async () => {
    const repeated = await sync(mainSession, worker, [first]); assert.equal(repeated.receipts[0].state, 'accepted')
    const duplicate = event(original.codes[0], 20001), invalid = event(null, 20002, 'invalid')
    const responses = await sync(mainSession, worker, [duplicate, invalid])
    assert.deepEqual(responses.receipts.map(row => row.state), ['duplicate', 'rejected'])
    const data = await usage(original.id, worker.cookie)
    assert.equal(data.usedCount, 20000); assert.equal(data.remainingCount, 80000); assert.equal(data.rows[0].count, 20000)
    const [[count]] = await db.query('SELECT accepted_count,duplicate_count,rejected_count FROM production_collection_session WHERE id=?', [mainSession.id])
    assert.equal(count.accepted_count, 20000); assert.equal(count.duplicate_count, 1); assert.equal(count.rejected_count, 1)
  })

  await check('账号改名后移动上传记录保留当时账号快照', async () => {
    await db.execute('UPDATE `user` SET name=? WHERE id=?', ['后来改名的上传员', worker.id])
    assert.equal((await usage(original.id, admin.cookie)).rows[0].uploaderName, worker.name)
  })

  const mixedTask = ok(await request('/api/admin/production-tasks', worker.cookie, taskBody(company, '跨原批次生产任务', { codes: [...secondary.codes.slice(0, 3), ...third.codes.slice(0, 3)] }))).id
  const mixedSession = await start(mixedTask, worker, '移动采集器乙')
  await check('领用只占用，不能当成已用；一个任务跨两份码文件分别计数', async () => {
    for (const uploadId of [secondary.id, third.id]) {
      const data = await usage(uploadId, admin.cookie); assert.equal(data.codeTotal, 4); assert.equal(data.usedCount, 0); assert.equal(data.remainingCount, 4)
    }
    assert.equal((await sync(mixedSession, worker, [event(secondary.codes[0], 1)])).receipts[0].state, 'accepted')
    // 管理员可代原会话同步，记录必须署实际上传管理员而非会话创建人。
    assert.equal((await sync(mixedSession, admin, [event(third.codes[0], 2)])).receipts[0].state, 'accepted')
    for (const uploadId of [secondary.id, third.id]) {
      const data = await usage(uploadId, admin.cookie); assert.equal(data.usedCount, 1); assert.equal(data.remainingCount, 3); assert.equal(data.rows[0].count, 1)
    }
    const uploaded = (await usage(third.id, admin.cookie)).rows[0]
    assert.equal(uploaded.uploaderId, admin.id); assert.equal(uploaded.uploaderUsername, admin.username); assert.equal(uploaded.uploaderName, admin.name)
  })

  await check('旧在线扫码记录显示真实扫码账号，不冒用任务创建人', async () => {
    const route = '/api/admin/production-tasks/' + mixedTask + '/scan'
    const payload = { code: third.codes[1], device: '在线兼容采集器' }
    assert.equal(ok(await request(route, secondWorker.cookie, payload)).duplicate, false)
    assert.equal(ok(await request(route, secondWorker.cookie, payload)).duplicate, true)
    const data = await usage(third.id, admin.cookie)
    const online = data.rows.find(row => row.source === 'online')
    assert.equal(data.usedCount, 2); assert.equal(online.count, 1); assert.equal(online.uploaderId, secondWorker.id)
    assert.equal(online.uploaderUsername, secondWorker.username); assert.equal(online.uploaderName, secondWorker.name)
  })

  const deviceSecret = randomBytes(32).toString('hex')
  const [device] = await db.execute("INSERT INTO production_device(enterprise_id,name,line_name,status,credential_hash,created_by) VALUES (?,?,'验收一号线','enabled',?,?)", [company.id, '独立采集设备甲', createHash('sha256').update(deviceSecret).digest('hex'), admin.id])
  const deviceSessionId = randomUUID(), deviceSession = { id: deviceSessionId, route: '/api/device/production-tasks/' + mixedTask + '/collection-sessions/' + deviceSessionId }
  await check('独立设备上传人待接入，保留设备且不借用登记管理员', async () => {
    ok(await request('/api/device/production-tasks/' + mixedTask + '/collection-sessions', deviceSecret, { sessionId: deviceSessionId, device: '伪造设备名' }))
    await sync(deviceSession, deviceSecret, [event(secondary.codes[1], 1)])
    const data = await usage(secondary.id, admin.cookie), row = data.rows.find(row => row.uploaderType === 'unknown')
    assert.equal(data.usedCount, 2); assert.equal(data.remainingCount, 2); assert.ok(row)
    assert.equal(row.uploaderId, null); assert.equal(row.uploaderUsername, null); assert.equal(row.uploaderName, null)
    assert.equal(row.deviceId, Number(device.insertId)); assert.ok(row.deviceName.includes('独立采集设备甲'))
  })

  await check('历史已绑定码计入使用量，不伪造生产任务与上传账号', async () => {
    const historical = await upload(company, admin, '历史已绑定批次', 5, 100009)
    const [historicalBatch] = await db.execute("INSERT INTO batch(enterprise_id,product_id,batch_no,produce_date,expire_date,quality_cert_no,qc_result,code_count) VALUES (?,?,'历史生产批次','2026-10-11','2027-10-11','历史合格证',1,3)", [company.id, company.productId])
    await db.execute("UPDATE trace_code SET status=2,batch_id=?,batch_no='历史生产批次',produce_date='2026-10-11',expire_date='2027-10-11',quality_cert_no='历史合格证',qc_result=1,bound_at=NOW() WHERE upload_batch_id=? AND code<=?", [historicalBatch.insertId, historical.id, historical.codes[2]])
    const data = await usage(historical.id, admin.cookie)
    assert.equal(data.codeTotal, 5); assert.equal(data.usedCount, 3); assert.equal(data.remainingCount, 2)
    assert.equal(data.taskUsedCount, 0); assert.equal(data.legacyBoundCount, 3); assert.equal(data.total, 0); assert.deepEqual(data.rows, [])
  })

  await check('使用记录分页不丢总数，空页正确，非法分页返回中文错误', async () => {
    const firstPage = await usage(third.id, viewer.cookie, '?page=1&pageSize=1'), secondPage = await usage(third.id, viewer.cookie, '?page=2&pageSize=1')
    assert.equal(firstPage.total, 2); assert.equal(secondPage.total, 2); assert.equal(firstPage.rows.length, 1); assert.equal(secondPage.rows.length, 1)
    assert.notEqual(firstPage.rows[0].uploaderId, secondPage.rows[0].uploaderId)
    const empty = await usage(third.id, viewer.cookie, '?page=9&pageSize=1'); assert.equal(empty.total, 2); assert.deepEqual(empty.rows, [])
    for (const query of ['?page=0', '?page=-1', '?page=abc', '?pageSize=101', '?pageSize=0']) assert.equal((await request(usagePath(third.id) + query, worker.cookie)).status, 400)
  })

  await check('码库先分页后计数，各批次余量、筛选及批次总数独立准确', async () => {
    const firstPage = ok(await measured('多批次列表每页一条第一页', () => request('/api/admin/codes/upload-batches?page=1&pageSize=1', viewer.cookie)))
    const secondPage = ok(await measured('多批次列表每页一条第二页', () => request('/api/admin/codes/upload-batches?page=2&pageSize=1', viewer.cookie)))
    assert.equal(firstPage.total, 4); assert.equal(secondPage.total, 4)
    assert.equal(firstPage.rows.length, 1); assert.equal(secondPage.rows.length, 1)
    assert.equal(firstPage.rows[0].codeTotal, 5); assert.equal(firstPage.rows[0].usedCount, 3); assert.equal(firstPage.rows[0].remainingCount, 2)
    assert.equal(secondPage.rows[0].id, third.id); assert.equal(secondPage.rows[0].codeTotal, 4); assert.equal(secondPage.rows[0].usedCount, 2); assert.equal(secondPage.rows[0].remainingCount, 2)
    const filtered = ok(await measured('多批次列表按名称筛选十万原批次', () => request('/api/admin/codes/upload-batches?pageSize=1&fileName=' + encodeURIComponent('十万码'), viewer.cookie)))
    assert.equal(filtered.total, 1); assert.equal(filtered.rows.length, 1); assert.equal(filtered.rows[0].id, original.id)
    assert.equal(filtered.rows[0].codeTotal, 100000); assert.equal(filtered.rows[0].usedCount, 20000); assert.equal(filtered.rows[0].remainingCount, 80000)
    const empty = ok(await request('/api/admin/codes/upload-batches?page=9&pageSize=1', viewer.cookie))
    assert.equal(empty.total, 4); assert.deepEqual(empty.rows, [])
  })

  await check('待审核、审核释放和余码转领均不能再次扣减原批次', async () => {
    ok(await request(mixedSession.route + '/complete', worker.cookie, { lastSequence: 2, endTask: false }))
    const completed = ok(await request(deviceSession.route + '/complete', deviceSecret, { lastSequence: 1, endTask: true }))
    assert.equal(completed.taskStatus, 'pending')
    for (const uploadId of [secondary.id, third.id]) assert.equal((await usage(uploadId, admin.cookie)).remainingCount, 2)
    ok(await request('/api/admin/production-tasks/' + mixedTask + '/review', admin.cookie, { decision: 'approve', reason: '确认两个剩余码尚未生产' }))
    ok(await request('/api/admin/production-tasks', worker.cookie, taskBody(company, '余码转领任务', { sourceTaskId: mixedTask, quantity: 2 })))
    for (const uploadId of [secondary.id, third.id]) {
      const data = await usage(uploadId, admin.cookie); assert.equal(data.usedCount, 2); assert.equal(data.remainingCount, 2)
    }
  })

  await check('匿名拒绝、厂家越权404、伪造参数无效、总部可读两企业', async () => {
    assert.equal((await request(usagePath(original.id))).status, 401)
    assert.equal((await request(usagePath(original.id), other.cookie)).status, 404)
    assert.equal((await request(usagePath(foreignUpload.id), worker.cookie)).status, 404)
    assert.equal((await request(usagePath(foreignUpload.id) + '?enterpriseId=' + foreign.id, worker.cookie)).status, 404)
    assert.equal((await usage(original.id, headquarters.cookie)).codeTotal, 100000)
    assert.equal((await usage(foreignUpload.id, headquarters.cookie)).codeTotal, 3)
    const companies = ok(await request('/api/admin/codes/upload-batches', worker.cookie))
    assert.ok(!companies.rows.some(row => row.id === foreignUpload.id))
    assert.equal((await request('/api/admin/codes/upload-batches/999999999/usage', admin.cookie)).status, 404)
  })

  await check('缺少生产采集表仍返回准确余量并明确降级', async () => {
    await db.query('RENAME TABLE production_collection_event TO usage_saved_collection_event')
    try {
      const data = await usage(original.id, admin.cookie)
      assert.equal(data.productionRecordsAvailable, false); assert.ok(data.unavailableReason); assert.deepEqual(data.rows, [])
      assert.equal(data.usedCount, 20000); assert.equal(data.remainingCount, 80000); assert.equal(data.legacyBoundCount, 20000)
      const row = await batchRow(original.id, admin.cookie); assert.equal(row.usedCount, 20000); assert.equal(row.remainingCount, 80000)
    } finally { await db.query('RENAME TABLE usage_saved_collection_event TO production_collection_event') }
  })

  await check('缺必要生产列明确降级，其余SQL错误返回失败不能假装空记录', async () => {
    await db.query('ALTER TABLE production_task_code RENAME COLUMN used_line TO usage_saved_used_line')
    try { assert.equal((await usage(original.id, admin.cookie)).productionRecordsAvailable, false) }
    finally { await db.query('ALTER TABLE production_task_code RENAME COLUMN usage_saved_used_line TO used_line') }
    await db.query('ALTER TABLE batch RENAME COLUMN batch_no TO usage_saved_batch_no')
    try { assert.equal((await request(usagePath(original.id), admin.cookie)).status, 500) }
    finally { await db.query('ALTER TABLE batch RENAME COLUMN usage_saved_batch_no TO batch_no') }
    assert.equal((await usage(original.id, admin.cookie)).productionRecordsAvailable, true)
  })

  fs.writeFileSync(path.join(logDirectory, 'results.json'), JSON.stringify({ databaseName, checks: results.length, elapsedMs: Date.now() - startedAt, queryTimings, results }, null, 2))
  console.log('码库使用记录隔离验收完成：' + results.length + ' 项通过，100000/20000/80000一致')
} finally {
  await stopApplication()
  if (logStream) await new Promise(resolve => logStream.end(resolve))
  if (db) await db.end()
  if (created) {
    assert.match(databaseName, /^nz315_usage_test_[0-9]+$/)
    assert.notEqual(databaseName, configured.DB_NAME)
    assert.ok(allowedHosts.has(credentials.host))
    // 超时后服务器连接可能仍在执行；服务已退出，仅终止本轮自建库的滞留查询。
    const [connections] = await control.query('SHOW PROCESSLIST')
    for (const connection of connections.filter(row => row.db === databaseName && row.Command === 'Query')) {
      assert.ok(Number.isSafeInteger(Number(connection.Id)) && Number(connection.Id) > 0)
      await control.query('KILL QUERY ' + Number(connection.Id))
    }
    await control.query('DROP DATABASE `' + databaseName + '`')
    console.log('已清理本轮自建隔离库与服务')
  }
  if (control) await control.end()
}
