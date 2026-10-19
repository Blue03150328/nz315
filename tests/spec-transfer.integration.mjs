// 仅在本机临时库验收，复制表结构，不复制或修改真实业务数据。
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
const { SPEC_IMPORT_HEADERS, SPEC_EXPORT_HEADERS, SPEC_TEMPLATE_HEADERS } = await import('../shared/utils/spec-transfer.ts')
if (process.env.NZ315_SPEC_TRANSFER_TEST !== '1') { console.log('默认跳过；设置NZ315_SPEC_TRANSFER_TEST=1运行本机隔离测试'); process.exit(0) }
const env = parseEnv(fs.readFileSync('.env', 'utf8'))
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST))
const database = 'spec_transfer_test_' + Date.now(), port = 38418, base = 'http://127.0.0.1:' + port
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true })
let server, created = false
const results = []
const ok = r => { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data }
async function check(name, action) { await action(); results.push(name); console.log('通过：' + name) }
async function request(url, cookie = '', body) {
  const res = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] }
}
function excel(rows) { const b = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet(rows), '规格'); return XLSX.write(b, { type: 'buffer', bookType: 'xlsx' }) }
function readExcel(buffer) { const b = XLSX.read(buffer, { type: 'buffer' }); return XLSX.utils.sheet_to_json(b.Sheets[b.SheetNames[0]], { header: 1, defval: '' }) }
function readDetails(buffer) { const b = XLSX.read(buffer, { type: 'buffer' }); return XLSX.utils.sheet_to_json(b.Sheets['规格明细'], { header: 1, defval: '' }) }
async function download(cookie, query = '') {
  const res = await fetch(base + '/api/admin/specs/export' + query, { headers: { cookie } })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /spreadsheetml/)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  return Buffer.from(await res.arrayBuffer())
}
async function importRows(cookie, buffer, enterpriseId) {
  const form = new FormData(); form.append('file', new Blob([buffer]), '规格.xlsx')
  if (enterpriseId) form.append('enterpriseId', String(enterpriseId))
  const res = await fetch(base + '/api/admin/specs/import', { method: 'POST', headers: { cookie }, body: form })
  return { status: res.status, data: await res.json() }
}
try {
  const [tables] = await db.query('SHOW TABLES'), definitions = []
  for (const row of tables) { const [[ddl]] = await db.query('SHOW CREATE TABLE ??', [Object.values(row)[0]]); definitions.push(ddl['Create Table']) }
  await db.query('CREATE DATABASE ?? CHARACTER SET utf8mb4', [database]); created = true
  await db.changeUser({ database }); await db.query('SET FOREIGN_KEY_CHECKS=0')
  for (const ddl of definitions) await db.query(ddl)
  await db.query('SET FOREIGN_KEY_CHECKS=1')
  const enterprises = []
  for (const name of ['规格导出甲有限公司', '规格导出乙有限公司', '规格重导企业', '单列重导企业']) { const [r] = await db.query("INSERT INTO enterprise(name,renew_expire) VALUES(?,'2099-12-31')", [name]); enterprises.push(r.insertId) }
  const [a, b, c, d] = enterprises
  const password = randomBytes(18).toString('hex'), hashed = await bcrypt.hash(password, 4)
  for (const [username, role, enterpriseId] of [['spec_admin', 'enterprise_admin', a], ['spec_other', 'enterprise_admin', b], ['spec_viewer', 'viewer', a], ['spec_platform', 'platform_admin', null]]) await db.query('INSERT INTO user(username,password,name,role,enterprise_id) VALUES(?,?,?,?,?)', [username, hashed, username, role, enterpriseId])
  for (let i = 1; i <= 125; i++) await db.query('INSERT INTO product_spec(enterprise_id,spec_name,net_content,content_unit,pack_unit,pack_quantity,spec_code,status) VALUES(?,?,?,?,?,?,?,?)', [a, '验收规格' + i, i, i % 2 ? '毫升' : '克', i % 2 ? '瓶' : '袋', i % 20 + 1, String(i).padStart(3, '0'), i % 3 ? 1 : 0])
  await db.query("INSERT INTO product_spec(enterprise_id,spec_name,net_content,content_unit,pack_unit,pack_quantity,spec_code) VALUES(?,'乙独有规格',500,'毫升','瓶',10,'001')", [b])
  const build = path.resolve(process.env.NZ315_SPEC_TRANSFER_BUILD || 'logs/spec-transfer-build-20261017'), log = fs.openSync('logs/spec-transfer-api-server-20261017.log', 'w')
  server = spawn(process.execPath, [path.join(build, '.output/server/index.mjs')], { cwd: build, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_DB_HOST: env.DB_HOST, NUXT_DB_PORT: env.DB_PORT || '3306', NUXT_DB_USER: env.DB_USER, NUXT_DB_PASSWORD: env.DB_PASSWORD, NUXT_DB_NAME: database, NUXT_SESSION_SECRET: randomBytes(48).toString('hex') } }); fs.closeSync(log)
  let ready = false
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/auth/me')).ok) { ready = true; break } } catch {} await new Promise(r => setTimeout(r, 200)) }
  assert.ok(ready)
  const login = async username => { const r = await request('/api/auth/login', '', { username, password }); ok(r); return r.cookie }
  const admin = await login('spec_admin'), other = await login('spec_other'), viewer = await login('spec_viewer'), platform = await login('spec_platform')
  let exported
  await check('未登录导出拒绝，首页单列标准格式全量125条，明细保留实际数量与规格码', async () => {
    assert.equal((await fetch(base + '/api/admin/specs/export')).status, 401)
    exported = await download(admin, '?page=3&pageSize=20&enterpriseId=' + b)
    const rows = readExcel(exported); assert.equal(rows.length, 126); assert.deepEqual(rows[0], SPEC_EXPORT_HEADERS)
    assert.deepEqual(rows[1], ['125毫升×6瓶']); assert.deepEqual(rows.at(-1), ['1毫升×2瓶'])
    assert.ok(rows.every(row => row.length === 1))
    const details = readDetails(exported)
    assert.equal(details.at(-1)[5], '001'); assert.equal(details[1][4], 6)
    assert.ok(details.slice(1).every(row => row[7] === '规格导出甲有限公司'))
  })
  await check('导出关键词、含量单位、包装单位和状态与列表逐条一致，空查询仅表头', async () => {
    for (const query of ['?keyword=12', '?contentUnit=克&packUnit=袋&status=0', '?keyword=001', '?keyword=不存在']) {
      const list = ok(await request('/api/admin/specs' + query + '&pageSize=100', admin))
      const buffer = await download(admin, query), rows = readExcel(buffer), details = readDetails(buffer)
      assert.equal(rows.length - 1, list.total)
      assert.deepEqual(details.slice(1).map(row => row[5]), list.rows.map(row => row.spec_code))
    }
  })
  await check('总部可导出全部和指定企业，普通企业与只读账户无法跨企业导出', async () => {
    assert.equal(readExcel(await download(platform)).length, 127)
    assert.equal(readExcel(await download(platform, '?enterpriseId=' + b)).length, 2)
    assert.equal(readExcel(await download(other, '?enterpriseId=' + a)).length, 2)
    assert.equal(readExcel(await download(viewer)).length, 126)
    assert.equal((await fetch(base + '/api/admin/specs/export?enterpriseId=错误', { headers: { cookie: platform } })).status, 400)
  })
  await check('新模板独立数量真实入库，错误数量与名称冲突不写入，正确行仍导入', async () => {
    const r = ok(await importRows(admin, excel([SPEC_IMPORT_HEADERS, ['', 500, '毫升', '瓶', 10], ['大包装', 200, '克', '袋', 20], ['', 100, '毫升', '瓶', 1.5], ['500毫升×10瓶', 500, '毫升', '瓶', 2]])))
    assert.equal(r.success, 2); assert.equal(r.failed, 2); assert.deepEqual(r.errors.map(e => e.row), [4, 5])
    const [[s]] = await db.query("SELECT * FROM product_spec WHERE enterprise_id=? AND spec_name='500毫升×10瓶'", [a]); assert.equal(s.pack_quantity, 10)
    const [[custom]] = await db.query("SELECT * FROM product_spec WHERE enterprise_id=? AND spec_name='大包装'", [a]); assert.equal(custom.pack_quantity, 20)
  })
  await check('旧单列与两列数量真实导入，重复行不覆盖原规格和数量', async () => {
    assert.equal(ok(await importRows(admin, excel([['规格'], ['600ml/瓶×12']]))).success, 1)
    assert.equal(ok(await importRows(admin, excel([['规格', '数量'], ['700ml/瓶', 24]]))).success, 1)
    assert.equal(ok(await importRows(admin, excel([['规格'], ['600毫升×12瓶']]))).success, 0)
    const [[s]] = await db.query("SELECT pack_quantity FROM product_spec WHERE enterprise_id=? AND spec_name='700毫升×24瓶'", [a]); assert.equal(s.pack_quantity, 24)
  })
  await check('导出数据可向新企业导入，数量与停用状态保持，规格码由新企业重新分配', async () => {
    const r = ok(await importRows(platform, excel(readDetails(exported)), c)); assert.equal(r.success, 125); assert.equal(r.failed, 0)
    const [[s]] = await db.query("SELECT pack_quantity,status FROM product_spec WHERE enterprise_id=? AND spec_name='验收规格123'", [c]); assert.equal(s.pack_quantity, 4); assert.equal(s.status, 0)
  })
  await check('标准格式单列导出可直接重导，数量实际入库，原企业所有字段不变', async () => {
    const [before] = await db.query('SELECT * FROM product_spec WHERE enterprise_id=? ORDER BY id', [a])
    const r = ok(await importRows(platform, exported, d)); assert.equal(r.success, 125); assert.equal(r.failed, 0)
    const [[s]] = await db.query("SELECT net_content,pack_quantity FROM product_spec WHERE enterprise_id=? AND spec_name='123毫升×4瓶'", [d]); assert.equal(Number(s.net_content), 123); assert.equal(s.pack_quantity, 4)
    const [after] = await db.query('SELECT * FROM product_spec WHERE enterprise_id=? ORDER BY id', [a]); assert.deepEqual(after, before)
  })
  await check('单列新版模板80条完整导入，首条标注数量20与截图第二条40已采用', async () => {
    const res = await fetch(base + '/templates/spec-import-template.xlsx?v=20261017-standard-times3'); assert.equal(res.status, 200)
    const buffer = Buffer.from(await res.arrayBuffer()), rows = readExcel(buffer)
    assert.deepEqual(rows[0], SPEC_TEMPLATE_HEADERS); assert.equal(rows.length, 81)
    assert.deepEqual(rows[1], ['20毫升×20瓶']); assert.deepEqual(rows[2], ['130克×40瓶'])
    const r = ok(await importRows(platform, buffer, c)); assert.equal(r.success, 80); assert.equal(r.failed, 0)
  })
  await check('旧结构化字段缺失时可解析完整旧名称；无法识别的自定义规格明确报错', async () => {
    await db.query("INSERT INTO product_spec(enterprise_id,spec_name,spec_code,pack_quantity) VALUES(?,'160毫升×5瓶','998',5),(?,'无法识别的自定义规格','999',1)", [a, a])
    assert.deepEqual(readExcel(await download(admin, '?keyword=998'))[1], ['160毫升×5瓶'])
    const res = await fetch(base + '/api/admin/specs/export?keyword=999', { headers: { cookie: admin } })
    assert.equal(res.status, 400); assert.match((await res.json()).statusMessage, /补全/)
  })
  const { chromium } = await import(pathToFileURL(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')))
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const errors = []
    async function pageFor(cookie) {
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 } }), split = cookie.indexOf('=')
      await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: base }])
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message))
      await page.goto(base + '/admin/specs'); await page.waitForLoadState('networkidle'); return page
    }
    const page = await pageFor(admin)
    await check('浏览器按关键词导出真实Excel，包含数量且不限当前页', async () => {
      await page.getByPlaceholder('规格名称或规格码').fill('验收规格')
      await page.getByRole('button', { name: '查询', exact: true }).click()
      const event = page.waitForEvent('download')
      await page.getByRole('button', { name: '导出规格', exact: true }).click()
      const file = await event; assert.equal(file.suggestedFilename(), '规格导出.xlsx')
      const buffer = fs.readFileSync(await file.path()), rows = readExcel(buffer)
      assert.equal(rows.length, 126); assert.deepEqual(rows[0], SPEC_EXPORT_HEADERS)
      await page.screenshot({ path: 'logs/spec-transfer-browser-export-20261017.png', fullPage: true })
    })
    await check('浏览器下载新版模板并上传多件规格，结果与列表数量正确', async () => {
      await page.getByRole('button', { name: '批量导入', exact: true }).click()
      const dialog = page.getByRole('dialog')
      assert.match(await dialog.innerText(), /数量/)
      const event = page.waitForEvent('download')
      await dialog.getByRole('button', { name: '下载模板', exact: true }).click()
      const template = readExcel(fs.readFileSync(await (await event).path()))
      assert.deepEqual(template[0], SPEC_TEMPLATE_HEADERS); assert.deepEqual(template[1], ['20毫升×20瓶'])
      await dialog.locator('input[type=file]').setInputFiles({ name: '外部规格.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: excel([['规格'], ['20毫升/瓶x20'], ['130克/瓶x40']]) })
      await dialog.getByRole('button', { name: '开始导入', exact: true }).click()
      await dialog.getByText(/成功.*2.*条/).first().waitFor()
      const [[s]] = await db.query("SELECT net_content,pack_quantity FROM product_spec WHERE enterprise_id=? AND spec_name='20毫升×20瓶'", [a]); assert.equal(Number(s.net_content), 20); assert.equal(s.pack_quantity, 20)
      const [[s2]] = await db.query("SELECT net_content,pack_quantity FROM product_spec WHERE enterprise_id=? AND spec_name='130克×40瓶'", [a]); assert.equal(Number(s2.net_content), 130); assert.equal(s2.pack_quantity, 40)
      await page.screenshot({ path: 'logs/spec-transfer-browser-import-20261017.png', fullPage: true })
      await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    })
    await check('只读账户浏览器可导出但隐藏导入入口，页面无异常', async () => {
      const readonly = await pageFor(viewer)
      assert.equal(await readonly.getByRole('button', { name: '导出规格', exact: true }).count(), 1)
      assert.equal(await readonly.getByRole('button', { name: '批量导入', exact: true }).count(), 0)
      assert.deepEqual(errors, [])
    })
  } finally { await browser.close() }
  fs.writeFileSync('logs/spec-transfer-results-20261017.json', JSON.stringify({ results, isolatedDatabase: database, productionWrites: 0 }, null, 2))
  console.log('全部通过：' + results.length + '组；清理临时库')
} finally {
  if (server && server.exitCode === null) { server.kill(); await new Promise(r => server.once('exit', r)) }
  if (created) await db.query('DROP DATABASE IF EXISTS ??', [database])
  await db.end()
}
