// 真实SQL与可选HTTP验收仅创建全新本机隔离库，不修改项目.env或真实业务数据。
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
import { migrateExternalCollectionSchema } from '../scripts/external-collection-schema.mjs'

register('./_ts-loader.mjs', import.meta.url)
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = parseEnv(fs.readFileSync(path.join(workspace, '.env'), 'utf8'))
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST), '验收数据库主机必须为本机')
const databaseName = 'nz315_external_test_' + Date.now()
assert.match(databaseName, /^nz315_external_test_[0-9]+$/)
assert.notEqual(databaseName, env.DB_NAME)
const credentials = { host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, dateStrings: true, charset: 'utf8mb4' }
const sessionSecret = randomBytes(48).toString('hex')
globalThis.createError = createError
globalThis.useRuntimeConfig = () => ({ dbHost: credentials.host, dbPort: credentials.port, dbUser: credentials.user, dbPassword: credentials.password, dbName: databaseName, sessionSecret })
const core = await import('../server/utils/external-collection.ts')
const adminApi = await import('../server/utils/external-collection-admin.ts')
const devices = await import('../server/utils/production-devices.ts')
const { getPool } = await import('../server/utils/db.ts')
const results = [], password = randomBytes(24).toString('hex')
const logDirectory = path.join(workspace, 'logs', databaseName)
let control, db, created = false, application, logStream, base
const one = async (sql, params = []) => (await db.query(sql, params))[0][0]
async function check(name, work) { await work(); results.push(name); console.log('通过：' + name) }
async function rejects(work, pattern) { await assert.rejects(work, error => pattern.test(String(error.statusMessage || error.message))) }
const event = (rawCode, sequence) => ({ eventId: randomUUID(), sequence, rawCode, capturedAt: '2026-10-12T01:02:03.004Z' })
const start = (device, batchId, workerNo = '001') => core.startExternalCollection(device, { batchId, workerNo, lineName: device.device_line })
const sync = (device, id, events) => core.syncExternalCollection(device, id, { events })
const complete = (device, id, lastSequence) => core.completeExternalCollection(device, id, { lastSequence })
const metadata = extra => ({ productId: null, productName: '手填外部产品', batchNo: '厂内共同生产批号', produceDate: '2026-10-12', productionQuantity: null, ...extra })
async function readExport(user, id, format) { const output = await adminApi.exportExternalCollection(user, id, format); const chunks = []; for await (const chunk of output.stream) chunks.push(chunk); return Buffer.concat(chunks).toString('utf8') }
async function actor(role, enterpriseId) {
  const username = 'external_' + randomBytes(8).toString('hex')
  const [result] = await db.execute('INSERT INTO user(username,password,name,role,enterprise_id,status) VALUES (?,?,?,?,?,1)', [username, await bcrypt.hash(password, 4), '隔离验收账号', role, enterpriseId])
  return { id: Number(result.insertId), username, name: '隔离验收账号', role, enterprise_id: enterpriseId, status: 1, phone: null }
}
async function company(name, registration) {
  const [e] = await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES (?,'2099-12-31',1)", [name])
  const [s] = await db.execute("INSERT INTO product_spec(enterprise_id,spec_code,spec_name) VALUES (?,'001','500毫升/瓶')", [e.insertId])
  const [p] = await db.execute("INSERT INTO product(enterprise_id,name,registration_no,registration_expire,reg_category,produce_type,spec_id,status) VALUES (?,?,?,'2099-12-31',1,1,?,1)", [e.insertId, name + '产品', registration, s.insertId])
  return { id: Number(e.insertId), productId: Number(p.insertId) }
}
async function device(companyId, line, actorId) {
  const credential = randomBytes(32).toString('hex'), hash = core.externalHash(credential)
  const [d] = await db.execute("INSERT INTO production_device(enterprise_id,name,line_name,status,instance_id,credential_hash,created_by) VALUES (?,?,?,'enabled',?,?,?)", [companyId, '外部隔离设备', line, randomUUID(), hash, actorId])
  return { id: 0, name: '外部隔离设备', username: 'device:' + d.insertId, phone: null, status: 1, role: 'code_admin', enterprise_id: companyId, device_id: Number(d.insertId), device_line: line, device_hash: hash, credential }
}
async function createSchema() {
  const source = fs.readFileSync(path.join(workspace, 'scripts/db-init.mjs'), 'utf8'), startIndex = source.indexOf('const DDL = ['), endIndex = source.indexOf('\n];', startIndex)
  assert.ok(startIndex >= 0 && endIndex > startIndex)
  const ddl = [...source.slice(startIndex, endIndex).matchAll(/`((?:\\[\s\S]|[^`])*)`/g)].map(match => match[1].replace(/\\`/g, '`')).filter(sql => /^CREATE TABLE IF NOT EXISTS /i.test(sql))
  assert.ok(ddl.length >= 14)
  for (const sql of ddl) await db.query(sql)
  await db.query('ALTER TABLE trace_code ADD COLUMN upload_batch_id BIGINT NULL')
  for (const sql of productionDDL) await db.query(sql)
  await migrateProductionSchema(db)
  for (const sql of collectionDDL) await db.query(sql)
  await migrateDeviceSchema(db)
  await migrateExternalCollectionSchema(db)
}
async function request(route, auth, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(auth ? (/^[a-f0-9]{64}$/.test(auth) ? { authorization: 'Bearer ' + auth } : { cookie: auth }) : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) })
  const text = await response.text(); let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers }
}
const ok = response => { assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data }
const login = async user => (await request('/api/auth/login', '', { username: user.username, password })).cookie
async function startHttp() {
  const buildDir = path.resolve(process.env.NZ315_TEST_BUILD_DIR), entry = path.join(buildDir, '.output/server/index.mjs')
  assert.ok(fs.existsSync(entry), 'NZ315_TEST_BUILD_DIR必须含最新独立生产构建')
  const requested = Number(process.env.NZ315_TEST_PORT || 0)
  assert.ok(Number.isSafeInteger(requested) && requested >= 0 && requested <= 65535 && requested !== 3100, '不能占用3100开发端口')
  const probe = net.createServer(); await new Promise(resolve => probe.listen(requested, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); base = 'http://127.0.0.1:' + port
  fs.mkdirSync(logDirectory, { recursive: true }); logStream = fs.createWriteStream(path.join(logDirectory, 'server.log'))
  application = spawn(process.execPath, [entry], { cwd: buildDir, windowsHide: true, env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), NUXT_DB_HOST: credentials.host, NUXT_DB_PORT: String(credentials.port), NUXT_DB_USER: credentials.user, NUXT_DB_PASSWORD: JSON.stringify(credentials.password), NUXT_DB_NAME: databaseName, NUXT_SESSION_SECRET: sessionSecret }, stdio: ['ignore', 'pipe', 'pipe'] })
  application.stdout.pipe(logStream, { end: false }); application.stderr.pipe(logStream, { end: false })
  for (let index = 0; index < 120; index++) { assert.equal(application.exitCode, null); try { if ((await request('/api/admin/external-codes')).status === 401) return } catch { /* 等待独立生产预览启动。 */ } await delay(250) }
  throw new Error('独立生产预览未启动')
}

try {
  control = await mysql.createConnection(credentials)
  await control.query('CREATE DATABASE `' + databaseName + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); created = true
  db = await mysql.createConnection({ ...credentials, database: databaseName }); await createSchema()
  const a = await company('外部甲企业', 'PD20990001'), b = await company('外部乙企业', 'PD20990002')
  const admin = await actor('enterprise_admin', a.id), viewer = await actor('viewer', a.id), foreign = await actor('enterprise_admin', b.id), platform = await actor('platform_admin', null)
  const d1 = await device(a.id, '一号流水线', admin.id), d2 = await device(a.id, '二号流水线', admin.id), d3 = await device(b.id, '乙流水线', foreign.id)
  const batch1 = randomUUID(), batch2 = randomUUID(), batch3 = randomUUID()
  if (process.env.NZ315_TEST_DEVICE_COUNTS_ONLY === '1') {
    await start(d1, batch1)
    const [physical] = await db.execute('INSERT INTO batch(enterprise_id,product_id,batch_no,quantity) VALUES (?,?,?,0)', [a.id, a.productId, '设备统计夹具'])
    const [task] = await db.execute('INSERT INTO production_task(enterprise_id,product_id,batch_id,name,line_name,request_id,request_hash,created_by) VALUES (?,?,?,?,?,?,?,?)', [a.id, a.productId, physical.insertId, '内部统计夹具', d1.device_line, randomUUID(), '0'.repeat(64), admin.id])
    await db.execute('INSERT INTO production_collection_session(id,task_id,user_id,device,line_snapshot,context_hash,context_json,device_id) VALUES (?,?,?,?,?,?,?,?)', [randomUUID(), task.insertId, 0, d1.name, d1.device_line, '0'.repeat(64), '{}', d1.device_id])
    await check('设备列表合计内部会话与外部活跃批，其他设备及厂家不混数', async () => {
      const own = await devices.listDevices(admin), row = own.rows.find(row => row.id === d1.device_id)
      assert.equal(row.active_sessions, 2); assert.equal(row.external_active_batches, 1); assert.equal(own.rows.find(row => row.id === d2.device_id).active_sessions, 0)
      assert.ok(!own.rows.some(row => row.id === d3.device_id))
    })
    await check('设备列表旧库缺外部表保留内部统计，字段错误必须报错', async () => {
      await db.query('RENAME TABLE external_collection_batch TO isolated_hidden_batch')
      try { const row = (await devices.listDevices(admin)).rows.find(row => row.id === d1.device_id); assert.equal(row.active_sessions, 1); assert.equal(row.external_active_batches, 0) } finally { await db.query('RENAME TABLE isolated_hidden_batch TO external_collection_batch') }
      await db.query('ALTER TABLE external_collection_batch RENAME COLUMN device_id TO unavailable_device_id')
      try { await assert.rejects(() => devices.listDevices(admin), error => error.code === 'ER_BAD_FIELD_ERROR') } finally { await db.query('ALTER TABLE external_collection_batch RENAME COLUMN unavailable_device_id TO device_id') }
    })
    if (process.env.NZ315_TEST_BUILD_DIR) {
      await startHttp(); const ac = await login(admin), fc = await login(foreign)
      await check('HTTP设备列表显示外部批与内部会话总数，完成后只扣外批且企业隔离', async () => {
        const row = ok(await request('/api/admin/production-devices', ac)).rows.find(row => row.id === d1.device_id); assert.equal(row.active_sessions, 2); assert.equal(row.external_active_batches, 1)
        assert.ok(!ok(await request('/api/admin/production-devices', fc)).rows.some(row => row.id === d1.device_id))
        await complete(d1, batch1, 0)
        const completed = ok(await request('/api/admin/production-devices', ac)).rows.find(row => row.id === d1.device_id); assert.equal(completed.active_sessions, 1); assert.equal(completed.external_active_batches, 0)
      })
    }
  } else {
  const raw1 = ' https://EXAMPLE.invalid/t?code=000000001&x=%2F,"中文" ', raw2 = 'https://example.invalid/t?code=000000002'
  const e1 = event(raw1, 1), duplicateEvent = event(raw1, 1)
  await check('启动幂等、企业设备快照和工号固定，未完成不能创建下一批', async () => {
    assert.equal((await start(d1, batch1)).batch.worker_no, '001'); assert.equal((await start(d1, batch1)).lastSequence, 0)
    await rejects(() => start(d1, batch1, '002'), /不能更换工号/)
    await rejects(() => start(d1, randomUUID()), /先上传并完成/)
    await rejects(() => start(d2, batch1), /原设备/)
    await start(d2, batch2, '002'); await start(d3, batch3, '003')
  })
  await check('完整原文采集、时间保留、丢收据重放不重复计数', async () => {
    const response = await sync(d1, batch1, [e1]); assert.equal(response.receipts[0].state, 'accepted')
    assert.deepEqual((await sync(d1, batch1, [e1])).receipts, response.receipts)
    const row = await one('SELECT * FROM external_trace_code WHERE batch_id=?', [batch1]); assert.equal(row.raw_code, raw1); assert.equal(row.captured_at, '2026-10-12 01:02:03.004')
    assert.equal((await one('SELECT accepted_count FROM external_collection_batch WHERE id=?', [batch1])).accepted_count, 1)
  })
  await check('篡改原文或时间、序号缺口及其他设备均拒绝，不给错误确认', async () => {
    for (const changed of [{ ...e1, rawCode: raw2 }, { ...e1, capturedAt: '2026-10-12T01:02:04Z' }, event(raw2, 3)]) await rejects(() => sync(d1, batch1, [changed]), /不能更换|不连续/)
    await rejects(() => sync(d2, batch1, [e1]), /原设备/)
    await rejects(() => sync(d3, batch1, [e1]), /原设备/)
  })
  await check('同企业跨设备跨批次精确去重，其他企业可保存相同原文', async () => {
    assert.equal((await sync(d2, batch2, [duplicateEvent])).receipts[0].state, 'duplicate')
    assert.equal((await sync(d3, batch3, [event(raw1, 1)])).receipts[0].state, 'accepted')
    assert.equal(Number((await one('SELECT COUNT(*) AS n FROM external_trace_code WHERE raw_hash=?', [core.externalHash(raw1)])).n), 2)
  })
  await check('两设备并发相同新原文只有一条新增，收据各自连续', async () => {
    const same = 'https://example.invalid/?id=concurrent001'
    const responses = await Promise.all([sync(d1, batch1, [event(same, 2)]), sync(d2, batch2, [event(same, 2)])])
    assert.deepEqual(responses.map(response => response.receipts[0].state).sort(), ['accepted', 'duplicate'])
    assert.equal(Number((await one('SELECT COUNT(*) AS n FROM external_trace_code WHERE enterprise_id=? AND raw_hash=?', [a.id, core.externalHash(same)])).n), 1)
  })
  await check('非法换行和超过8192字节留拒绝收据，不进入码库，序号仍能前进', async () => {
    const response = await sync(d1, batch1, [event('a\nb', 3), event('a'.repeat(8193), 4)])
    assert.deepEqual(response.receipts.map(row => row.state), ['rejected', 'rejected'])
    assert.equal((await one('SELECT rejected_count FROM external_collection_batch WHERE id=?', [batch1])).rejected_count, 2)
  })
  await check('全局事件标识不可跨批复用，摘要相同原文不同明确拒绝', async () => {
    await rejects(() => sync(d2, batch2, [{ ...e1, sequence: 3 }]), /事件标识/)
    const code = 'https://example.invalid/?collision=001'
    await db.execute('INSERT INTO external_trace_code(enterprise_id,batch_id,raw_code,raw_hash,sequence_no,captured_at) VALUES (?,?,?,?,?,NOW())', [a.id, batch2, '模拟摘要冲突的另一原文', core.externalHash(code), 999])
    await rejects(() => sync(d1, batch1, [event(code, 5)]), /摘要发生冲突/)
    await db.execute('DELETE FROM external_trace_code WHERE raw_hash=?', [core.externalHash(code)])
  })
  await check('收据插入失败回滚码、计数和序号，原事件重试恢复', async () => {
    const retry = event(raw2, 5)
    await db.query("CREATE TRIGGER fail_external_event BEFORE INSERT ON external_collection_event FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='隔离注入收据失败'")
    const failed = await sync(d1, batch1, [retry]); assert.equal(failed.ok, false); assert.equal(failed.receipts.length, 0)
    assert.equal((await one('SELECT last_sequence FROM external_collection_batch WHERE id=?', [batch1])).last_sequence, 4)
    assert.equal(Number((await one('SELECT COUNT(*) AS n FROM external_trace_code WHERE raw_hash=?', [core.externalHash(raw2)])).n), 0)
    await db.query('DROP TRIGGER fail_external_event'); assert.equal((await sync(d1, batch1, [retry])).receipts[0].state, 'accepted')
  })
  await check('活跃外批阻止调换企业、删设备和再激活，完成前不能改生产资料或导出', async () => {
    await rejects(() => devices.changeDevice(platform, d1.device_id, { action: 'edit', name: '新名称', enterpriseId: b.id }, 'https://example.invalid'), /未结束.*采集|排空/)
    for (const action of [{ action: 'delete' }, { action: 'activate' }]) await rejects(() => devices.changeDevice(admin, d1.device_id, action, 'https://example.invalid'), /未结束.*采集|排空/)
    await rejects(() => adminApi.updateExternalCollection(admin, batch1, metadata({})), /先在设备完成/)
    await rejects(() => readExport(viewer, batch1, 'txt'), /先完成/)
  })
  await check('未收齐不能完成，完成幂等并保留旧收据，新事件拒绝', async () => {
    await rejects(() => complete(d1, batch1, 6), /尚未全部上传/)
    const result = await complete(d1, batch1, 5); assert.deepEqual(await complete(d1, batch1, 5), result)
    assert.equal((await start(d1, batch1)).state, 'completed'); assert.equal((await sync(d1, batch1, [e1])).receipts[0].state, 'accepted')
    await rejects(() => sync(d1, batch1, [event('late', 6)]), /已完成/)
    await complete(d2, batch2, 2); await complete(d3, batch3, 1)
  })
  await check('批量上传中途失败只确认已经提交的收据，保留待传事件后可重播补齐', async () => {
    const id = randomUUID(); await start(d2, id, '分段001')
    const first = event('https://example.invalid/?partial=001', 1), second = event('https://example.invalid/?partial=002', 2)
    await db.query("CREATE TRIGGER fail_external_second BEFORE INSERT ON external_collection_event FOR EACH ROW BEGIN IF NEW.sequence_no=2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='隔离注入第二条失败'; END IF; END")
    try {
      const failed = await sync(d2, id, [first, second]); assert.equal(failed.ok, false); assert.equal(failed.statusCode, 503); assert.deepEqual(failed.receipts.map(row => row.sequence), [1]); assert.equal(failed.retryable, true)
      assert.equal((await one('SELECT last_sequence FROM external_collection_batch WHERE id=?', [id])).last_sequence, 1)
    } finally { await db.query('DROP TRIGGER fail_external_second') }
    assert.deepEqual((await sync(d2, id, [first, second])).receipts.map(row => row.state), ['accepted', 'accepted']); await complete(d2, id, 2)
  })
  await check('完成回包丢失后设备合法调线仍可找回完成状态和原收据，不能新添码或改快照', async () => {
    // master设备编辑已移除产线输入；仅在隔离夹具中模拟归属变化，验证旧收据重播。
    await db.execute('UPDATE production_device SET line_name=? WHERE id=?', ['合法调换的新线', d2.device_id])
    const changed = { ...d2, device_line: '合法调换的新线' }
    assert.equal((await core.startExternalCollection(changed, { batchId: batch2, workerNo: '002', lineName: d2.device_line })).state, 'completed')
    assert.equal((await sync(changed, batch2, [duplicateEvent])).receipts[0].state, 'duplicate')
    assert.equal((await complete(changed, batch2, 2)).state, 'completed')
    await rejects(() => core.startExternalCollection(changed, { batchId: batch2, workerNo: '002', lineName: changed.device_line }), /不能更换生产线/)
    await rejects(() => sync(changed, batch2, [event('新加外码', 3)]), /已完成/)
    await db.execute('UPDATE production_device SET line_name=? WHERE id=?', [d2.device_line, d2.device_id])
  })
  await check('产品手输与选择、实际码数与手填数量独立，同生产批号按流水线工号区分', async () => {
    const count = (await adminApi.externalCollectionDetail(viewer, batch1, {})).total
    const r = await adminApi.updateExternalCollection(admin, batch1, metadata({ productionQuantity: 9800 })); assert.equal(r.batch.code_count, count); assert.equal(r.batch.effective_production_quantity, 9800)
    await adminApi.updateExternalCollection(admin, batch2, metadata({ productId: a.productId }))
    const records = await adminApi.listExternalCollections(viewer, { keyword: '厂内共同生产批号' }); assert.equal(records.total, 2); assert.deepEqual(records.rows.map(row => row.worker_no).sort(), ['001', '002'])
    await rejects(() => adminApi.updateExternalCollection(admin, batch1, metadata({ productId: b.productId })), /不属于本批企业/)
    await rejects(() => adminApi.updateExternalCollection(viewer, batch1, metadata({})), /只读/)
    assert.equal(Number((await one("SELECT COUNT(*) AS n FROM operation_log WHERE module='外部生产记录'")).n), 2)
  })
  await check('生产资料审计失败回滚本次更改，不改变已保存生产量和原文', async () => {
    const before = await one('SELECT product_name_snapshot,production_quantity,metadata_updated_at FROM external_collection_batch WHERE id=?', [batch1])
    await db.query("CREATE TRIGGER fail_external_metadata BEFORE INSERT ON operation_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='隔离注入生产审计失败'")
    try { await rejects(() => adminApi.updateExternalCollection(admin, batch1, metadata({ productionQuantity: 55 })), /生产审计失败/) } finally { await db.query('DROP TRIGGER fail_external_metadata') }
    assert.deepEqual(await one('SELECT product_name_snapshot,production_quantity,metadata_updated_at FROM external_collection_batch WHERE id=?', [batch1]), before)
  })
  await check('厂家及只读查询分页隔离，总部可跨企业筛选，伪造企业条件不扩大厂家范围', async () => {
    await rejects(() => adminApi.externalCollectionDetail(foreign, batch1, {}), /不属于本企业/)
    const own = await adminApi.listExternalCollections(viewer, { enterpriseId: b.id, pageSize: 1 }); assert.equal(own.total, 3); assert.equal(own.rows.length, 1)
    assert.equal((await adminApi.listExternalCollections(platform, { enterpriseId: b.id })).total, 1)
    const codes = await adminApi.listExternalCodes(viewer, { keyword: 'EXAMPLE', pageSize: 1 }); assert.ok(codes.total >= 1); assert.ok(codes.rows.every(row => row.enterprise_id === a.id))
  })
  await check('CSV含生产日期及批号，原文按列引用，TXT逐行原文不变', async () => {
    const rows = (await db.query('SELECT raw_code FROM external_trace_code WHERE batch_id=? ORDER BY sequence_no', [batch1]))[0]
    const csv = await readExport(viewer, batch1, 'csv'), txt = await readExport(viewer, batch1, 'txt')
    assert.equal(txt, rows.map(row => row.raw_code + '\r\n').join(''))
    assert.equal(csv, '\uFEFF溯源码,生产日期,生产批号\r\n' + rows.map(row => '"' + row.raw_code.replace(/"/g, '""') + '","2026-10-12","厂内共同生产批号"\r\n').join(''))
    await rejects(() => readExport(foreign, batch1, 'txt'), /不属于/)
  })
  await check('数万码SQL规模夹具分页与分段导出完整，保留前导零', async () => {
    const largeId = randomUUID(); await start(d1, largeId, '大批001')
    for (let index = 0; index < 20000; index += 1000) {
      const codes = Array.from({ length: 1000 }, (_, offset) => 'https://example.invalid/?bulk=' + String(index + offset).padStart(12, '0'))
      await db.query('INSERT INTO external_trace_code(enterprise_id,batch_id,raw_code,raw_hash,sequence_no,captured_at) VALUES ' + codes.map(() => '(?,?,?,?,?,NOW())').join(','), codes.flatMap((code, offset) => [a.id, largeId, code, core.externalHash(code), index + offset + 1]))
    }
    // 此项仅验证存储与导出规模，不声称执行了两万次真实设备事件。
    await db.execute("UPDATE external_collection_batch SET state='completed',accepted_count=20000,last_sequence=20000,completed_at=NOW() WHERE id=?", [largeId])
    const detail = await adminApi.externalCollectionDetail(viewer, largeId, { page: 200, pageSize: 100 }); assert.equal(detail.total, 20000); assert.equal(detail.rows.length, 100)
    const exported = await readExport(viewer, largeId, 'txt'); assert.equal(exported.split('\r\n').length, 20001); assert.ok(exported.startsWith('https://example.invalid/?bulk=000000000000\r\n'))
  })
  await check('按码原文查所属批次不重复计数，组合筛选、分页与批次链接保留企业隔离', async () => {
    const matched = await adminApi.listExternalCollections(viewer, { rawCode: 'example.invalid', batchId: batch1, pageSize: 1 })
    assert.equal(matched.total, 1); assert.equal(matched.rows[0].id, batch1)
    assert.equal(matched.rows[0].accepted_count, (await adminApi.externalCollectionDetail(viewer, batch1, {})).total)
    assert.equal((await adminApi.listExternalCollections(viewer, { rawCode: '不存在的原文' })).total, 0)
    const combined = await adminApi.listExternalCollections(viewer, { keyword: '一号流水线', rawCode: 'example.invalid' })
    assert.ok(combined.rows.some(row => row.id === batch1)); assert.ok(combined.rows.every(row => row.line_name === '一号流水线'))
    await rejects(() => adminApi.listExternalCollections(foreign, { batchId: batch1 }), /不属于本企业/)
    assert.equal((await adminApi.listExternalCollections(viewer, { rawCode: '%_!' })).total, 0)
  })
  await check('删除仅允许本企业可写账号操作已完成批次，审计失败整笔回滚', async () => {
    const id = randomUUID(); await start(d1, id); await sync(d1, id, [event('删除回滚夹具', 1)])
    await rejects(() => adminApi.deleteExternalCollection(admin, id), /先在设备完成/)
    await complete(d1, id, 1)
    await rejects(() => adminApi.deleteExternalCollection(viewer, id), /只读/)
    await rejects(() => adminApi.deleteExternalCollection(d1, id), /采集设备/)
    await rejects(() => adminApi.deleteExternalCollection(foreign, id), /不属于本企业/)
    await db.query("CREATE TRIGGER fail_external_delete BEFORE INSERT ON operation_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='隔离删除审计失败'")
    try { await rejects(() => adminApi.deleteExternalCollection(admin, id), /删除审计失败/) } finally { await db.query('DROP TRIGGER fail_external_delete') }
    assert.equal((await adminApi.externalCollectionDetail(viewer, id, {})).total, 1)
    assert.equal((await one('SELECT state FROM external_collection_batch WHERE id=?', [id])).state, 'completed')
  })
  await check('并发删除只留一条审计，列表详情导出同步移除，设备重播与跨批去重不复活', async () => {
    const id = randomUUID(), original = event('https://example.invalid/?deleted=000001', 1)
    await start(d1, id); await sync(d1, id, [original]); await complete(d1, id, 1)
    await Promise.all([adminApi.deleteExternalCollection(admin, id), adminApi.deleteExternalCollection(admin, id)])
    assert.equal(Number((await one("SELECT COUNT(*) AS n FROM operation_log WHERE action='删除' AND JSON_UNQUOTE(JSON_EXTRACT(content,'$.batchId'))=?", [id])).n), 1)
    assert.equal((await adminApi.listExternalCollections(viewer, { rawCode: original.rawCode })).total, 0)
    assert.equal((await adminApi.listExternalCodes(viewer, { keyword: original.rawCode })).total, 0)
    await rejects(() => adminApi.externalCollectionDetail(viewer, id, {}), /已删除/)
    await rejects(() => adminApi.exportExternalCollection(viewer, id, 'txt'), /已删除/)
    await rejects(() => adminApi.updateExternalCollection(admin, id, metadata({})), /先在设备完成/)
    assert.equal((await start(d1, id)).state, 'completed')
    assert.equal((await start(d1, id)).batch.state, 'completed')
    assert.equal((await sync(d1, id, [original])).receipts[0].state, 'accepted')
    assert.equal((await complete(d1, id, 1)).state, 'completed')
    const next = randomUUID(); await start(d1, next)
    assert.equal((await sync(d1, next, [event(original.rawCode, 1)])).receipts[0].state, 'duplicate')
    await complete(d1, next, 1)
    assert.equal((await one('SELECT state FROM external_collection_batch WHERE id=?', [id])).state, 'deleted')
  })
  await check('缺新表明确503，旧设备管理兼容缺表；其他SQL错误不伪装空记录', async () => {
    await db.query('RENAME TABLE external_collection_batch TO isolated_hidden_batch')
    try { await rejects(() => core.requireExternalCollectionSchema(), /数据库尚未升级/); assert.equal((await devices.changeDevice(admin, d2.device_id, { action: 'edit', name: '旧库兼容名称', lineName: d2.device_line, enterpriseId: a.id }, 'https://example.invalid')).ok, true) } finally { await db.query('RENAME TABLE isolated_hidden_batch TO external_collection_batch') }
    await db.query('ALTER TABLE external_collection_batch RENAME COLUMN worker_no TO unavailable_worker_no')
    try { await rejects(() => core.requireExternalCollectionSchema(), /数据库尚未升级/) } finally { await db.query('ALTER TABLE external_collection_batch RENAME COLUMN unavailable_worker_no TO worker_no') }
  })
  if (process.env.NZ315_TEST_BUILD_DIR) {
    await startHttp(); const ac = await login(admin), vc = await login(viewer), fc = await login(foreign), pc = await login(platform)
    const httpBatch = randomUUID(), rootRoute = '/api/device/external-collections', deviceRoute = rootRoute + '/' + httpBatch, adminRoute = '/api/admin/external-collections/' + httpBatch
    await check('HTTP实际路由鉴权、设备采集自动收据、封批与重播', async () => {
      assert.equal((await request(rootRoute, '', { batchId: httpBatch, workerNo: 'HTTP001' })).status, 401)
      assert.equal(ok(await request(rootRoute, d1.credential, { batchId: httpBatch, workerNo: 'HTTP001', lineName: d1.device_line })).batchId, httpBatch)
      const e = event('https://example.invalid/?HTTP=000123,"a"', 1)
      const response = ok(await request(deviceRoute + '/events', d1.credential, { events: [e] })); assert.equal(response.receipts[0].state, 'accepted')
      assert.equal((await request(deviceRoute + '/events', d2.credential, { events: [e] })).status, 403)
      assert.equal((await request(deviceRoute + '/complete', d1.credential, { lastSequence: 2 })).status, 409)
      assert.equal(ok(await request(deviceRoute + '/complete', d1.credential, { lastSequence: 1 })).state, 'completed')
      assert.deepEqual(ok(await request(deviceRoute + '/events', d1.credential, { events: [e] })).receipts, response.receipts)
    })
    await check('HTTP后台资料、只读权限、企业隔离、单批CSV/TXT下载及总部产品筛选', async () => {
      assert.equal((await request(adminRoute, fc)).status, 404); assert.equal((await request(adminRoute, vc, metadata({}), 'PATCH')).status, 403)
      assert.equal(ok(await request(adminRoute, ac, metadata({ productionQuantity: 100 }), 'PATCH')).batch.effective_production_quantity, 100)
      assert.equal(ok(await request(adminRoute, vc)).total, 1)
      const csv = await request(adminRoute + '/export?format=csv', vc), txt = await request(adminRoute + '/export?format=txt', vc)
      assert.equal(csv.status, 200); assert.match(csv.headers.get('content-disposition'), /filename\*=UTF-8/); assert.equal(txt.data, 'https://example.invalid/?HTTP=000123,"a"\r\n')
      assert.equal(ok(await request('/api/admin/products?enterpriseId=' + b.id, pc)).rows[0].enterprise_id, b.id)
      assert.ok(ok(await request('/api/admin/products?enterpriseId=' + b.id, ac)).rows.every(row => row.enterprise_id === a.id))
      assert.ok(ok(await request('/api/admin/external-codes', vc)).rows.every(row => row.enterprise_id === a.id))
    })
    await check('HTTP批次原文查询及删除接口鉴权、企业隔离和幂等', async () => {
      assert.equal(ok(await request('/api/admin/external-collections?rawCode=HTTP%3D000123', vc)).total, 1)
      assert.equal((await request(adminRoute, '', undefined, 'DELETE')).status, 401)
      assert.equal((await request(adminRoute, vc, undefined, 'DELETE')).status, 403)
      assert.equal((await request(adminRoute, fc, undefined, 'DELETE')).status, 404)
      assert.equal(ok(await request(adminRoute, ac, undefined, 'DELETE')).ok, true)
      assert.equal(ok(await request(adminRoute, ac, undefined, 'DELETE')).ok, true)
      assert.equal((await request(adminRoute, vc)).status, 404)
      assert.equal((await request(adminRoute + '/export?format=txt', vc)).status, 404)
      assert.equal(ok(await request('/api/admin/external-collections?rawCode=HTTP%3D000123', vc)).total, 0)
    })
    await check('HTTP纯外码手输产品厂家不可删除，两厂以上分组引用保护正确', async () => {
      const [pure] = await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES ('仅外部记录厂家','2099-12-31',1)")
      const pureAdmin = await actor('enterprise_admin', pure.insertId), pureDevice = await device(pure.insertId, '外部专线', pureAdmin.id), pureBatch = randomUUID()
      await start(pureDevice, pureBatch, 'PURE001'); await sync(pureDevice, pureBatch, [event('https://example.invalid/?pure=001', 1)]); await complete(pureDevice, pureBatch, 1)
      await adminApi.updateExternalCollection(pureAdmin, pureBatch, metadata({ productName: '仅手输产品' }))
      assert.equal(Number((await one('SELECT COUNT(*) AS n FROM product WHERE enterprise_id=?', [pure.insertId])).n), 0)
      const groups = ok(await request('/api/admin/users?pageSize=100', pc)); assert.ok(groups.rows.length >= 3)
      for (const id of [a.id, b.id, pure.insertId]) assert.equal(groups.rows.find(row => row.id === id).can_delete, false)
      assert.equal((await request('/api/admin/enterprises/' + pure.insertId, pc, undefined, 'DELETE')).status, 400)
      assert.ok(await one('SELECT id FROM enterprise WHERE id=?', [pure.insertId]))
    })
  }
  }
  fs.mkdirSync(logDirectory, { recursive: true }); fs.writeFileSync(path.join(logDirectory, 'results.json'), JSON.stringify({ databaseName, passed: results.length, results, http: !!process.env.NZ315_TEST_BUILD_DIR }, null, 2))
  console.log('外部采集独立库验收共通过 ' + results.length + ' 组；隔离库将清理。')
} finally {
  if (application && application.exitCode === null && application.signalCode === null) { application.kill(); await Promise.race([new Promise(resolve => application.once('exit', resolve)), delay(5000)]); assert.ok(application.exitCode !== null || application.signalCode !== null, '自建预览未停止，禁止清理数据库') }
  logStream?.end(); await getPool().end(); await db?.end()
  if (created) { assert.match(databaseName, /^nz315_external_test_[0-9]+$/); await control.query('DROP DATABASE `' + databaseName + '`') }
  await control?.end()
}
