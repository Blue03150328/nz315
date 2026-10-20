// 仅复制原库表结构，全部写入临时库，结束清理；不写真实产品或服务器。
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { parseEnv } from 'node:util'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { register } from 'node:module'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import XLSX from 'xlsx'
register('./_ts-loader.mjs', import.meta.url)
const { PRODUCT_EXPORT_HEADERS } = await import('../shared/utils/product-export.ts')
if (process.env.NZ315_PRODUCT_EXPORT_TEST !== '1') { console.log('默认跳过；设置NZ315_PRODUCT_EXPORT_TEST=1运行本机隔离测试'); process.exit(0) }
const env = parseEnv(fs.readFileSync('.env', 'utf8'))
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST))
const database = 'product_export_test_' + Date.now(), port = 38419, base = 'http://127.0.0.1:' + port
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true })
let server, created = false
const results = []
const ok = r => { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data }
async function check(name, action) { await action(); results.push(name); console.log('通过：' + name) }
async function request(url, cookie = '', body) {
  const res = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] }
}
function readExcel(buffer) { const b = XLSX.read(buffer, { type: 'buffer' }); return XLSX.utils.sheet_to_json(b.Sheets[b.SheetNames[0]], { header: 1, defval: '' }) }
async function download(cookie, query = '') {
  const res = await fetch(base + '/api/admin/products/export' + query, { headers: { cookie } })
  assert.equal(res.status, 200, await (res.status !== 200 ? res.text() : Promise.resolve('')))
  assert.match(res.headers.get('content-type'), /spreadsheetml/)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  return Buffer.from(await res.arrayBuffer())
}
try {
  const [tables] = await db.query('SHOW TABLES'), definitions = []
  for (const row of tables) { const [[ddl]] = await db.query('SHOW CREATE TABLE ??', [Object.values(row)[0]]); definitions.push(ddl['Create Table']) }
  await db.query('CREATE DATABASE ?? CHARACTER SET utf8mb4', [database]); created = true
  await db.changeUser({ database }); await db.query('SET FOREIGN_KEY_CHECKS=0')
  for (const ddl of definitions) await db.query(ddl)
  await db.query('SET FOREIGN_KEY_CHECKS=1')
  const enterprises = []
  for (const name of ['产品导出甲有限公司', '产品导出乙有限公司']) { const [r] = await db.query("INSERT INTO enterprise(name,renew_expire) VALUES(?,'2099-12-31')", [name]); enterprises.push(r.insertId) }
  const [a, b] = enterprises
  const password = randomBytes(18).toString('hex'), hashed = await bcrypt.hash(password, 4)
  for (const [username, role, enterpriseId] of [['export_admin', 'enterprise_admin', a], ['export_other', 'enterprise_admin', b], ['export_viewer', 'viewer', a], ['export_platform', 'platform_admin', null]]) await db.query('INSERT INTO user(username,password,name,role,enterprise_id) VALUES(?,?,?,?,?)', [username, hashed, username, role, enterpriseId])
  const [spec] = await db.query("INSERT INTO product_spec(enterprise_id,spec_name,net_content,content_unit,pack_unit,pack_quantity,spec_code) VALUES(?,'500克×20瓶',500,'克','瓶',20,'001')", [a])
  const [spec2] = await db.query("INSERT INTO product_spec(enterprise_id,spec_name,spec_code) VALUES(?,'乙规格','002')", [b])
  const ids = []
  for (let i = 0; i < 125; i++) {
    const [p] = await db.query('INSERT INTO product(enterprise_id,name,trademark,registration_no,spec_id,produce_type,category,status) VALUES(?,?,?,?,?,?,?,?)', [a, '验收农药' + i, '验收商标' + i, 'PD20991234', spec.insertId, i % 3 + 1, i % 2 ? '杀虫剂' : '杀菌剂', i % 4 ? 1 : 0])
    ids.push(p.insertId)
    for (let j = 0; j < i % 4; j++) await db.query('INSERT INTO product_original(product_id,ingredient,reg_no,company) VALUES(?,?,?,?)', [p.insertId, '成分' + j, `PD原药${i}-${j}`, '原药企业'])
  }
  const [foreign] = await db.query("INSERT INTO product(enterprise_id,name,trademark,registration_no,spec_id,produce_type) VALUES(?,'外企业农药','外企业商标','PD20991234',?,3)", [b, spec2.insertId])
  await db.query("INSERT INTO product_original(product_id,reg_no,company) VALUES(?,'PD外企业原药','外企业原药厂')", [foreign.insertId])
  const [beforeProducts] = await db.query('SELECT * FROM product ORDER BY id'), [beforeOriginals] = await db.query('SELECT * FROM product_original ORDER BY id')
  const build = path.resolve(process.env.NZ315_PRODUCT_EXPORT_BUILD || 'logs/product-seven-build-20261017'), log = fs.openSync('logs/product-export-api-server-20261017.log', 'w')
  server = spawn(process.execPath, [path.join(build, '.output/server/index.mjs')], { cwd: build, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_DB_HOST: env.DB_HOST, NUXT_DB_PORT: env.DB_PORT || '3306', NUXT_DB_USER: env.DB_USER, NUXT_DB_PASSWORD: env.DB_PASSWORD, NUXT_DB_NAME: database, NUXT_SESSION_SECRET: randomBytes(48).toString('hex') } }); fs.closeSync(log)
  let ready = false
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/auth/me')).ok) { ready = true; break } } catch {} await new Promise(r => setTimeout(r, 200)) }
  assert.ok(ready)
  const login = async username => { const r = await request('/api/auth/login', '', { username, password }); ok(r); return r.cookie }
  const admin = await login('export_admin'), other = await login('export_other'), viewer = await login('export_viewer'), platform = await login('export_platform')
  await check('未登录导出拒绝；八列跨页导出全部125个产品，备注含名称规格且规格码001保留', async () => {
    assert.equal((await fetch(base + '/api/admin/products/export')).status, 401)
    const rows = readExcel(await download(admin, '?page=3&pageSize=1'))
    assert.deepEqual(rows[0], PRODUCT_EXPORT_HEADERS); assert.equal(rows.length, 126)
    assert.ok(rows.slice(1).every(row => row.length === 8 && row[3] === '001'))
    assert.ok(rows.slice(1).every(row => row[7] === row[2].replace('验收商标', '验收农药') + ' · 500克×20瓶'))
    assert.equal(rows[1][2], '验收商标124'); assert.equal(rows[1][0], '委托加工')
  })
  await check('原药0至3条固定三列，按原药id稳定排列，缺失位置为空', async () => {
    for (let i = 0; i < 4; i++) {
      const rows = readExcel(await download(admin, '?productId=' + ids[i]))
      assert.equal(rows.length, 2)
      assert.deepEqual(rows[1].slice(4, 7), [0, 1, 2].map(j => j < i ? `PD原药${i}-${j}` : ''))
    }
    assert.deepEqual(readExcel(await download(admin, '?productId=' + ids[3]))[1], readExcel(await download(admin, '?productId=' + ids[3]))[1])
  })
  await check('关键词、类别、状态、规格与产品ID筛选与列表全部记录一致', async () => {
    for (const query of ['?keyword=商标12', '?category=杀菌剂&status=0', '?keyword=001&status=1', '?specId=' + spec.insertId + '&keyword=农药12', '?productId=' + ids[8], '?keyword=不存在']) {
      const list = ok(await request('/api/admin/products' + query + '&pageSize=100', admin)), rows = readExcel(await download(admin, query))
      assert.equal(rows.length - 1, list.total)
      assert.deepEqual(rows.slice(1).map(row => row[2]), list.rows.map(row => row.trademark))
    }
  })
  await check('普通企业和只读账号不能跨企业导出，总部支持全部及指定企业', async () => {
    assert.equal(readExcel(await download(admin, '?enterpriseId=' + b)).length, 126)
    assert.equal(readExcel(await download(other, '?enterpriseId=' + a)).length, 2)
    assert.equal(readExcel(await download(viewer)).length, 126)
    assert.equal(readExcel(await download(platform)).length, 127)
    const rows = readExcel(await download(platform, '?enterpriseId=' + b)); assert.equal(rows.length, 2); assert.equal(rows[1][6], ''); assert.equal(rows[1][4], 'PD外企业原药')
    assert.equal((await fetch(base + '/api/admin/products/export?productId=' + foreign.insertId, { headers: { cookie: admin } })).status, 200)
    assert.equal(readExcel(await download(admin, '?productId=' + foreign.insertId)).length, 1)
    assert.equal((await fetch(base + '/api/admin/products/export?enterpriseId=错误', { headers: { cookie: platform } })).status, 400)
  })
  const { chromium } = await import(pathToFileURL(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')))
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const errors = []
    async function pageFor(cookie) {
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 } }), split = cookie.indexOf('=')
      await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: base }])
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message))
      await page.goto(base + '/admin/products'); await page.waitForLoadState('networkidle'); return page
    }
    const page = await pageFor(admin)
    await check('浏览器点击批量导出下载真实Excel，八列125条且不会跳转404', async () => {
      const event = page.waitForEvent('download'); await page.getByRole('button', { name: '批量导出', exact: true }).click()
      const file = await event; assert.equal(file.suggestedFilename(), '产品批量导出.xlsx')
      const rows = readExcel(fs.readFileSync(await file.path())); assert.equal(rows.length, 126); assert.deepEqual(rows[0], PRODUCT_EXPORT_HEADERS)
      assert.equal(page.url(), base + '/admin/products')
      await page.screenshot({ path: 'logs/product-export-browser-20261017.png', fullPage: true })
    })
    await check('浏览器关键词筛选后仅导出全部匹配，重置后恢复全量；只读可导出无写入口', async () => {
      await page.getByPlaceholder('输入产品名称、商标或登记证号').fill('验收商标12')
      const event = page.waitForEvent('download'); await page.getByRole('button', { name: '批量导出', exact: true }).click()
      const rows = readExcel(fs.readFileSync(await (await event).path()))
      assert.equal(rows.length, 7); assert.ok(rows.slice(1).every(row => row[2].startsWith('验收商标12')))
      await page.getByRole('button', { name: '重置', exact: true }).click()
      const all = page.waitForEvent('download'); await page.getByRole('button', { name: '批量导出', exact: true }).click()
      assert.equal(readExcel(fs.readFileSync(await (await all).path())).length, 126)
      const readonly = await pageFor(viewer)
      assert.equal(await readonly.getByRole('button', { name: '批量导出', exact: true }).count(), 1)
      assert.equal(await readonly.getByRole('button', { name: '新增产品', exact: true }).count(), 0)
      assert.equal(await readonly.getByRole('button', { name: '导入产品', exact: true }).count(), 0)
      assert.deepEqual(errors, [])
    })
  } finally { await browser.close() }
  await check('导出不改变产品与原药所有原字段，审计记录导出统计', async () => {
    const [afterProducts] = await db.query('SELECT * FROM product ORDER BY id'), [afterOriginals] = await db.query('SELECT * FROM product_original ORDER BY id')
    assert.deepEqual(afterProducts, beforeProducts); assert.deepEqual(afterOriginals, beforeOriginals)
    const [[log]] = await db.query("SELECT content FROM operation_log WHERE action='批量导出产品' ORDER BY id LIMIT 1"); assert.equal(JSON.parse(log.content).count, 125)
  })
  await check('历史超过三条原药明确拒绝，不静默截断；校验后恢复测试原行', async () => {
    const [extra] = await db.query("INSERT INTO product_original(product_id,reg_no,company) VALUES(?,'第四原药','旧企业')", [ids[3]])
    try {
      const res = await fetch(base + '/api/admin/products/export?productId=' + ids[3], { headers: { cookie: admin } })
      assert.equal(res.status, 400); assert.match((await res.json()).statusMessage, /超过3条/)
    } finally { await db.query('DELETE FROM product_original WHERE id=?', [extra.insertId]) }
  })
  fs.writeFileSync('logs/product-export-results-20261017.json', JSON.stringify({ results, isolatedDatabase: database, productionWrites: 0 }, null, 2))
  console.log('全部通过：' + results.length + '组；清理临时库')
} finally {
  if (server && server.exitCode === null) { server.kill(); await new Promise(r => server.once('exit', r)) }
  if (created) await db.query('DROP DATABASE IF EXISTS ??', [database])
  await db.end()
}
