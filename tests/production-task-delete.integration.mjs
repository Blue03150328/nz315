import fs from 'node:fs'
import assert from 'node:assert/strict'
import { parseEnv } from 'node:util'
import { createRequire } from 'node:module'
import { randomUUID, randomBytes } from 'node:crypto'

const require = createRequire(new URL('../package.json', import.meta.url))
const mysql = require('mysql2/promise'), bcrypt = require('bcryptjs')
const env = parseEnv(fs.readFileSync(process.env.NZ315_TEST_ENV || '.env', 'utf8'))
const database = process.env.NZ315_TEST_DB, base = process.env.NZ315_TEST_URL || 'http://127.0.0.1:38125'
assert.equal(env.DB_HOST, '127.0.0.1')
assert.match(database || '', /^pda_worker_test_\d+$/)
assert.equal(new URL(base).hostname, '127.0.0.1')
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database, dateStrings: true })
const tag = String(Date.now()).slice(-10), password = randomBytes(20).toString('hex')
let checks = 0, nextCode = 60000, nextRegistration = Number(tag.slice(-8))
async function req(path, auth = '', body, method = body === undefined ? 'GET' : 'POST') {
  const headers = { 'Content-Type': 'application/json' }
  if (auth.startsWith('nz315_user=')) headers.Cookie = auth
  else if (auth) headers.Authorization = 'Bearer ' + auth
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) })
  return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] }
}
const ok = r => { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data }
async function check(name, fn) { await fn(); checks++; console.log('通过：' + name) }
async function company(label) { const [r] = await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES (?,'2099-12-31',1)", ['delete-' + label + '-' + tag]); return r.insertId }
async function account(role, enterpriseId, label) {
  const username = 'del_' + label + '_' + tag, [r] = await db.execute('INSERT INTO user(username,password,name,role,enterprise_id,status) VALUES(?,?,?,?,?,1)', [username, await bcrypt.hash(password, 4), label, role, enterpriseId])
  const login = await req('/api/auth/login', '', { username, password })
  if (role === 'production_operator') assert.equal(login.status, 403)
  else ok(login)
  return { id: r.insertId, username, cookie: login.cookie }
}
async function product(enterpriseId, label) {
  const [s] = await db.execute("INSERT INTO product_spec(enterprise_id,spec_code,spec_name,net_content,content_unit,pack_unit) VALUES(?,'001','100毫升',100,'毫升','瓶')", [enterpriseId])
  const registration = 'PD' + String(nextRegistration++).padStart(8, '0'), head = '1' + registration.slice(-6) + '1001'
  const [p] = await db.execute("INSERT INTO product(enterprise_id,name,registration_no,registration_expire,reg_category,produce_type,spec_id,status) VALUES(?,?,?,'2099-12-31',1,1,?,1)", [enterpriseId, '删除接口测试产品' + label, registration, s.insertId])
  return { id: p.insertId, enterpriseId, head }
}
async function task(admin, worker, product, name) {
  const [file] = await db.execute('INSERT INTO upload_batch(enterprise_id,file_name,product_id,created_by) VALUES(?,?,?,?)', [product.enterpriseId, name + '.txt', product.id, admin.id])
  const codes = Array.from({ length: 4 }, () => product.head + String(nextCode++).padStart(21, '0'))
  await db.query('INSERT INTO trace_code(enterprise_id,product_id,upload_batch_id,code,status,abnormal_flag) VALUES ' + codes.map(() => '(?,?,?,?,1,0)').join(','), codes.flatMap(code => [product.enterpriseId, product.id, file.insertId, code]))
  const created = ok(await req('/api/admin/production-lines', admin.cookie, { name, lineName: name + '线', sourceUploadBatchId: file.insertId, operatorIds: [worker.id], requestId: randomUUID() }))
  return { ...created, codes, fileId: file.insertId, name }
}
async function complete(admin, t) { ok(await req('/api/admin/production-lines/' + t.id, admin.cookie, { action: 'complete', recordsComplete: true }, 'PATCH')) }
const remove = (cookie, ids) => req('/api/admin/production-tasks', cookie, { ids }, 'DELETE')

try {
  const ent = await company('本厂'), foreign = await company('其他厂')
  const admin = await account('enterprise_admin', ent, '管理员'), worker = await account('production_operator', ent, '工人')
  const viewer = await account('viewer', ent, '只读'), codeAdmin = await account('code_admin', ent, '码管理员')
  const otherAdmin = await account('enterprise_admin', foreign, '其他厂管理员'), otherWorker = await account('production_operator', foreign, '其他厂工人')
  const platform = await account('platform_admin', null, '总部')
  const p = await product(ent, '本厂'), otherProduct = await product(foreign, '其他厂')
  const t = await task(admin, worker, p, '保留历史-' + tag), active = await task(admin, worker, p, '尚在进行-' + tag)
  const otherTask = await task(otherAdmin, otherWorker, otherProduct, '其他厂-' + tag)
  await complete(otherAdmin, otherTask)

  await check('单条及批量鉴权、非管理员拒绝、参数边界与进行中任务保护', async () => {
    assert.equal((await req('/api/admin/production-tasks/' + t.id, '', undefined, 'DELETE')).status, 401)
    for (const user of [viewer, codeAdmin]) assert.equal((await remove(user.cookie, [t.id])).status, 403)
    for (const ids of [undefined, [], [null], [true], ['1'], [1.5], [0], [-1], [Number.MAX_SAFE_INTEGER + 1], Array(101).fill(t.id)]) assert.equal((await remove(admin.cookie, ids)).status, 400)
    assert.equal((await req('/api/admin/production-tasks/not-an-id', admin.cookie, undefined, 'DELETE')).status, 400)
    assert.equal((await req('/api/admin/production-tasks/' + t.id, admin.cookie, undefined, 'DELETE')).status, 409)
  })
  const added = ok(await req('/api/admin/production-devices', admin.cookie, { name: '删除验收PDA', lineName: '删除验收线' }))
  const credential = randomBytes(32).toString('hex'), activation = JSON.parse(Buffer.from(added.activationCode.slice(13), 'base64url'))
  ok(await req('/api/device/activate', '', { token: activation.token, credential, instanceId: randomUUID(), model: 'delete-test' }))
  const grant = ok(await req('/api/device/operator/login', credential, { username: worker.username, password })).grant
  assert.equal((await remove(credential, [t.id])).status, 401)
  const runId = randomUUID(), sessionId = randomUUID(), context = { mode: 'production', lineWorkflow: true, taskId: t.id, productId: p.id, batchNo: 'DEL-' + tag, produceDate: '2026-10-12', expireDate: '2027-10-12' }
  ok(await req('/api/device/worker-sessions', credential, { runId, sessionId, context, grant, startedAt: new Date().toISOString() }))
  const events = [{ eventId: randomUUID(), sequence: 1, rawCode: t.codes[0], code: t.codes[0], kind: 'valid', capturedAt: new Date().toISOString() }]
  const receipt = ok(await req('/api/device/worker-sessions/' + sessionId + '/events', credential, { events }))
  const stoppedAt = new Date().toISOString()
  ok(await req('/api/device/worker-sessions/' + sessionId + '/complete', credential, { lastSequence: 1, stoppedAt }))
  ok(await req('/api/device/worker-runs/' + runId + '/complete', credential, { sessions: [{ id: sessionId, lastSequence: 1 }] }))
  await complete(admin, t)

  await check('混合选择进行中、跨企业、不存在任务时，整批不变且不留成功删除记录', async () => {
    assert.equal((await remove(admin.cookie, [t.id, active.id])).status, 409)
    assert.equal((await remove(admin.cookie, [t.id, otherTask.id])).status, 404)
    assert.equal((await remove(admin.cookie, [t.id, Number.MAX_SAFE_INTEGER])).status, 404)
    const [[state]] = await db.query('SELECT status FROM production_task WHERE id=?', [t.id])
    assert.equal(state.status, 'completed')
    const [[audit]] = await db.query("SELECT COUNT(*) AS n FROM production_task_change WHERE task_id=? AND action='delete'", [t.id])
    assert.equal(audit.n, 0)
  })
  await check('删除时重新检查工人结束状态、上传序号与未封存批次', async () => {
    await db.execute("UPDATE worker_run SET state='active' WHERE id=?", [runId])
    assert.equal((await remove(admin.cookie, [t.id])).status, 409)
    await db.execute("UPDATE worker_run SET state='sealed' WHERE id=?", [runId])
    await db.execute('UPDATE worker_session SET final_sequence=2 WHERE id=?', [sessionId])
    assert.equal((await remove(admin.cookie, [t.id])).status, 409)
    await db.execute('UPDATE worker_session SET final_sequence=1 WHERE id=?', [sessionId])
  })
  await check('单条删除保留扫码、批次、码占用和历史详情，新旧列表均隐藏且不能编辑复活', async () => {
    const [before] = await db.query('SELECT * FROM trace_code WHERE upload_batch_id=? ORDER BY id', [t.fileId])
    const [detailsBefore] = await db.query('SELECT * FROM production_task_code WHERE task_id=? ORDER BY code_id', [t.id])
    const [eventsBefore] = await db.query('SELECT * FROM worker_event WHERE session_id=?', [sessionId])
    assert.equal(ok(await req('/api/admin/production-tasks/' + t.id, admin.cookie, undefined, 'DELETE')).deletedCount, 1)
    assert.deepEqual((await db.query('SELECT * FROM trace_code WHERE upload_batch_id=? ORDER BY id', [t.fileId]))[0], before)
    assert.deepEqual((await db.query('SELECT * FROM production_task_code WHERE task_id=? ORDER BY code_id', [t.id]))[0], detailsBefore)
    assert.deepEqual((await db.query('SELECT * FROM worker_event WHERE session_id=?', [sessionId]))[0], eventsBefore)
    assert.equal(ok(await req('/api/admin/production-lines?keyword=' + encodeURIComponent(t.name), admin.cookie)).total, 0)
    assert.ok(!ok(await req('/api/admin/production-tasks', admin.cookie)).rows.some(row => row.id === t.id))
    assert.equal(ok(await req('/api/admin/production-tasks/' + t.id, admin.cookie)).task.status, 'deleted')
    assert.equal(Number(ok(await req('/api/admin/production-tasks/' + t.id + '/worker-progress', admin.cookie)).rows[0].collected), 1)
    assert.equal((await req('/api/admin/production-lines/' + t.id, admin.cookie, { action: 'complete', recordsComplete: true }, 'PATCH')).status, 404)
    const trace = ok(await req('/api/trace?code=' + t.codes[0]))
    assert.equal(trace.batch.batchNo, context.batchNo)
    assert.equal(trace.batch.produceDate, context.produceDate)
    assert.deepEqual(ok(await req('/api/device/worker-sessions/' + sessionId + '/events', credential, { events })), receipt)
    assert.ok(!ok(await req('/api/device/worker-cache?workflow=line&kind=pools', credential)).rows.some(row => row.task_id === t.id))
  })
  await check('删除响应丢失重试幂等，操作员归属与删除审计仅记一次', async () => {
    const retry = ok(await remove(admin.cookie, [t.id]))
    assert.equal(retry.deletedCount, 0)
    assert.deepEqual(retry.alreadyDeletedIds, [t.id])
    const [audits] = await db.query("SELECT actor_id,detail FROM production_task_change WHERE task_id=? AND action='delete'", [t.id])
    assert.equal(audits.length, 1)
    assert.equal(audits[0].actor_id, admin.id)
    const detail = typeof audits[0].detail === 'string' ? JSON.parse(audits[0].detail) : audits[0].detail
    assert.equal(detail.previousStatus, 'completed')
    assert.equal(detail.historyPreserved, true)
  })
  const a = await task(admin, worker, p, '批量甲-' + tag), b = await task(admin, worker, p, '批量乙-' + tag)
  await complete(admin, a); await complete(admin, b)
  await check('多选删除去重、整批成功、数量与筛选一致，总部可跨企业管理', async () => {
    assert.equal(ok(await remove(admin.cookie, [a.id, b.id, a.id])).deletedCount, 2)
    assert.equal(ok(await req('/api/admin/production-lines?lineName=' + encodeURIComponent(a.name + '线'), admin.cookie)).total, 0)
    assert.ok(!ok(await req('/api/admin/production-lines/options', admin.cookie)).lines.includes(a.name + '线'))
    assert.equal(ok(await remove(platform.cookie, [otherTask.id])).deletedCount, 1)
  })
  const concurrent = await task(admin, worker, p, '并发删除-' + tag)
  await complete(admin, concurrent)
  await check('多设备并发删除同一任务只执行一次并保留码明细', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => remove(admin.cookie, [concurrent.id])))
    assert.equal(results.reduce((n, r) => n + ok(r).deletedCount, 0), 1)
    const [[audit]] = await db.query("SELECT COUNT(*) AS n FROM production_task_change WHERE task_id=? AND action='delete'", [concurrent.id])
    assert.equal(audit.n, 1)
    const [[codes]] = await db.query('SELECT COUNT(*) AS n FROM production_task_code WHERE task_id=?', [concurrent.id])
    assert.equal(codes.n, 4)
  })
  console.log('生产任务删除隔离验收通过：' + checks + '组')
} finally { await db.end() }
