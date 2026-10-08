// 仅本机显式开启：真实接口、并发及事务失败测试，所有夹具在finally清理。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseEnv } from 'node:util'
import { randomBytes, randomUUID } from 'node:crypto'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
if (process.env.NZ315_PRODUCTION_LIVE !== '1') { console.log('跳过：设置NZ315_PRODUCTION_LIVE=1运行本机生产任务验收'); process.exit(0) }
const env = parseEnv(fs.readFileSync('.env', 'utf8'))
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST), '禁止访问远程数据库')
const base = process.env.NZ315_TEST_BASE || 'http://127.0.0.1:3100'
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), '接口必须为本机')
const db = await mysql.createConnection({ host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true })
const tag = '__production_' + Date.now()
const password = randomBytes(18).toString('hex')
const users = [], enterprises = [], products = [], specs = [], batches = []
const trigger = 'pt_fail_' + Date.now()
let prod, otherProd, hq, owner, worker, viewer, other
let passed = 0
async function request(path, cookie = '', body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(base + path, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) })
  return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] }
}
async function check(name, work) { await work(); passed++; console.log('通过：' + name) }
const body = (codes, batchNo = tag + '_A', productId = prod) => ({ requestId: randomUUID(), name: tag, productId, batchNo, produceDate: '2026-10-08', expireDate: '2099-12-31', qcResult: 1, qualityCertNo: '测试合格证', codes })
async function fixtureEnterprise(suffix) {
  const [e] = await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES (?,'2099-12-31',1)", [tag + suffix]); enterprises.push(e.insertId)
  const [s] = await db.execute("INSERT INTO product_spec(enterprise_id,spec_code,spec_name,net_content,content_unit,pack_unit) VALUES (?,'001','验收规格',1,'克','袋')", [e.insertId]); specs.push(s.insertId)
  const reg = 'PD' + String(Date.now()).slice(-8) + suffix.replace(/\D/g, '')
  const [p] = await db.execute("INSERT INTO product(enterprise_id,name,registration_no,registration_expire,reg_category,produce_type,spec_id,status) VALUES (?,?,?,'2099-12-31',1,1,?,1)", [e.insertId, tag + suffix, reg, s.insertId]); products.push(p.insertId)
  return { id: e.insertId, prod: p.insertId, prefix: '1' + reg.slice(-6) + '1' + '001' }
}
async function account(role, ent) {
  const username = tag + '_' + users.length
  const [u] = await db.execute('INSERT INTO `user` (username,password,name,role,enterprise_id,status) VALUES (?,?,?,?,?,1)', [username, await bcrypt.hash(password, 4), tag, role, ent]); users.push(u.insertId)
  const r = await request('/api/auth/login', '', { username, password }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.cookie
}
try {
  const a = await fixtureEnterprise('1'), b = await fixtureEnterprise('2'); prod = a.prod; otherProd = b.prod
  hq = await account('platform_admin', null); owner = await account('enterprise_admin', a.id); worker = await account('code_admin', a.id); viewer = await account('viewer', a.id); other = await account('enterprise_admin', b.id)
  const codes = Array.from({ length: 2010 }, (_, i) => a.prefix + String(i + 1).padStart(21, '0'))
  const [upload] = await db.execute('INSERT INTO upload_batch(enterprise_id,file_name,product_id,created_by) VALUES (?,?,?,?)', [a.id, tag, prod, users[0]])
  for (let i = 0; i < codes.length; i += 500) {
    const chunk = codes.slice(i, i + 500)
    await db.query('INSERT INTO trace_code(enterprise_id,product_id,upload_batch_id,code,status,abnormal_flag) VALUES ' + chunk.map(() => '(?,?,?,?,1,0)').join(','), chunk.flatMap(c => [a.id, prod, upload.insertId, c]))
  }
  let task
  const first = body(codes.slice(0, 2000))
  await check('权限及具体清单校验', async () => {
    assert.equal((await request('/api/admin/production-tasks', '', first)).status, 401)
    assert.equal((await request('/api/admin/production-tasks', viewer, first)).status, 403)
    assert.equal((await request('/api/admin/production-tasks', other, first)).status, 404)
    assert.equal((await request('/api/admin/production-tasks', worker, { ...first, codes: [], quantity: 2000 })).status, 400)
    assert.equal((await request('/api/admin/production-tasks', worker, { ...first, qcResult: 0 })).status, 400)
  })
  await check('固定2000码领用、幂等创建、领用不写生产资料', async () => {
    const r = await request('/api/admin/production-tasks', worker, first); assert.equal(r.status, 200, JSON.stringify(r.data)); task = r.data.id
    assert.equal((await request('/api/admin/production-tasks', worker, first)).data.id, task)
    assert.equal((await request('/api/admin/production-tasks', worker, { ...first, name: '不同任务' })).status, 409)
    const [[cnt]] = await db.query('SELECT COUNT(*) AS n FROM trace_code WHERE product_id=? AND (status<>1 OR batch_id IS NOT NULL OR produce_date IS NOT NULL)', [prod]); assert.equal(cnt.n, 0)
    assert.equal((await request('/api/admin/production-tasks', owner, body([codes[0]], tag + '_conflict'))).status, 409)
    assert.equal((await request('/api/admin/production-tasks/' + task, other)).status, 404)
  })
  await check('旧修正、删除及批次编辑不能绕过任务占用', async () => {
    const [[code]] = await db.query('SELECT id FROM trace_code WHERE code=?', [codes[0]])
    assert.equal((await request('/api/admin/codes/batch-correct', owner, { ids: [code.id], produceDate: '2026-10-09' })).status, 409)
    assert.equal((await request('/api/admin/codes/' + code.id, owner, undefined, 'DELETE')).status, 409)
    assert.equal((await request('/api/admin/codes/upload-batches/' + upload.insertId, owner, undefined, 'DELETE')).status, 409)
    const [[t]] = await db.query('SELECT batch_id FROM production_task WHERE id=?', [task])
    assert.equal((await request('/api/admin/batches/' + t.batch_id, owner, { produceDate: '2026-10-09' }, 'PATCH')).status, 409)
  })
  await check('故障时码绑定和使用记录整体回滚', async () => {
    const [[tc]] = await db.query('SELECT id FROM trace_code WHERE code=?', [codes[1]])
    await db.query(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON production_task_code FOR EACH ROW BEGIN IF NEW.code_id=${Number(tc.id)} AND NEW.state='used' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test rollback'; END IF; END`)
    try {
      assert.equal((await request('/api/admin/production-tasks/' + task + '/scan', worker, { code: codes[1], device: '验收设备' })).status, 500)
      const [[row]] = await db.query('SELECT status,batch_id FROM trace_code WHERE id=?', [tc.id]); assert.equal(row.status, 1); assert.equal(row.batch_id, null)
    } finally { await db.query('DROP TRIGGER IF EXISTS ' + trigger) }
  })
  await check('任务创建后产品停用或冻结码不能继续生产', async () => {
    await db.execute('UPDATE product SET status=0 WHERE id=?', [prod])
    try { assert.equal((await request('/api/admin/production-tasks/' + task + '/scan', worker, { code: codes[2], device: '验收设备' })).status, 409) }
    finally { await db.execute('UPDATE product SET status=1 WHERE id=?', [prod]) }
    await db.execute('UPDATE trace_code SET abnormal_flag=1 WHERE code=?', [codes[2]])
    try { assert.equal((await request('/api/admin/production-tasks/' + task + '/scan', worker, { code: codes[2], device: '验收设备' })).status, 400) }
    finally { await db.execute('UPDATE trace_code SET abnormal_flag=0 WHERE code=?', [codes[2]]) }
  })
  await check('连续扫码1500、同一码并发仅一次计数', async () => {
    const repeat = await Promise.all(Array.from({ length: 8 }, () => request('/api/admin/production-tasks/' + task + '/scan', worker, { code: codes[0], device: '验收设备' })))
    assert.ok(repeat.every(r => r.status === 200)); assert.equal(repeat.filter(r => !r.data.duplicate).length, 1)
    for (let i = 1; i < 1500; i += 20) {
      const rows = await Promise.all(codes.slice(i, Math.min(i + 20, 1500)).map(code => request('/api/admin/production-tasks/' + task + '/scan', worker, { code, device: '验收设备' })))
      assert.ok(rows.every(r => r.status === 200), JSON.stringify(rows.find(r => r.status !== 200)))
      if (i % 200 === 1) console.log('采集进度：' + Math.min(i + 20, 1500))
    }
    assert.equal((await request('/api/admin/production-tasks/' + task + '/scan', worker, { code: codes[2005], device: '验收设备' })).status, 400)
  })
  let usedBefore
  await check('结束统计为1500已用/500待审核，未使用码仍无生产资料', async () => {
    const r = await request('/api/admin/production-tasks/' + task + '/end', worker, {}); assert.equal(r.status, 200); assert.equal(r.data.used, 1500); assert.equal(r.data.remaining, 500)
    assert.equal((await request('/api/admin/production-tasks/' + task + '/scan', worker, { code: codes[1500], device: '验收设备' })).status, 409)
    assert.equal((await request('/api/admin/production-tasks/' + task + '/scan', worker, { code: codes[0], device: '重试设备' })).data.duplicate, true)
    const [used] = await db.query('SELECT * FROM trace_code WHERE product_id=? AND status=2 ORDER BY id', [prod]); usedBefore = JSON.stringify(used); assert.equal(used.length, 1500)
    const detail = await request('/api/admin/production-tasks/' + task + '?state=pending&page=1', viewer); assert.equal(detail.data.rows.length, 100)
    assert.equal((await request('/api/admin/production-tasks', owner, body(codes.slice(1500, 2000), tag + '_B'))).status, 409)
    const out = await request('/api/trace?code=' + codes[1500]); assert.equal(out.data.batch, null)
  })
  await check('审核权限、退回保持占用、批准释放500且已用资料不变', async () => {
    const review = { decision: 'approve', reason: '确认未用于实物产品' }
    assert.equal((await request('/api/admin/production-tasks/' + task + '/review', worker, review)).status, 403)
    assert.equal((await request('/api/admin/production-tasks/' + task + '/review', other, review)).status, 404)
    await db.execute("UPDATE trace_code SET produce_date='2026-10-09' WHERE code=?", [codes[1500]])
    try {
      assert.equal((await request('/api/admin/production-tasks/' + task + '/review', owner, review)).status, 409)
      const [[count]] = await db.query("SELECT COUNT(*) AS n FROM production_task_code WHERE task_id=? AND state='released'", [task]); assert.equal(count.n, 0)
    } finally { await db.execute('UPDATE trace_code SET produce_date=NULL WHERE code=?', [codes[1500]]) }
    assert.equal((await request('/api/admin/production-tasks/' + task + '/review', owner, { decision: 'reject', reason: '请核对数量' })).status, 200)
    assert.equal((await request('/api/admin/production-tasks', owner, body([codes[1500]], tag + '_blocked'))).status, 409)
    const concurrent = await Promise.all([request('/api/admin/production-tasks/' + task + '/review', owner, review), request('/api/admin/production-tasks/' + task + '/review', hq, review)])
    assert.equal(concurrent.filter(r => r.status === 200).length, 1); assert.equal(concurrent.filter(r => r.status === 409).length, 1)
    const [used] = await db.query('SELECT * FROM trace_code WHERE product_id=? AND status=2 ORDER BY id', [prod]); assert.equal(JSON.stringify(used), usedBefore)
  })
  await check('下一批领用500、扫码绑定新日期，历史仍可查询', async () => {
    const r = await request('/api/admin/production-tasks', worker, { ...body(codes.slice(1500, 2000), tag + '_B'), produceDate: '2026-10-09' }); assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.equal((await request('/api/admin/production-tasks/' + r.data.id + '/scan', worker, { code: codes[1500], device: '第二批设备' })).status, 200)
    const out = await request('/api/trace?code=' + codes[1500]); assert.equal(out.data.batch.produceDate, '2026-10-09')
    assert.equal((await request('/api/admin/production-tasks', worker, body([codes[0]], tag + '_used'))).status, 400)
    const detail = await request('/api/admin/production-tasks/' + task, owner); assert.equal(detail.data.reviews.length, 2)
  })
  await check('结束与扫码并发不漏码，多设备领用同一码仅一任务成功', async () => {
    const b = body([codes[2000]], tag + '_race'); const races = await Promise.all([request('/api/admin/production-tasks', worker, b), request('/api/admin/production-tasks', owner, { ...b, requestId: randomUUID() })]); assert.equal(races.filter(r => r.status === 200).length, 1)
    const id = races.find(r => r.status === 200).data.id
    const results = await Promise.all([request('/api/admin/production-tasks/' + id + '/scan', worker, { code: codes[2000], device: '并发设备' }), request('/api/admin/production-tasks/' + id + '/end', owner, {})]);assert.equal(results[1].status,200); assert.ok([200,409].includes(results[0].status))
    const [[cnt]] = await db.query("SELECT SUM(state='used') AS used,SUM(state='pending') AS pending FROM production_task_code WHERE task_id=?", [id]); assert.equal(Number(cnt.used)+Number(cnt.pending),1);assert.equal(Number(cnt.used),results[0].status===200?1:0)
  })
  console.log('生产任务验收：' + passed + '组全部通过')
} finally {
  await db.query('DROP TRIGGER IF EXISTS ' + trigger)
  if (products.length) {
    const marks = products.map(() => '?').join(',')
    await db.query('DELETE r FROM production_task_review r JOIN production_task t ON t.id=r.task_id WHERE t.product_id IN (' + marks + ')', products)
    await db.query('DELETE d FROM production_task_code d JOIN production_task t ON t.id=d.task_id WHERE t.product_id IN (' + marks + ')', products)
    await db.query('DELETE FROM production_task WHERE product_id IN (' + marks + ')', products)
    for (const table of ['scan_log','risk_alert','trace_code','upload_batch','batch','product_original']) await db.query('DELETE FROM ' + table + ' WHERE product_id IN (' + marks + ')', products)
    await db.query('DELETE FROM product WHERE id IN (' + marks + ')', products)
  }
  for (const id of specs) await db.query('DELETE FROM product_spec WHERE id=?', [id])
  for (const id of users) { await db.query('DELETE FROM operation_log WHERE user_id=?', [id]); await db.query('DELETE FROM `user` WHERE id=?', [id]) }
  for (const id of enterprises) { await db.query('DELETE FROM message WHERE enterprise_id=?', [id]); await db.query('DELETE FROM enterprise WHERE id=?', [id]) }
  await db.end(); console.log('验收夹具已清理')
}
