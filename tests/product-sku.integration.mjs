// 全部写入临时本机数据库；复制原库表结构，不复制真实业务数据。
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { parseEnv } from 'node:util'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import { migrateProductSkuSchema } from '../scripts/product-sku-schema.mjs'
if (process.env.NZ315_SKU_TEST !== '1') { console.log('默认跳过；设置NZ315_SKU_TEST=1运行本机隔离测试'); process.exit(0) }
const env = parseEnv(fs.readFileSync('.env', 'utf8'))
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST))
const database = 'product_sku_test_' + Date.now(), port = 38415, base = 'http://127.0.0.1:' + port
const config = { host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, dateStrings: true }
const db = await mysql.createConnection({ ...config, database: env.DB_NAME })
const results = []
let server
async function check(name, action) { await action(); results.push(name); console.log('通过：' + name) }
async function request(url, cookie, body, method = body === undefined ? 'GET' : 'POST') {
  const res = await fetch(base + url, { method, headers: { cookie: cookie || '', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) })
  return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] }
}
const ok = r => { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data }
try {
  const [tables] = await db.query('SHOW TABLES')
  const definitions = []
  for (const row of tables) { const name = Object.values(row)[0]; const [[ddl]] = await db.query('SHOW CREATE TABLE ??', [name]); definitions.push(ddl['Create Table']) }
  await db.query('CREATE DATABASE ?? CHARACTER SET utf8mb4', [database])
  await db.changeUser({ database })
  await db.query('SET FOREIGN_KEY_CHECKS=0')
  for (const ddl of definitions) await db.query(ddl)
  await db.query('SET FOREIGN_KEY_CHECKS=1')
  const [e] = await db.query("INSERT INTO enterprise(name,renew_expire) VALUES('规格验收甲有限公司','2099-12-31')")
  const [e2] = await db.query("INSERT INTO enterprise(name,renew_expire) VALUES('规格验收乙有限公司','2099-12-31')")
  const specs = []
  for (let i = 1; i <= 125; i++) { const [s] = await db.query('INSERT INTO product_spec(enterprise_id,spec_name,spec_code,status) VALUES(?,?,?,?)', [e.insertId, i + '毫升×10瓶', String(i).padStart(3, '0'), i === 124 ? 0 : 1]); specs.push(s.insertId) }
  const [s2] = await db.query("INSERT INTO product_spec(enterprise_id,spec_name,spec_code) VALUES(?,'外厂500毫升','001')", [e2.insertId])
  const [legacy] = await db.query("INSERT INTO product(enterprise_id,name,registration_no,spec_id,trademark) VALUES(?,'历史产品','PD20990000',?,NULL)", [e.insertId, specs[123]])
  const [legacyCross] = await db.query("INSERT INTO product(enterprise_id,name,registration_no,spec_id,trademark) VALUES(?,'历史外厂规格','PD20990001',?,NULL)", [e.insertId, s2.insertId])
  const [before] = await db.query('SELECT * FROM product')
  await check('迁移可重复执行，历史产品所有原字段不变，旧全局证号唯一索引移除', async () => {
    await migrateProductSkuSchema(db); await migrateProductSkuSchema(db)
    const [after] = await db.query('SELECT ?? FROM product', [Object.keys(before[0])]); assert.deepEqual(after, before)
    const [idx] = await db.query('SHOW INDEX FROM product'); assert.ok(idx.some(r => r.Key_name === 'uq_product_sku')); assert.ok(!idx.some(r => r.Key_name === 'uq_registration_no'))
  })
  const password = randomBytes(16).toString('hex'), hashed = await bcrypt.hash(password, 4)
  for (const [name, role, ent] of [['sku_admin', 'enterprise_admin', e.insertId], ['sku_other', 'enterprise_admin', e2.insertId], ['sku_viewer', 'viewer', e.insertId], ['sku_platform', 'platform_admin', null]]) await db.query('INSERT INTO user(username,password,name,role,enterprise_id) VALUES(?,?,?,?,?)', [name, hashed, name, role, ent])
  await db.query("INSERT INTO pesticide_reg(registration_no,product_name,company) VALUES('PD20991234','测试农药','规格验收甲有限公司')")
  const build = path.resolve(process.env.NZ315_SKU_BUILD || 'logs/product-sku-build-20261015')
  const serverLog = fs.openSync('logs/product-sku-api-server-20261015.log', 'w')
  server = spawn(process.execPath, [path.join(build, '.output/server/index.mjs')], { cwd: build, windowsHide: true, stdio: ['ignore', serverLog, serverLog], env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_DB_HOST: env.DB_HOST, NUXT_DB_PORT: env.DB_PORT || '3306', NUXT_DB_USER: env.DB_USER, NUXT_DB_PASSWORD: env.DB_PASSWORD, NUXT_DB_NAME: database, NUXT_SESSION_SECRET: randomBytes(48).toString('hex') } })
  fs.closeSync(serverLog)
  let ready = false
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/auth/me')).ok) { ready = true; break } } catch {} await new Promise(r => setTimeout(r, 250)) }
  assert.ok(ready, '隔离服务器启动失败')
  const login = async username => { const r = await request('/api/auth/login', '', { username, password }); ok(r); return r.cookie }
  const admin = await login('sku_admin'), other = await login('sku_other'), viewer = await login('sku_viewer'), platform = await login('sku_platform')
  const body = { name: '测试产品', registrationNo: 'PD20991234', specId: specs[0], trademark: '甲牌', category: '杀虫剂', originals: [{ regNo: 'PD20991234', company: '原药企业' }] }
  let a, b, c
  await check('相同证号不同规格可新增，相同证号相同规格不同商标可新增', async () => {
    a = ok(await request('/api/admin/products', admin, body)).id
    b = ok(await request('/api/admin/products', admin, { ...body, specId: specs[1] })).id
    c = ok(await request('/api/admin/products', admin, { ...body, trademark: '乙牌' })).id
  })
  await check('完全相同SKU拒绝，商标首尾空白不绕过；不同企业可用相同证号', async () => {
    assert.equal((await request('/api/admin/products', admin, body)).status, 409)
    assert.equal((await request('/api/admin/products', admin, { ...body, trademark: ' 甲牌 ' })).status, 409)
    ok(await request('/api/admin/products', other, { ...body, specId: s2.insertId }))
  })
  await check('空商标与NULL同义，数据库直接写入仍阻止重复', async () => {
    ok(await request('/api/admin/products', admin, { ...body, trademark: '' }))
    assert.equal((await request('/api/admin/products', admin, { ...body, trademark: ' ' })).status, 409)
    await assert.rejects(db.query("INSERT INTO product(enterprise_id,name,registration_no,spec_id,trademark) VALUES(?,'绕过','PD20991234',?,NULL)", [e.insertId, specs[0]]), { code: 'ER_DUP_ENTRY' })
  })
  await check('编辑自己保持SKU可保存，改成别人SKU拒绝，换商标成功', async () => {
    ok(await request('/api/admin/products/' + a, admin, body, 'PATCH'))
    assert.equal((await request('/api/admin/products/' + b, admin, body, 'PATCH')).status, 409)
    ok(await request('/api/admin/products/' + b, admin, { ...body, trademark: '丙牌' }, 'PATCH'))
  })
  await check('八个并发同SKU请求只新增一条，其余明确409', async () => {
    const out = await Promise.all(Array.from({ length: 8 }, () => request('/api/admin/products', admin, { ...body, trademark: '并发牌' })))
    assert.equal(out.filter(r => r.status === 200).length, 1, JSON.stringify(out)); assert.equal(out.filter(r => r.status === 409).length, 7)
  })
  await check('厂家伪造归属仍隔离，外厂规格拒绝，停用规格不能新选', async () => {
    assert.equal((await request('/api/admin/products', admin, { ...body, trademark: '越权牌', enterpriseId: e2.insertId, specId: s2.insertId })).status, 400)
    assert.equal((await request('/api/admin/products', admin, { ...body, specId: specs[123] })).status, 400)
    assert.equal((await request('/api/admin/products/' + a, other, body, 'PATCH')).status, 404)
  })
  await check('旧产品绑定停用规格仍能编辑；改证号仍执行登记库校验', async () => {
    ok(await request('/api/admin/products/' + legacy.insertId, admin, { ...body, registrationNo: 'PD20990000', specId: specs[123], trademark: '' }, 'PATCH'))
    assert.equal((await request('/api/admin/products/' + a, admin, { ...body, registrationNo: 'PD20999999' }, 'PATCH')).status, 400)
  })
  await check('只读与未登录用户无法创建或修改产品', async () => {
    assert.equal((await request('/api/admin/products', viewer, body)).status, 403)
    assert.equal((await request('/api/admin/products/' + a, viewer, body, 'PATCH')).status, 403)
    assert.equal((await request('/api/admin/products', '', body)).status, 401)
  })
  await check('保留旧总部绑定的外厂规格，产品本人可回显与原样编辑，别人不能借产品ID越权读取', async () => {
    const kept = ok(await request('/api/admin/specs?id=' + s2.insertId + '&productId=' + legacyCross.insertId, admin)); assert.equal(kept.rows[0].id, s2.insertId)
    ok(await request('/api/admin/products/' + legacyCross.insertId, admin, { ...body, registrationNo: 'PD20990001', specId: s2.insertId, trademark: '' }, 'PATCH'))
    const denied = ok(await request('/api/admin/specs?id=' + specs[0] + '&productId=' + a, other)); assert.equal(denied.total, 0)
  })
  await check('规格全库关键词搜索可命中首100条之外，规格码、分页和已选ID可用', async () => {
    const data = ok(await request('/api/admin/specs?keyword=1毫升', admin)); assert.ok(data.rows.some(r => r.id === specs[0]))
    const byCode = ok(await request('/api/admin/specs?keyword=001', admin)); assert.equal(byCode.rows[0].id, specs[0])
    const second = ok(await request('/api/admin/specs?page=3&pageSize=50', admin)); assert.equal(second.rows.length, 25)
    const picked = ok(await request('/api/admin/specs?id=' + specs[123], admin)); assert.equal(picked.rows[0].status, 0)
  })
  await check('规格厂家筛选按角色隔离，总部支持公司名归一与企业ID筛选', async () => {
    const forged = ok(await request('/api/admin/specs?enterpriseId=' + e2.insertId, admin)); assert.equal(forged.total, 125)
    const scoped = ok(await request('/api/admin/specs?enterpriseId=' + e2.insertId, platform)); assert.equal(scoped.total, 1)
    const company = ok(await request('/api/admin/specs?company=' + encodeURIComponent('规格验收甲'), platform)); assert.equal(company.total, 125)
    const hidden = ok(await request('/api/admin/specs?id=' + s2.insertId, admin)); assert.equal(hidden.total, 0)
  })
  fs.writeFileSync('logs/product-sku-api-results-20261015.json', JSON.stringify({ database, results }, null, 2))
  console.log('全部通过：' + results.length + '组，临时库随即清理')
} finally {
  if (server) { server.kill(); await new Promise(r => server.once('exit', r)) }
  await db.query('DROP DATABASE IF EXISTS ??', [database])
  await db.end()
}
