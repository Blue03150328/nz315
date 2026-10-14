// 所有造数和故障注入只在全新本机隔离库执行，退出时删除该库。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { randomBytes, randomUUID } from 'node:crypto'
import { register } from 'node:module'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { createError } from 'h3'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import XLSX from 'xlsx'
import { productionDDL, migrateProductionSchema } from '../scripts/production-schema.mjs'
import { collectionDDL } from '../scripts/collection-schema.mjs'
import { migrateUsageBatchSchema } from '../scripts/usage-batch-schema.mjs'
import { migrateDeviceSchema } from '../scripts/device-schema.mjs'
import { migrateWorkerSchema } from '../scripts/worker-schema.mjs'
import { migrateExternalCollectionSchema } from '../scripts/external-collection-schema.mjs'
register('./_ts-loader.mjs', import.meta.url)
const root = process.cwd(), env = parseEnv(fs.readFileSync('.env', 'utf8'))
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST))
const database = 'nz315_bulk_test_' + Date.now(), secret = randomBytes(48).toString('hex')
assert.match(database, /^nz315_bulk_test_\d+$/); assert.notEqual(database, env.DB_NAME)
const credentials = { host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, charset: 'utf8mb4', dateStrings: true }
globalThis.createError = createError
globalThis.useRuntimeConfig = () => ({ dbHost: credentials.host, dbPort: credentials.port, dbUser: credentials.user, dbPassword: credentials.password, dbName: database, sessionSecret: secret })
const bulk = await import('../server/utils/usage-batch-bulk.ts'), { getPool } = await import('../server/utils/db.ts')
const ext = await import('../server/utils/external-collection-admin.ts')
const control = await mysql.createConnection(credentials)
let db, application, created = false
const results = [], password = randomBytes(18).toString('hex'), logdir = path.join(root, 'logs', database)
fs.mkdirSync(logdir, { recursive: true })
const check = async (name, work) => { await work(); results.push(name); console.log('通过：' + name) }
const one = async (sql, values = []) => (await db.query(sql, values))[0][0]
let sequence = 0
async function company(label) {
  const [e] = await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES (?,'2099-12-31',1)", [label])
  const [s] = await db.execute("INSERT INTO product_spec(enterprise_id,spec_code,spec_name,net_content,content_unit,pack_unit,pack_quantity) VALUES (?,'001','500毫升/瓶×10',500,'毫升','瓶',10)", [e.insertId])
  const [p] = await db.execute("INSERT INTO product(enterprise_id,name,registration_no,spec_id,status) VALUES (?,?,?,?,1)", [e.insertId, label + '产品', 'PD20990' + e.insertId, s.insertId])
  const [b] = await db.execute("INSERT INTO batch(enterprise_id,product_id,batch_no,produce_date) VALUES (?,?,'SC001','2026-10-14')", [e.insertId, p.insertId])
  const [u] = await db.execute('INSERT INTO upload_batch(enterprise_id,product_id,file_name) VALUES (?,?,?)', [e.insertId, p.insertId, label + '码文件'])
  const [t] = await db.execute('INSERT INTO production_task(enterprise_id,product_id,batch_id,name,line_name,request_id,request_hash,created_by) VALUES (?,?,?,?,?,?,?,1)', [e.insertId, p.insertId, b.insertId, '任务002', '当前产线', randomUUID(), '0'.repeat(64)])
  return { enterprise: Number(e.insertId), product: Number(p.insertId), batch: Number(b.insertId), root: Number(u.insertId), task: Number(t.insertId) }
}
async function actor(role, enterprise) {
  const username = role + '_' + randomBytes(6).toString('hex'), [row] = await db.execute('INSERT INTO user(username,password,role,enterprise_id,status) VALUES (?,?,?,?,1)', [username, await bcrypt.hash(password, 4), role, enterprise])
  return { id: Number(row.insertId), enterprise_id: enterprise, role, username, name: '验收员', phone: null, status: 1 }
}
async function batch(company, state = 'completed', flags = [0], line = '上传产线') {
  const session = randomUUID(), upload = randomUUID()
  await db.execute("INSERT INTO production_collection_session(id,task_id,user_id,device,line_snapshot,context_hash,context_json) VALUES (?,?,1,'扫描仪一号',?,?,'{}')", [session, company.task, line, '0'.repeat(64)])
  await db.execute('INSERT INTO production_collection_upload(id,session_id,task_id,first_sequence,state,completed_at) VALUES (?,?,?,1,?,NOW())', [upload, session, company.task, state])
  const [usage] = await db.execute("INSERT INTO code_usage_batch(parent_upload_batch_id,upload_id,task_id,spec_name_snapshot) VALUES (?,?,?,'500毫升/瓶×10')", [company.root, upload, company.task])
  const codes = []
  for (const flag of flags) {
    const code = '12099011001' + String(++sequence).padStart(21, '0')
    const [row] = await db.execute('INSERT INTO trace_code(enterprise_id,product_id,batch_id,upload_batch_id,usage_batch_id,code,status,abnormal_flag) VALUES (?,?,?,?,?,?,2,?)', [company.enterprise, company.product, company.batch, company.root, usage.insertId, code, flag])
    codes.push({ id: row.insertId, code })
  }
  return { id: Number(usage.insertId), codes }
}
async function exportText(user, preview, format) {
  const output = await bulk.exportUsageSelection(user, { ...preview, format }), chunks = []
  for await (const chunk of output.stream) chunks.push(String(chunk))
  return chunks.join('')
}
try {
  await control.query('CREATE DATABASE `' + database + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); created = true
  db = await mysql.createConnection({ ...credentials, database })
  const source = fs.readFileSync('scripts/db-init.mjs', 'utf8'), start = source.indexOf('const DDL = ['), end = source.indexOf('\n];', start)
  for (const match of source.slice(start, end).matchAll(/`((?:\\[\s\S]|[^`])*)`/g)) {
    const sql = match[1].replace(/\\`/g, '`'); if (/^CREATE TABLE IF NOT EXISTS /i.test(sql)) await db.query(sql)
  }
  await db.query('ALTER TABLE trace_code ADD COLUMN upload_batch_id BIGINT NULL')
  for (const ddl of productionDDL) await db.query(ddl)
  await migrateProductionSchema(db)
  for (const ddl of collectionDDL) await db.query(ddl)
  await migrateDeviceSchema(db); await migrateWorkerSchema(db); await migrateUsageBatchSchema(db); await migrateExternalCollectionSchema(db)
  const a = await company('甲企业'), b = await company('乙企业')
  const admin = await actor('enterprise_admin', a.enterprise), viewer = await actor('viewer', a.enterprise), platform = await actor('platform_admin', null)
  const first = await batch(a, 'completed', [0, 1, 2]), second = await batch(a, 'completed', [0, 0], '上传产线二')
  const foreign = await batch(b), active = await batch(a, 'open')
  for (let i = 0; i < 21; i++) await batch(a)
  await check('手选去重、全选跨页、排除行，企业边界与完成边界相同', async () => {
    assert.equal((await bulk.previewUsageSelection(admin, { all: true, filters: {} })).batchCount, 23)
    assert.equal((await bulk.previewUsageSelection(admin, { all: true, filters: {}, excludeIds: [second.id] })).batchCount, 22)
    assert.equal((await bulk.previewUsageSelection(admin, { ids: [first.id, first.id] })).codeTotal, 3)
    for (const id of [foreign.id, active.id]) await assert.rejects(() => bulk.previewUsageSelection(admin, { ids: [first.id, id] }), /不属于本企业/)
    assert.equal((await bulk.previewUsageSelection(platform, { all: true, filters: {} })).batchCount, 24)
  })
  await check('产线快照和设备分别筛选，不使用任务当前产线冒充上传产线', async () => {
    assert.equal((await bulk.previewUsageSelection(admin, { all: true, filters: { lineName: '上传产线二', deviceName: '扫描仪一号' } })).batchCount, 1)
    await assert.rejects(() => bulk.previewUsageSelection(admin, { all: true, filters: { lineName: '当前产线' } }), /没有已完成/)
  })
  await check('三种批量导出保留全部码含终态，按所选批次不重复', async () => {
    const preview = await bulk.previewUsageSelection(viewer, { ids: [first.id, second.id] })
    const txt = await exportText(viewer, preview, 'txt'), urls = await exportText(viewer, preview, 'urls'), csv = await exportText(viewer, preview, 'csv')
    for (const code of [...first.codes, ...second.codes]) { assert.equal(txt.split(code.code).length - 1, 1); assert.ok(urls.includes('trace?code=' + code.code)); assert.ok(csv.includes(code.code)) }
    assert.equal(txt.replace(/^\uFEFF/, '').trim().split(/\r?\n/).length, 5)
  })
  await check('批量冻结和恢复只改可操作状态，作废为终态，viewer及混入外企拒绝', async () => {
    let preview = await bulk.previewUsageSelection(admin, { ids: [first.id, second.id] })
    await assert.rejects(() => bulk.flagUsageSelection(viewer, { ...preview, flag: 1 }), /不能批量编辑/)
    assert.equal((await bulk.flagUsageSelection(admin, { ...preview, flag: 1 })).affected, 3)
    preview = await bulk.previewUsageSelection(admin, { ids: [first.id, second.id] })
    assert.equal((await bulk.flagUsageSelection(admin, { ...preview, flag: 0 })).affected, 4)
    preview = await bulk.previewUsageSelection(admin, { ids: [first.id, second.id] })
    await assert.rejects(() => bulk.flagUsageSelection(admin, { ...preview, flag: 2 }), /填写原因/)
    assert.equal((await bulk.flagUsageSelection(admin, { ...preview, flag: 2, reason: '验收作废' })).affected, 4)
    preview = await bulk.previewUsageSelection(admin, { ids: [first.id, second.id] })
    assert.equal(preview.voidedCount, 5)
    await assert.rejects(() => bulk.flagUsageSelection(admin, { ...preview, flag: 0 }), /没有可恢复/)
  })
  await check('审计失败整次回滚，不留部分冻结或不完整日志', async () => {
    const target = await batch(a), preview = await bulk.previewUsageSelection(admin, { ids: [target.id] })
    await db.query("CREATE TRIGGER bulk_fail_audit BEFORE INSERT ON operation_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='隔离注入审计失败'")
    try { await assert.rejects(() => bulk.flagUsageSelection(admin, { ...preview, flag: 1 }), /隔离注入/); assert.equal((await one('SELECT abnormal_flag FROM trace_code WHERE id=?', [target.codes[0].id])).abnormal_flag, 0) }
    finally { await db.query('DROP TRIGGER bulk_fail_audit') }
  })
  await check('全选预览后新增上传或状态变化拒绝提交，重新预览可操作', async () => {
    const preview = await bulk.previewUsageSelection(admin, { all: true, filters: {} })
    await batch(a)
    await assert.rejects(() => bulk.flagUsageSelection(admin, { ...preview, flag: 1 }), /重新预览/)
    const next = await bulk.previewUsageSelection(admin, { all: true, filters: {} })
    assert.ok((await bulk.flagUsageSelection(admin, { ...next, flag: 1 })).affected > 0)
    await assert.rejects(() => bulk.exportUsageSelection(admin, { ...next, format: 'txt' }), /重新预览/)
  })
  await check('外部页面字段筛选保持批次去重和产品规格，手填产品不造规格', async () => {
    const id = randomUUID()
    await db.execute("INSERT INTO external_collection_batch(id,enterprise_id,device_id,device_name_snapshot,line_name_snapshot,worker_no,state,product_id,product_name_snapshot,batch_no,produce_date,created_at,completed_at) VALUES (?,?,1,'外部设备','外部线','003','completed',?,'外部甲产品','WB001','2026-10-14','2026-10-14 09:00:00','2026-10-14 10:00:00')", [id, a.enterprise, a.product])
    const listed = await ext.listExternalCollections(admin, { lineName: '外部线', deviceName: '外部设备', batchNo: 'WB001', dateFrom: '2026-10-14', dateTo: '2026-10-14' })
    assert.equal(listed.total, 1); assert.equal(listed.rows[0].linked_spec_name, '500毫升/瓶×10')
    assert.equal((await ext.listExternalCollections(viewer, { dateTo: '2026-10-13' })).total, 0)
    await assert.rejects(() => ext.listExternalCollections(admin, { dateFrom: '2026-02-30' }), /日期筛选/)
  })
  await check('外部码库多选与查询全选导出保持原文，只读可导出，活跃和跨企拒绝', async () => {
    const first = (await ext.listExternalCollections(admin, {})).rows[0], id = randomUUID(), foreignId = randomUUID(), raw = 'https://标签.invalid/?code=00001&值="中文",002'
    await db.execute("INSERT INTO external_collection_batch(id,enterprise_id,device_id,device_name_snapshot,line_name_snapshot,worker_no,state,accepted_count) VALUES (?,?,1,'外部设备','外部线','004','completed',1),(?,?,1,'外企设备','乙线','001','completed',0)", [id, a.enterprise, foreignId, b.enterprise])
    await db.execute('INSERT INTO external_trace_code(enterprise_id,batch_id,raw_code,raw_hash,sequence_no,captured_at) VALUES (?,?,?,?,1,NOW())', [a.enterprise, id, raw, 'a'.repeat(64)])
    const preview = await ext.previewExternalExport(viewer, { all: true, filters: { lineName: '外部线' } })
    assert.equal(preview.batchCount, 2); assert.equal(preview.codeTotal, 1)
    const output = await ext.exportExternalSelection(viewer, { ...preview, format: 'txt' }), chunks = []
    for await (const chunk of output.stream) chunks.push(String(chunk))
    assert.equal(chunks.join(''), raw + '\r\n')
    assert.equal((await ext.previewExternalExport(viewer, { all: true, filters: {}, excludeIds: [first.id] })).batchCount, 1)
    await assert.rejects(() => ext.previewExternalExport(viewer, { ids: [id, foreignId] }), /不属于本企业/)
    await db.execute("UPDATE external_collection_batch SET state='active' WHERE id=?", [id])
    await assert.rejects(() => ext.exportExternalSelection(viewer, { ...preview, format: 'txt' }), /重新预览/)
    await assert.rejects(() => ext.previewExternalExport(viewer, { ids: [id] }), /尚未完成/)
  })
  let workerUsage, stockProduct
  await check('工人上传无旧会话时按设备产线快照和本次产品筛选，批量冻结恢复可用', async () => {
    const [product] = await db.execute("INSERT INTO product(enterprise_id,name,registration_no,spec_id,status) SELECT enterprise_id,'库存产品','PD20999888',spec_id,1 FROM product WHERE id=?", [a.product])
    stockProduct = Number(product.insertId)
    workerUsage = await batch(a)
    const run = randomUUID(), session = randomUUID()
    await db.execute("INSERT INTO worker_run(id,device_id,enterprise_id,product_id,mode,context_json,context_hash,state,device_snapshot) VALUES (?,1,?,?,'internal','{}',?,'ended',?)", [run, a.enterprise, stockProduct, '0'.repeat(64), JSON.stringify({ lineName: '工人上传产线' })])
    await db.execute("INSERT INTO worker_session(id,run_id,device_id,user_id,grant_id,identity_json,state) VALUES (?,?,1,?,?,'{}','ended')", [session, run, admin.id, randomUUID()])
    await db.execute("UPDATE production_collection_upload u JOIN code_usage_batch cb ON cb.upload_id=u.id SET u.session_id=NULL,u.worker_session_id=?,u.source_kind='worker',u.device_name_snapshot='工人设备',cb.product_id=?,cb.production_snapshot=? WHERE cb.id=?", [session, stockProduct, JSON.stringify({ batch_no: 'WORK001', produce_date: '2026-10-13' }), workerUsage.id])
    const selection = { all: true, filters: { productId: stockProduct, lineName: '工人上传产线', deviceName: '工人设备', batchNo: 'WORK001' } }
    let preview = await bulk.previewUsageSelection(admin, selection)
    assert.equal(preview.batchCount, 1); assert.equal(preview.codeTotal, 1)
    assert.equal((await bulk.flagUsageSelection(admin, { ...preview, flag: 1 })).affected, 1)
    preview = await bulk.previewUsageSelection(admin, selection)
    assert.equal((await bulk.flagUsageSelection(admin, { ...preview, flag: 0 })).affected, 1)
  })
  if (process.env.NZ315_TEST_BUILD_DIR) {
    const dir = path.resolve(process.env.NZ315_TEST_BUILD_DIR), port = 3194, base = 'http://127.0.0.1:' + port
    const output = fs.createWriteStream(path.join(logdir, 'server.log'))
    application = spawn(process.execPath, [path.join(dir, '.output/server/index.mjs')], { cwd: dir, windowsHide: true, env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port), NUXT_DB_HOST: credentials.host, NUXT_DB_PORT: String(credentials.port), NUXT_DB_USER: credentials.user, NUXT_DB_PASSWORD: credentials.password, NUXT_DB_NAME: database, NUXT_SESSION_SECRET: secret }, stdio: ['ignore', 'pipe', 'pipe'] })
    application.stdout.pipe(output, { end: false }); application.stderr.pipe(output, { end: false })
    async function request(url, cookie = '', body) { const res = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, data: await res.text(), cookie: res.headers.get('set-cookie')?.split(';')[0] } }
    for (let i = 0; i < 80; i++) { try { if ((await request('/api/auth/me')).status === 200) break } catch {} await delay(250) }
    const ac = (await request('/api/auth/login', '', { username: admin.username, password })).cookie, vc = (await request('/api/auth/login', '', { username: viewer.username, password })).cookie
    await check('真实HTTP批量接口鉴权、列表列字段与跨页数量', async () => {
      assert.equal((await request('/api/admin/codes/usage-batches/preview', '', { selection: { ids: [first.id] } })).status, 401)
      const list = JSON.parse((await request('/api/admin/codes/usage-batches?pageSize=20', ac)).data)
      assert.equal(list.rows.length, 20); assert.ok(list.total > 20); assert.ok(list.rows.every(row => row.lineName && row.deviceName)); assert.deepEqual(list.selectionFilters, {})
      const worker = JSON.parse((await request('/api/admin/codes/usage-batches?productId=' + stockProduct, ac)).data)
      assert.equal(worker.total, 1); assert.equal(worker.rows[0].id, workerUsage.id)
      assert.equal(worker.rows[0].productName, '库存产品'); assert.equal(worker.rows[0].lineName, '工人上传产线')
      assert.equal(worker.rows[0].deviceName, '工人设备'); assert.equal(worker.rows[0].batchNo, 'WORK001')
      assert.equal(worker.rows[0].produceDate, '2026-10-13')
      const preview = JSON.parse((await request('/api/admin/codes/usage-batches/preview', vc, { selection: { all: true, filters: {} } })).data)
      assert.equal((await request('/api/admin/codes/usage-batches/flag', vc, { ...preview, flag: 0 })).status, 403)
      assert.equal((await request('/api/admin/codes/usage-batches/export', vc, { ...preview, format: 'txt' })).status, 200)
      assert.equal((await request('/api/admin/codes/usage-batches/flag', ac, { ...preview, flag: 0 })).status, 200)
    })
    await check('规格导入真实HTTP兼容旧库名称，标准新写法不会重复入库', async () => {
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['规格'], ['500毫升×10瓶'], ['200毫升×5瓶']]), '规格')
      const form = new FormData()
      form.append('file', new Blob([XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })]), '规格.xlsx')
      const response = await fetch(base + '/api/admin/specs/import', { method: 'POST', headers: { cookie: ac }, body: form })
      assert.equal(response.status, 200)
      const data = await response.json(); assert.equal(data.success, 1); assert.equal(data.failed, 1)
      assert.equal(Number((await one('SELECT COUNT(*) AS n FROM product_spec WHERE enterprise_id=?', [a.enterprise])).n), 2)
      assert.ok(await one("SELECT id FROM product_spec WHERE enterprise_id=? AND spec_name='200毫升×5瓶' AND pack_quantity=5", [a.enterprise]))
    })
    await check('单码恢复也不能复活批量作废终态', async () => {
      const response = await fetch(base + '/api/admin/codes/' + first.codes[0].id, { method: 'PATCH', headers: { cookie: ac, 'Content-Type': 'application/json' }, body: JSON.stringify({ flag: 0 }) })
      assert.equal(response.status, 400)
      assert.equal((await one('SELECT abnormal_flag FROM trace_code WHERE id=?', [first.codes[0].id])).abnormal_flag, 2)
    })
    application.kill(); await new Promise(resolve => application.once('exit', resolve)); output.end(); application = null
  }
  fs.writeFileSync(path.join(logdir, 'results.json'), JSON.stringify({ passed: results.length, results }, null, 2))
  console.log('隔离SQL/HTTP验收通过 ' + results.length + ' 组')
} finally {
  if (application) { application.kill(); await new Promise(resolve => application.once('exit', resolve)) }
  await getPool().end(); await db?.end()
  if (created) { assert.match(database, /^nz315_bulk_test_\d+$/); await control.query('DROP DATABASE `' + database + '`') }
  await control.end()
}
