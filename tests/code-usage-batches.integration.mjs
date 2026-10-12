// 真实事务与HTTP验收只操作全新本机隔离库；不会读写真实业务库的数据。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { register } from 'node:module'
import { parseEnv } from 'node:util'
import { randomUUID, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { createError } from 'h3'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import { productionDDL, migrateProductionSchema } from '../scripts/production-schema.mjs'
import { collectionDDL } from '../scripts/collection-schema.mjs'
import { migrateDeviceSchema } from '../scripts/device-schema.mjs'
import { migrateUsageBatchSchema } from '../scripts/usage-batch-schema.mjs'

register('./_ts-loader.mjs', import.meta.url)
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = parseEnv(fs.readFileSync(path.join(workspace, '.env'), 'utf8'))
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST), '验收数据库主机必须为本机')
const databaseName = 'nz315_children_test_' + Date.now()
assert.match(databaseName, /^nz315_children_test_[0-9]+$/)
assert.notEqual(databaseName, env.DB_NAME, '禁止复用真实业务数据库')
const credentials = { host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, dateStrings: true, charset: 'utf8mb4' }
globalThis.createError = createError
globalThis.useRuntimeConfig = () => ({ dbHost: credentials.host, dbPort: credentials.port, dbUser: credentials.user, dbPassword: credentials.password, dbName: databaseName, public: { traceBaseUrl: 'https://example.invalid/trace?code=' } })
const tasks = await import('../server/utils/production-task.ts')
const collections = await import('../server/utils/production-collection.ts')
const uploads = await import('../server/utils/production-uploads.ts')
const children = await import('../server/utils/code-usage-batches.ts')
const manage = await import('../server/utils/code-scope-management.ts')
const scopes = await import('../server/utils/code-scope.ts')
const schema = await import('../server/utils/usage-batch-schema.ts')
const { correctCodes } = await import('../server/utils/code-correction.ts')
const { codeBatchUsage } = await import('../server/utils/code-batch-usage.ts')
const { effectiveProduction } = await import('../shared/utils/production-info.ts')
const { getPool } = await import('../server/utils/db.ts')
const results = [], timings = []
const password = randomBytes(24).toString('hex')
const logDirectory = path.join(workspace, 'logs', databaseName)
let control, db, created = false, application, logStream, base
async function check(name, work) { await work(); results.push(name); console.log('通过：' + name) }
async function rejects(work, pattern) { await assert.rejects(work, error => pattern.test(String(error.statusMessage || error.message))) }
const one = async (sql, values = []) => (await db.query(sql, values))[0][0]
const event = (code, sequence, kind = 'valid') => ({ eventId: randomUUID(), sequence, code: code || null, rawCode: code ? 'https://example.invalid/?code=' + code : '错误扫码文本', kind, capturedAt: '2026-10-11T04:30:00.000Z', reason: kind === 'invalid' ? '隔离错误码' : '' })
const sync = (user, taskId, sid, uploadId, events) => collections.syncCollection(user, taskId, sid, { ...(uploadId ? { uploadId } : {}), events })
const taskBody = (company, name, allocation, batchNo = name) => ({ requestId: randomUUID(), productId: company.productId, name, lineName: '隔离生产线', batchNo, produceDate: '2026-10-11', expireDate: '2027-10-11', qcResult: 1, qualityCertNo: '隔离合格证', ...allocation })
async function company(name, registration) {
  const [e] = await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES (?,'2099-12-31',1)", [name])
  const [s] = await db.execute("INSERT INTO product_spec(enterprise_id,spec_code,spec_name) VALUES (?,'001','500毫升/瓶×10')", [e.insertId])
  const [p] = await db.execute("INSERT INTO product(enterprise_id,name,registration_no,registration_expire,reg_category,produce_type,spec_id,status) VALUES (?,?,?,'2099-12-31',1,1,?,1)", [e.insertId, name + '产品', registration, s.insertId])
  return { id: Number(e.insertId), productId: Number(p.insertId), head: '1' + registration.slice(-6) + '1001' }
}
async function actor(role, companyId, name) {
  const username = 'children_' + randomBytes(8).toString('hex')
  const [user] = await db.execute('INSERT INTO user(username,password,name,role,enterprise_id,status) VALUES (?,?,?,?,?,1)', [username, await bcrypt.hash(password, 4), name, role, companyId])
  return { id: Number(user.insertId), username, name, role, enterprise_id: companyId, status: 1, phone: null }
}
async function root(company, user, count, serial = 1, snapshot = '500毫升/瓶×10') {
  const [r] = await db.execute('INSERT INTO upload_batch(enterprise_id,product_id,file_name,created_by,spec_name_snapshot) VALUES (?,?,?,?,?)', [company.id, company.productId, '生成入库 隔离' + serial, user.id, snapshot])
  const codes = Array.from({ length: count }, (_, i) => company.head + String(serial + i).padStart(21, '0'))
  for (let i = 0; i < codes.length; i += 2000) {
    const chunk = codes.slice(i, i + 2000)
    await db.query('INSERT INTO trace_code(enterprise_id,product_id,upload_batch_id,code,status,abnormal_flag) VALUES ' + chunk.map(() => '(?,?,?,?,1,0)').join(','), chunk.flatMap(code => [company.id, company.productId, r.insertId, code]))
  }
  return { id: Number(r.insertId), codes }
}
async function session(user, taskId) { const sid = randomUUID(); await collections.startCollection(user, taskId, { sessionId: sid, device: '隔离移动采集器' }); return sid }
async function installCore() {
  const source = fs.readFileSync(path.join(workspace, 'scripts/db-init.mjs'), 'utf8'), start = source.indexOf('const DDL = ['), end = source.indexOf('\n];', start)
  assert.ok(start >= 0 && end > start)
  const ddl = [...source.slice(start, end).matchAll(/`((?:\\[\s\S]|[^`])*)`/g)].map(m => m[1].replace(/\\`/g, '`')).filter(sql => /^CREATE TABLE IF NOT EXISTS /i.test(sql))
  assert.ok(ddl.length >= 14)
  for (const sql of ddl) await db.query(sql)
  await db.query('ALTER TABLE trace_code ADD COLUMN upload_batch_id BIGINT NULL, ADD KEY idx_upload_batch(upload_batch_id)')
  await db.query('ALTER TABLE scan_log ADD COLUMN consumer_id BIGINT NULL, ADD KEY idx_consumer_time(consumer_id,scan_time)')
  for (const sql of productionDDL) await db.query(sql)
  await migrateProductionSchema(db)
  for (const sql of collectionDDL) await db.query(sql)
  await migrateDeviceSchema(db)
}
async function request(route, cookie, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? (/^[a-f0-9]{64}$/.test(cookie) ? { authorization: 'Bearer ' + cookie } : { cookie }) : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) })
  const text = await response.text(); let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers }
}
function ok(response) { assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data }
async function startHttp() {
  const buildDir = path.resolve(process.env.NZ315_TEST_BUILD_DIR)
  const entry = path.join(buildDir, '.output/server/index.mjs')
  assert.ok(fs.existsSync(entry), 'NZ315_TEST_BUILD_DIR必须含最新独立生产构建')
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); base = 'http://127.0.0.1:' + port
  fs.mkdirSync(logDirectory, { recursive: true }); logStream = fs.createWriteStream(path.join(logDirectory, 'server.log'))
  application = spawn(process.execPath, [entry], { cwd: buildDir, windowsHide: true, env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), NUXT_DB_HOST: credentials.host, NUXT_DB_PORT: String(credentials.port), NUXT_DB_USER: credentials.user, NUXT_DB_PASSWORD: credentials.password, NUXT_DB_NAME: databaseName, NUXT_SESSION_SECRET: randomBytes(48).toString('hex') }, stdio: ['ignore', 'pipe', 'pipe'] })
  application.stdout.pipe(logStream, { end: false }); application.stderr.pipe(logStream, { end: false })
  for (let i = 0; i < 120; i++) { assert.equal(application.exitCode, null, '隔离预览提前退出'); try { if ((await request('/api/admin/codes')).status === 401) return } catch { /* 等待隔离预览启动。 */ } await delay(250) }
  assert.fail('隔离预览未及时启动')
}
async function login(user) { const response = await request('/api/auth/login', '', { username: user.username, password }); assert.equal(ok(response).user.id, user.id); return response.cookie }

try {
  control = await mysql.createConnection(credentials)
  assert.equal(Number((await control.query('SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [databaseName]))[0][0].n), 0)
  await control.query('CREATE DATABASE `' + databaseName + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); created = true
  db = await mysql.createConnection({ ...credentials, database: databaseName }); await installCore()
  const a = await company('隔离甲企业', 'PD20269121'), b = await company('隔离乙企业', 'PD20269122')
  const worker = await actor('code_admin', a.id, '真实上传员'), admin = await actor('enterprise_admin', a.id, '厂家管理员'), viewer = await actor('viewer', a.id, '只读员'), stranger = await actor('enterprise_admin', b.id, '乙管理员'), outsider = await actor('code_admin', a.id, '同企业其他账号')
  const [legacyRoot] = await db.execute("INSERT INTO upload_batch(enterprise_id,product_id,file_name,created_by) VALUES (?,?,'历史留档',?)", [a.id, a.productId, admin.id])
  await db.execute('INSERT INTO trace_code(enterprise_id,product_id,upload_batch_id,code,status) VALUES (?,?,?,?,2)', [a.id, a.productId, legacyRoot.insertId, a.head + '999999999999999999999'])
  const originalColumns = (await db.query("SELECT TABLE_NAME AS t,COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('enterprise','product','product_spec','upload_batch','trace_code') ORDER BY TABLE_NAME,ORDINAL_POSITION"))[0]
  async function originalFingerprint() { const value = {}; for (const table of [...new Set(originalColumns.map(r => r.t))]) value[table] = (await db.query('SELECT ' + originalColumns.filter(r => r.t === table).map(r => '`' + r.c + '`').join(',') + ' FROM `' + table + '` ORDER BY id'))[0]; return JSON.stringify(value) }
  const before = await originalFingerprint()
  await check('增量迁移只补结构、旧业务逐字段不变且二次执行幂等', async () => { await migrateUsageBatchSchema(db); assert.equal(await originalFingerprint(), before); await migrateUsageBatchSchema(db); assert.equal(await originalFingerprint(), before); assert.equal(await schema.usageBatchSchemaAvailable(), true); assert.equal(Number((await one('SELECT COUNT(*) AS n FROM code_usage_batch')).n), 0) })
  await check('历史已绑定码只汇总、不补造使用子批和当前规格', async () => { const list = await children.usageBatchChildren(worker, Number(legacyRoot.insertId), 1, 10); assert.equal(list.total, 0); assert.equal(list.legacyBoundCount, 1); assert.equal(list.usedCount, 1); assert.equal(list.rows[0].specName, null) })
  const r1 = await root(a, admin, 12), r2 = await root(a, admin, 8, 100), foreign = await root(b, stranger, 2)
  const t1 = (await tasks.createProductionTask(worker, taskBody(a, '上午下午任务', { codes: [...r1.codes.slice(0, 6), ...r2.codes.slice(0, 3)] }, '共同业务批号'))).id
  const t2 = (await tasks.createProductionTask(worker, taskBody(a, '另一独立任务', { codes: [r1.codes[6]] }, '共同业务批号'))).id
  const sid = await session(worker, t1), up1 = randomUUID(), up2 = randomUUID()
  await check('起始上传标识幂等且不能更换账号、范围或未封前新建', async () => { await uploads.startProductionUpload(worker, t1, sid, { uploadId: up1, firstSequence: 1 }); assert.equal((await uploads.startProductionUpload(worker, t1, sid, { uploadId: up1, firstSequence: 1 })).state, 'open'); await rejects(() => uploads.startProductionUpload(outsider, t1, sid, { uploadId: up1, firstSequence: 1 }), /原账号|其他采集/); await rejects(() => uploads.startProductionUpload(worker, t1, sid, { uploadId: randomUUID(), firstSequence: 1 }), /先完成/) })
  const e1 = event(r1.codes[0], 1), e2 = event(r1.codes[1], 2), e3 = event(r2.codes[0], 3), e4 = event(r1.codes[0], 4), e5 = event(null, 5, 'invalid')
  let child1, child2, sibling
  await check('自动分段增长和丢响应重试归同一子批、跨总批按同上传分开', async () => { assert.equal((await sync(worker, t1, sid, up1, [e1])).receipts[0].state, 'accepted'); child1 = Number((await one('SELECT usage_batch_id AS id FROM trace_code WHERE code=?', [e1.code])).id); await sync(worker, t1, sid, up1, [e1, e2, e3]); const list = await children.usageBatchChildren(worker, r1.id, 1, 10); assert.equal(list.total, 1); assert.equal(list.rows.find(r => r.id === child1).count, 2); assert.equal(list.usedCount, 2); child2 = Number((await one('SELECT usage_batch_id AS id FROM trace_code WHERE code=?', [e3.code])).id); assert.notEqual(child1, child2); assert.equal((await one('SELECT upload_id FROM code_usage_batch WHERE id=?', [child2])).upload_id, up1) })
  await check('重复和错误事件留痕且不扣量、完成后固定范围', async () => { const synced = await sync(worker, t1, sid, up1, [e4, e5]); assert.deepEqual(synced.receipts.map(r => r.state), ['duplicate', 'rejected']); assert.equal((await uploads.completeProductionUpload(worker, t1, sid, up1, { lastSequence: 5 })).state, 'completed'); assert.equal((await children.usageBatchChildren(worker, r1.id, 1, 10)).usedCount, 2); await rejects(() => uploads.completeProductionUpload(worker, t1, sid, up1, { lastSequence: 6 }), /固定序号|不能更改/); assert.equal((await sync(worker, t1, sid, up1, [e1])).receipts[0].state, 'accepted') })
  await check('同任务第二次完成生成同级新子批、无效重试不挪旧归属', async () => { await uploads.startProductionUpload(worker, t1, sid, { uploadId: up2, firstSequence: 6 }); const e6 = event(r1.codes[2], 6); await sync(worker, t1, sid, up2, [e6]); sibling = Number((await one('SELECT usage_batch_id AS id FROM trace_code WHERE code=?', [e6.code])).id); assert.notEqual(sibling, child1); const failed = await sync(worker, t1, sid, up2, [e1]); assert.equal(failed.ok, false); assert.equal(failed.uploadId, up2); assert.equal(Number((await one('SELECT usage_batch_id AS id FROM trace_code WHERE code=?', [e1.code])).id), child1); await uploads.completeProductionUpload(worker, t1, sid, up2, { lastSequence: 6 }) })
  await check('后台接收/采集时间和上传账号来自服务端快照、规格不跟随当前修改', async () => { await db.execute("UPDATE product_spec SET spec_name='现在被修改的规格' WHERE enterprise_id=?", [a.id]); const list = await children.usageBatchChildren(viewer, r1.id, 1, 10), row = list.rows.find(r => r.id === child1); assert.equal(row.specName, '500毫升/瓶×10'); assert.equal(row.uploaderId, worker.id); assert.equal(row.uploaderUsername, worker.username); assert.equal(row.firstCapturedAt, '2026-10-11 12:30:00'); assert.ok(row.firstReceivedAt); assert.equal(list.rows[0].specName, '500毫升/瓶×10'); assert.equal(list.rows[0].count, 9); assert.equal(list.rows[0].occupiedCount, 4); assert.equal(list.rows[0].availableCount, 5) })
  await check('子批更正预览列整个任务跨总批范围、活动会话阻止更正', async () => { const preview = await children.usageBatchCorrectionPreview(worker, child1); assert.equal(preview.rootCount, 2); assert.equal(preview.totalCodes, 9); assert.equal(preview.usedCodes, 4); assert.equal(preview.canCorrect, false); await rejects(() => children.correctUsageBatchProduction(worker, child1, { requestId: randomUUID(), batchNo: '更正批号' }), /结束所有设备/) })
  await collections.completeCollection(worker, t1, sid, { lastSequence: 6, endTask: false })
  const productionChange = { requestId: randomUUID(), batchNo: '任务甲更正批号', produceDate: '2026-10-12', expireDate: '2028-10-12', qualityCertNo: '新合格证' }
  await check('整任务更正跨总批同步、共享业务批次和另一任务独立、码身份不动', async () => { const physicalBefore = await one('SELECT b.* FROM batch b JOIN production_task t ON t.batch_id=b.id WHERE t.id=?', [t1]); const identities = (await db.query('SELECT id,code,upload_batch_id,usage_batch_id,batch_id FROM trace_code WHERE usage_batch_id IS NOT NULL ORDER BY id'))[0]; await tasks.scanProductionCode(worker, t2, { code: r1.codes[6], device: '在线测试设备' }); const anotherBefore = await one('SELECT * FROM trace_code WHERE code=?', [r1.codes[6]]); const changed = await children.correctUsageBatchProduction(worker, child1, productionChange); assert.equal(changed.rootCount, 2); assert.equal((await children.correctUsageBatchProduction(worker, child1, productionChange)).duplicate, true); assert.deepEqual(await one('SELECT b.* FROM batch b JOIN production_task t ON t.batch_id=b.id WHERE t.id=?', [t1]), { ...physicalBefore, code_count: 5 }); assert.deepEqual((await db.query('SELECT id,code,upload_batch_id,usage_batch_id,batch_id FROM trace_code WHERE usage_batch_id IS NOT NULL ORDER BY id'))[0], identities); assert.deepEqual(await one('SELECT * FROM trace_code WHERE code=?', [r1.codes[6]]), anotherBefore); for (const code of [r1.codes[0], r1.codes[1], r1.codes[2], r2.codes[0]]) { const updated = await one('SELECT * FROM trace_code WHERE code=?', [code]); assert.equal(updated.batch_no, '任务甲更正批号'); assert.equal(updated.produce_date, '2026-10-12'); assert.equal(effectiveProduction(updated, physicalBefore).batchNo, '任务甲更正批号') } const reserved = await one('SELECT * FROM trace_code WHERE code=?', [r1.codes[3]]); assert.equal(reserved.batch_no, null); assert.equal(reserved.produce_date, null); const usage = await codeBatchUsage(r1.id, a.id, 1, 10); assert.equal(usage.rows.find(r => r.taskId === t1).batchNo, '任务甲更正批号'); assert.equal(usage.rows.find(r => r.taskId === t2).batchNo, '共同业务批号'); assert.equal((await tasks.productionTaskDetail(worker, t1, '', 1)).task.batch_no, '任务甲更正批号') })
  await check('更正权限、幂等冲突和冻结/作废跨根保护', async () => { await rejects(() => children.correctUsageBatchProduction(outsider, child1, { requestId: randomUUID(), batchNo: '非创建者更正' }), /创建人/); await rejects(() => children.correctUsageBatchProduction(worker, child1, { ...productionChange, batchNo: '冲突批号' }), /相同提交标识/); await manage.flagCodeScope(admin, { usageBatchId: child2 }, { flag: 1 }); assert.equal((await children.usageBatchCorrectionPreview(worker, child1)).canCorrect, false); await rejects(() => children.correctUsageBatchProduction(worker, child1, { requestId: randomUUID(), batchNo: '冻结后修改' }), /冻结或作废/); await manage.flagCodeScope(admin, { usageBatchId: child2 }, { flag: 0 }) })
  await check('子批和剩余范围按企业隔离、明细选择不能伪造父关系', async () => { for (const work of [() => children.usageBatchChildren(stranger, r1.id, 1, 10), () => children.usageBatchCorrectionPreview(stranger, child1), () => manage.flagCodeScope(stranger, { usageBatchId: child1 }, { flag: 2, reason: '非法' }), () => scopes.resolveCodeScope(worker, { usageBatchId: child1, uploadBatchId: r2.id })]) await rejects(work, /不属于|不存在/); await rejects(() => children.usageBatchChildren(worker, foreign.id, 1, 10), /不属于|不存在/) })
  await check('冻结子批不改变已用数量，remaining动作不影响已用和其他根', async () => { const before = (await children.usageBatchChildren(worker, r1.id, 1, 10)).usedCount; await manage.flagCodeScope(admin, { usageBatchId: sibling }, { flag: 2, reason: '隔离作废验证' }); await manage.flagCodeScope(admin, { uploadBatchId: r1.id, remaining: true }, { flag: 1 }); assert.equal((await children.usageBatchChildren(worker, r1.id, 1, 10)).usedCount, before); assert.equal((await one('SELECT abnormal_flag FROM trace_code WHERE code=?', [r1.codes[0]])).abnormal_flag, 0); assert.equal((await one('SELECT abnormal_flag FROM trace_code WHERE code=?', [r2.codes[1]])).abnormal_flag, 0); await manage.flagCodeScope(admin, { uploadBatchId: r1.id, remaining: true }, { flag: 0 }) })
  await check('已用子批不能删除、任务占用与历史剩余不能删除或单独更正', async () => { await rejects(() => manage.deleteCodeScope(admin, { usageBatchId: child1 }), /已绑定/); await rejects(() => manage.deleteCodeScope(admin, { uploadBatchId: r1.id, remaining: true }), /任务历史/); const code = await one('SELECT id FROM trace_code WHERE code=?', [r1.codes[0]]); await rejects(() => correctCodes(admin, { produceDate: '2026-10-13' }, { ids: [code.id], single: true }), /任务/); await rejects(() => correctCodes(admin, { produceDate: '2026-10-13' }, { uploadBatchId: r1.id, remaining: true }), /任务/) })
  const unusedRoot = await root(a, admin, 3, 200)
  await check('从未领用的剩余范围可精确删除，父批保留', async () => { assert.equal((await manage.deleteCodeScope(admin, { uploadBatchId: unusedRoot.id, remaining: true })).deletedCodes, 3); assert.ok(await one('SELECT id FROM upload_batch WHERE id=?', [unusedRoot.id])); assert.equal(Number((await one('SELECT COUNT(*) AS n FROM trace_code WHERE upload_batch_id=?', [unusedRoot.id])).n), 0) })
  const legacyTask = (await tasks.createProductionTask(worker, taskBody(a, '旧队列任务', { codes: [r2.codes[3]] }))).id, legacySid = await session(worker, legacyTask)
  await check('旧无uploadId队列仍接受且不伪造现代子批', async () => { const response = await sync(worker, legacyTask, legacySid, null, [event(r2.codes[3], 1)]); assert.equal(response.receipts[0].state, 'accepted'); assert.equal((await one('SELECT usage_batch_id FROM trace_code WHERE code=?', [r2.codes[3]])).usage_batch_id, null); await collections.completeCollection(worker, legacyTask, legacySid, { lastSequence: 1, endTask: false }) })
  const rollbackTask = (await tasks.createProductionTask(worker, taskBody(a, '回滚任务', { codes: [r2.codes[4]] }))).id, rollbackSid = await session(worker, rollbackTask), rollbackUpload = randomUUID(), rollbackEvent = event(r2.codes[4], 1)
  await uploads.startProductionUpload(worker, rollbackTask, rollbackSid, { uploadId: rollbackUpload, firstSequence: 1 })
  await check('事件落库失败整体回滚绑定/子批/计数，原事件重试可成功', async () => { await db.query("CREATE TRIGGER fail_collection_event BEFORE INSERT ON production_collection_event FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='隔离强制事件失败'"); const failed = await sync(worker, rollbackTask, rollbackSid, rollbackUpload, [rollbackEvent]); assert.equal(failed.ok, false); assert.equal(failed.uploadId, rollbackUpload); assert.equal(failed.receipts.length, 0); const row = await one('SELECT status,usage_batch_id,batch_id FROM trace_code WHERE code=?', [r2.codes[4]]); assert.equal(row.status, 1); assert.equal(row.usage_batch_id, null); assert.equal(row.batch_id, null); assert.equal(Number((await one('SELECT COUNT(*) AS n FROM code_usage_batch WHERE upload_id=?', [rollbackUpload])).n), 0); await db.query('DROP TRIGGER fail_collection_event'); assert.equal((await sync(worker, rollbackTask, rollbackSid, rollbackUpload, [rollbackEvent])).receipts[0].state, 'accepted'); await uploads.completeProductionUpload(worker, rollbackTask, rollbackSid, rollbackUpload, { lastSequence: 1 }); await collections.completeCollection(worker, rollbackTask, rollbackSid, { lastSequence: 1, endTask: false }) })
  const closingTask = (await tasks.createProductionTask(worker, taskBody(a, '缺口封批任务', { codes: [r2.codes[5], r2.codes[6]] }))).id, closingSid = await session(worker, closingTask), closingUpload = randomUUID()
  await check('未收齐的固定封批为closing，补齐并重试完成而范围不改变', async () => { await uploads.startProductionUpload(worker, closingTask, closingSid, { uploadId: closingUpload, firstSequence: 1 }); await sync(worker, closingTask, closingSid, closingUpload, [event(r2.codes[5], 1)]); const state = await uploads.completeProductionUpload(worker, closingTask, closingSid, closingUpload, { lastSequence: 2 }); assert.equal(state.state, 'closing'); assert.equal(state.pending, 1); await rejects(() => collections.completeCollection(worker, closingTask, closingSid, { lastSequence: 1, endTask: false }), /本次上传/); await sync(worker, closingTask, closingSid, closingUpload, [event(r2.codes[6], 2)]); assert.equal((await uploads.completeProductionUpload(worker, closingTask, closingSid, closingUpload, { lastSequence: 2 })).state, 'completed'); await collections.completeCollection(worker, closingTask, closingSid, { lastSequence: 2, endTask: false }) })
  await check('已领未用结束并审核后才释放，已用码始终不能重复领', async () => { await tasks.endProductionTask(worker, closingTask); const pendingTask = (await tasks.createProductionTask(worker, taskBody(a, '余码审核任务', { codes: [r2.codes[7]] }))).id; await tasks.endProductionTask(worker, pendingTask); await rejects(() => tasks.createProductionTask(worker, taskBody(a, '未审核转领', { codes: [r2.codes[7]] })), /任务/); await tasks.reviewProductionTask(admin, pendingTask, { decision: 'approve', reason: '隔离确认余码' }); assert.ok((await tasks.createProductionTask(worker, taskBody(a, '审核后新任务', { codes: [r2.codes[7]] }))).id); await rejects(() => tasks.createProductionTask(worker, taskBody(a, '已用码重复领', { codes: [r1.codes[0]] })), /未生产|已生产|未.*生产/) })
  await check('明确来源根批可检索，不能脱离产品或跨企业', async () => { const src = await tasks.productionSources(worker, a.productId, r1.id); assert.equal(src.uploads.length, 1); assert.equal(src.uploads[0].id, r1.id); await rejects(() => tasks.productionSources(worker, 0, r1.id), /同时选择产品/); await rejects(() => tasks.productionSources(worker, a.productId, foreign.id), /不一致/) })
  await check('缺结构明确拒绝现代协议和子批，不把数据库错误当零用量', async () => { await db.query('ALTER TABLE production_collection_event RENAME COLUMN upload_id TO unavailable_upload_id'); assert.equal(await schema.usageBatchSchemaAvailable(), false); await rejects(() => scopes.resolveCodeScope(worker, { usageBatchId: child1 }), /数据库升级/); const list = await children.usageBatchChildren(worker, r1.id, 1, 10); assert.equal(list.productionRecordsAvailable, false); await db.query('ALTER TABLE production_collection_event RENAME COLUMN unavailable_upload_id TO upload_id') })

  await check('已知规格冲突在新建/追加/编辑中被拦截，等价单位允许且未知不冒用当前规格', async () => {
    const old = await root(a, admin, 3, 400, '500ml/瓶×10'), equivalent = await root(a, admin, 2, 410, '0.5升/瓶×10'), different = await root(a, admin, 3, 420, '1升/瓶×10'), unknown = await root(a, admin, 1, 430, null)
    await rejects(() => tasks.createProductionTask(worker, taskBody(a, '冲突规格创建', { codes: [old.codes[0], different.codes[0]] })), /不同.*包装规格/)
    const compatible = (await tasks.createProductionTask(worker, taskBody(a, '等价单位任务', { codes: [old.codes[0], equivalent.codes[0], unknown.codes[0]] }))).id
    await rejects(() => tasks.appendProductionTask(worker, compatible, { requestId: randomUUID(), codes: [different.codes[0]] }), /不同.*包装规格/)
    await rejects(() => tasks.editProductionTask(worker, compatible, { requestId: randomUUID(), name: '追加冲突', allocation: { codes: [different.codes[0]] } }), /不同.*包装规格/)
    assert.equal((await tasks.appendProductionTask(worker, compatible, { requestId: randomUUID(), codes: [equivalent.codes[1]] })).added, 1)
    assert.equal((await one('SELECT status FROM trace_code WHERE code=?', [different.codes[0]])).status, 1)
    assert.equal((await one('SELECT name FROM production_task WHERE id=?', [compatible])).name, '等价单位任务')
  })

  // 大规模数量夹具使用批量SQL造一致状态；不声称执行五万条真实HTTP事件上传。
  await check('十万码规模：首子批两万、次子批三万、余五万及分页/占用/可领一致', async () => {
    const large = await root(a, admin, 100000, 10000), lt = (await tasks.createProductionTask(worker, taskBody(a, '十万规模夹具任务', { codes: [large.codes[0]] }))).id, ls = await session(worker, lt)
    const task = await one('SELECT * FROM production_task WHERE id=?', [lt])
    await db.query('INSERT INTO production_task_code(task_id,code_id,active_code_id,code) SELECT ?,c.id,c.id,c.code FROM trace_code c LEFT JOIN production_task_code d ON d.task_id=? AND d.code_id=c.id WHERE c.upload_batch_id=? AND c.code<=? AND d.code_id IS NULL', [lt, lt, large.id, large.codes[64999]])
    async function period(first, last) {
      const uid = randomUUID()
      await db.execute("INSERT INTO production_collection_upload(id,session_id,task_id,first_sequence,last_sequence,state,owner_user_id,uploader_id,uploader_username,uploader_name,completed_at) VALUES (?,?,?,?,?,'completed',?,?,?,?,NOW())", [uid, ls, lt, first, last, worker.id, worker.id, worker.username, worker.name])
      const [child] = await db.execute('INSERT INTO code_usage_batch(parent_upload_batch_id,upload_id,task_id,spec_name_snapshot) VALUES (?,?,?,?)', [large.id, uid, lt, '500毫升/瓶×10'])
      const codeFirst = large.codes[first - 1], codeLast = large.codes[last - 1]
      await db.execute("UPDATE trace_code SET usage_batch_id=?,status=2,batch_id=?,batch_no='十万规模夹具任务',produce_date='2026-10-11',expire_date='2027-10-11',quality_cert_no='隔离合格证',qc_result=1,bound_at=NOW() WHERE upload_batch_id=? AND code BETWEEN ? AND ?", [child.insertId, task.batch_id, large.id, codeFirst, codeLast])
      await db.execute("UPDATE production_task_code d JOIN trace_code c ON c.id=d.code_id SET d.state='used',d.used_by=?,d.device='SQL规模夹具',d.used_line='隔离生产线',d.used_at=NOW() WHERE d.task_id=? AND c.code BETWEEN ? AND ?", [worker.id, lt, codeFirst, codeLast])
      for (let index = first - 1; index < last; index += 500) {
        const chunk = large.codes.slice(index, Math.min(index + 500, last))
        await db.query('INSERT INTO production_collection_event(event_id,session_id,sequence_no,payload_hash,code,raw_code,event_kind,result_state,reason,captured_at,upload_id) VALUES ' + chunk.map(() => "(?,?,?,REPEAT('0',64),?,?,'valid','accepted','','2026-10-11 04:30:00',?)").join(','), chunk.flatMap((code, offset) => [randomUUID(), ls, index + offset + 1, code, code, uid]))
      }
      return Number(child.insertId)
    }
    const firstId = await period(1, 20000)
    let started = Date.now(), list = await children.usageBatchChildren(worker, large.id, 1, 1)
    timings.push({ name: '十万码首子批两万聚合', elapsedMs: Date.now() - started })
    assert.equal(list.codeTotal, 100000); assert.equal(list.usedCount, 20000); assert.equal(list.remainingCount, 80000); assert.equal(list.total, 1); assert.equal(list.rows.find(r => r.id === firstId).count, 20000)
    const secondId = await period(20001, 50000)
    await db.execute("UPDATE production_collection_session SET state='completed',last_sequence=50000,accepted_count=50000,completed_at=NOW() WHERE id=?", [ls])
    started = Date.now(); list = await children.usageBatchChildren(worker, large.id, 1, 1); const page2 = await children.usageBatchChildren(worker, large.id, 2, 1)
    timings.push({ name: '十万码五万使用两页聚合', elapsedMs: Date.now() - started })
    assert.equal(list.codeTotal, 100000); assert.equal(list.usedCount, 50000); assert.equal(list.remainingCount, 50000); assert.equal(list.legacyBoundCount, 0); assert.equal(list.total, 2)
    assert.equal(list.rows.find(r => r.kind === 'used').id, secondId); assert.equal(list.rows.find(r => r.kind === 'used').count, 30000)
    assert.equal(page2.rows.find(r => r.kind === 'used').id, firstId); assert.equal(page2.rows.find(r => r.kind === 'used').count, 20000)
    const remaining = list.rows.find(r => r.kind === 'remaining'); assert.equal(remaining.count, 50000); assert.equal(remaining.occupiedCount, 15000); assert.equal(remaining.availableCount, 35000)
    console.log('本机SQL规模聚合计时：' + JSON.stringify(timings))
  })

  if (process.env.NZ315_TEST_BUILD_DIR) {
    await startHttp(); const wc = await login(worker), ac = await login(admin), vc = await login(viewer), sc = await login(stranger)
    await check('HTTP真实路由：权限、父子明细和生产更正预览', async () => { assert.equal((await request('/api/admin/codes/usage-batches/' + child1 + '/correct')).status, 401); assert.equal((await request('/api/admin/codes/usage-batches/' + child1 + '/correct', sc)).status, 404); assert.equal(ok(await request('/api/admin/codes/upload-batches/' + r1.id + '/children', wc)).total, 2); const detail = ok(await request('/api/admin/codes?usageBatchId=' + child1, vc)); assert.equal(detail.total, 2); assert.ok(detail.rows.every(r => r.usageBatchId === child1 && r.taskId === t1)); assert.equal(ok(await request('/api/admin/codes?uploadBatchId=' + r1.id + '&scope=remaining', vc)).total, 8); assert.equal((await request('/api/admin/codes/usage-batches/' + child1 + '/flag', vc, { flag: 1 })).status, 403); assert.equal((await request('/api/admin/codes/usage-batches/' + child1, ac, undefined, 'DELETE')).status, 409); assert.equal(ok(await request('/api/admin/codes/usage-batches/' + child1 + '/correct', ac)).task.batchNo, '任务甲更正批号') })
    await check('HTTP已用和剩余导出严格按范围，真实账号日志记录', async () => { const used = await request('/api/admin/codes/usage-batches/' + child1 + '/export', vc); assert.equal(used.status, 200); assert.deepEqual(used.data.replace(/^\uFEFF/, '').trim().split('\n'), [r1.codes[0], r1.codes[1]]); const remaining = await request('/api/admin/codes/upload-batches/' + r1.id + '/export?scope=remaining', vc); assert.equal(remaining.status, 200); assert.equal(remaining.data.trim().split('\n').length, 8); assert.ok(!remaining.data.includes(r1.codes[0])); assert.ok(Number((await one("SELECT COUNT(*) AS n FROM operation_log WHERE action='导出留档码'")).n) >= 2) })
    const hr = await root(a, admin, 2, 300), ht = (await tasks.createProductionTask(worker, taskBody(a, 'HTTP协议任务', { codes: hr.codes }))).id, hs = randomUUID(), hu = randomUUID(), route = '/api/admin/production-tasks/' + ht + '/collection-sessions/' + hs
    await check('HTTP上传登记、自动收据、完成本次上传、结束会话与新子批', async () => { ok(await request('/api/admin/production-tasks/' + ht + '/collection-sessions', wc, { sessionId: hs, device: 'HTTP设备' })); assert.equal(ok(await request(route + '/uploads', wc, { uploadId: hu, firstSequence: 1 })).state, 'open'); const response = ok(await request(route + '/events', wc, { uploadId: hu, events: [event(hr.codes[0], 1)] })); assert.equal(response.uploadId, hu); assert.equal(response.receipts[0].state, 'accepted'); assert.equal(ok(await request(route + '/uploads/' + hu + '/complete', wc, { lastSequence: 1 })).state, 'completed'); ok(await request(route + '/complete', wc, { lastSequence: 1, endTask: false })); assert.equal(ok(await request('/api/admin/codes/upload-batches/' + hr.id + '/children', wc)).total, 1) })
    await check('HTTP真实独立设备认证上传全链路与空个人账号、不冒用管理员', async () => {
      const registered = ok(await request('/api/admin/production-devices', ac, { name: '隔离真实设备', lineName: '隔离生产线' })), token = JSON.parse(Buffer.from(registered.activationCode.slice(13), 'base64url')).token, credential = randomBytes(32).toString('hex')
      ok(await request('/api/device/activate', '', { token, credential, instanceId: randomUUID(), model: '隔离Android', androidId: 'isolated-test' }))
      const ds = randomUUID(), du = randomUUID(), deviceRoute = '/api/device/production-tasks/' + ht + '/collection-sessions/' + ds
      assert.equal((await request(deviceRoute + '/uploads', '', { uploadId: du, firstSequence: 1 })).status, 401)
      ok(await request('/api/device/production-tasks/' + ht + '/collection-sessions', credential, { sessionId: ds, device: '不能冒用上传者' }))
      assert.equal(ok(await request(deviceRoute + '/uploads', credential, { uploadId: du, firstSequence: 1 })).state, 'open')
      assert.equal(ok(await request(deviceRoute + '/events', credential, { uploadId: du, events: [event(hr.codes[1], 1)] })).receipts[0].state, 'accepted')
      assert.equal(ok(await request(deviceRoute + '/uploads/' + du + '/complete', credential, { lastSequence: 1 })).state, 'completed')
      ok(await request(deviceRoute + '/complete', credential, { lastSequence: 1, endTask: false }))
      const rows = ok(await request('/api/admin/codes/upload-batches/' + hr.id + '/children', vc)).rows, child = rows.find(row => row.uploadId === du)
      assert.ok(child); assert.equal(child.uploaderId, null); assert.equal(child.uploaderUsername, null); assert.equal(child.uploaderName, null)
      const saved = await one('SELECT owner_user_id,device_id,uploader_id FROM production_collection_upload WHERE id=?', [du]); assert.equal(saved.owner_user_id, 0); assert.equal(saved.device_id, registered.id); assert.equal(saved.uploader_id, null)
    })
    await check('HTTP公众追溯显示任务快照批号，共享另任务保留原批号', async () => { const trace = ok(await request('/api/trace?code=' + r1.codes[0])); assert.equal(trace.batch.batchNo, '任务甲更正批号'); const otherTrace = ok(await request('/api/trace?code=' + r1.codes[6])); assert.equal(otherTrace.batch.batchNo, '共同业务批号') })
    await check('HTTP生成签名规格经主数据修改后仍按原包装留档，普通无签名留档保持未知', async () => {
      await db.execute("UPDATE product_spec SET spec_name='500毫升/瓶×10' WHERE enterprise_id=?", [a.id])
      const generated = ok(await request('/api/admin/codes/generate', wc, { productId: a.productId, quantity: 2 }))
      assert.equal(generated.allCodes.length, 2); assert.equal(generated.product.specName, '500毫升/瓶×10'); assert.ok(generated.specSnapshotToken)
      await db.execute("UPDATE product_spec SET spec_name='1升/瓶×10' WHERE enterprise_id=?", [a.id])
      const saved = ok(await request('/api/admin/codes/stock-in', wc, { productId: a.productId, codes: generated.allCodes, specSnapshotToken: generated.specSnapshotToken, specName: '客户端伪造名称' }))
      assert.equal(saved.imported, 2); assert.equal((await one('SELECT spec_name_snapshot FROM upload_batch WHERE id=?', [saved.uploadBatchId])).spec_name_snapshot, '500毫升/瓶×10')
      const list = ok(await request('/api/admin/codes/upload-batches?uploadBatchId=' + saved.uploadBatchId, vc)); assert.equal(list.rows[0].specName, '500毫升/瓶×10')
      const external = ok(await request('/api/admin/codes/generate', wc, { productId: a.productId, quantity: 1 }))
      const unknown = ok(await request('/api/admin/codes/stock-in', wc, { productId: a.productId, codes: external.allCodes, specName: '客户端自称已知' }))
      assert.equal(unknown.imported, 1); assert.equal((await one('SELECT spec_name_snapshot FROM upload_batch WHERE id=?', [unknown.uploadBatchId])).spec_name_snapshot, null)
      assert.equal((await request('/api/admin/codes/stock-in', wc, { productId: a.productId, codes: external.allCodes, specSnapshotToken: generated.specSnapshotToken })).status, 400)
    })
  }
  fs.mkdirSync(logDirectory, { recursive: true }); fs.writeFileSync(path.join(logDirectory, 'results.json'), JSON.stringify({ databaseName, passed: results.length, results, timings, http: !!process.env.NZ315_TEST_BUILD_DIR }, null, 2))
  console.log('独立库验收共通过 ' + results.length + ' 组；数据库将清理。')
} finally {
  if (application && application.exitCode === null && application.signalCode === null) { application.kill(); await Promise.race([new Promise(resolve => application.once('exit', resolve)), delay(5000)]); assert.ok(application.exitCode !== null || application.signalCode !== null, '自建预览未停止，不能删除数据库') }
  logStream?.end(); await getPool().end(); await db?.end()
  if (created) { assert.match(databaseName, /^nz315_children_test_[0-9]+$/); await control.query('DROP DATABASE `' + databaseName + '`') }
  await control?.end()
}
