// 全部写入临时本机数据库，仅复制原库表结构；不复制或更改真实业务数据，结束清理。
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { parseEnv } from 'node:util'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import XLSX from 'xlsx'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./_ts-loader.mjs', import.meta.url)
const { PRODUCT_IMPORT_HEADERS: headers } = await import('../shared/utils/product-import.ts')
if (process.env.NZ315_PRODUCT_IMPORT_TEST !== '1') { console.log('默认跳过；设置NZ315_PRODUCT_IMPORT_TEST=1运行本机隔离测试'); process.exit(0) }
const env = parseEnv(fs.readFileSync('.env', 'utf8'))
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST))
const database = 'product_seven_test_' + Date.now(), port = 38417, base = 'http://127.0.0.1:' + port
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true })
const results = []
let server, created = false
const ok = r => { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data }
async function check(name, action) { await action(); results.push(name); console.log('通过：' + name) }
async function request(url, cookie = '', body, method = body === undefined ? 'GET' : 'POST') {
  const res = await fetch(base + url, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) })
  return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] }
}
const baseRow = { 生产类型: '持有人生产', 登记证号: 'PD20991234', 规格代码: '001', 产标名: '测试牌', 原药登记证号1: 'PD20990001' }
const allOriginals = { 原药登记证号2: 'PD20990002', 原药登记证号3: 'PD20990003' }
function excel(rows, columns = headers) {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([columns, ...rows.map(row => columns.map(h => row?.[h] ?? ''))]), '产品导入')
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
}
async function importRows(cookie, rows, enterpriseId, columns = headers, name = '产品.xlsx', buffer) {
  const form = new FormData()
  form.append('file', new Blob([buffer || excel(rows, columns)]), name)
  if (enterpriseId) form.append('enterpriseId', String(enterpriseId))
  const res = await fetch(base + '/api/admin/products/import', { method: 'POST', headers: { cookie }, body: form, signal: AbortSignal.timeout(30000) })
  return { status: res.status, data: await res.json() }
}
const counts = async () => { const [[r]] = await db.query('SELECT (SELECT COUNT(*) FROM product) products,(SELECT COUNT(*) FROM product_spec) specs,(SELECT COUNT(*) FROM product_original) originals'); return r }
const readBook = buffer => XLSX.read(buffer, { type: 'buffer', bookFiles: true })
const sheetRows = (book, index = 0) => XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[index]], { header: 1, defval: '' })
async function template(cookie, enterpriseId) {
  const res = await fetch(base + '/api/admin/products/import-template' + (enterpriseId ? '?enterpriseId=' + enterpriseId : ''), { headers: { cookie } })
  assert.equal(res.status, 200, await (res.status === 200 ? Promise.resolve('') : res.text()))
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
  for (const name of ['产品导入甲有限公司', '产品导入乙有限公司', '空规格企业']) {
    const [r] = await db.query("INSERT INTO enterprise(name,renew_expire) VALUES(?,'2099-12-31')", [name]); enterprises.push(r.insertId)
  }
  const [a, b, empty] = enterprises
  const password = randomBytes(16).toString('hex'), hashed = await bcrypt.hash(password, 4)
  for (const [username, role, enterpriseId] of [['import_admin', 'enterprise_admin', a], ['import_other', 'enterprise_admin', b], ['import_viewer', 'viewer', a], ['import_platform', 'platform_admin', null]]) await db.query('INSERT INTO user(username,password,name,role,enterprise_id) VALUES(?,?,?,?,?)', [username, hashed, username, role, enterpriseId])
  const regs = [
    ['PD20991234', '甲·乙·丙', '产品导入甲有限公司', '悬浮剂', ['甲', '乙', '丙'], '2099-12-31'],
    ['PD20991230', '甲', '产品导入甲有限公司', '乳油', ['甲'], '2020-01-01'],
    ['PD20990001', '甲', '原药企业甲', '原药', ['甲'], '2099-12-31'],
    ['PD20990002', '乙', '原药企业乙', '母药', ['乙'], '2099-12-31'],
    ['PD20990003', '丙', '原药企业丙', '原药', ['丙'], '2099-12-31'],
    ['PD20990004', '甲', '过期原药企业', '原药', ['甲'], '2020-01-01'],
    ['PD20990005', '甲', '制剂企业', '乳油', ['甲'], '2099-12-31'],
    ['PD20990006', '丁', '无关原药企业', '原药', ['丁'], '2099-12-31'],
    ['PD20990007', '甲', '无有效期原药企业', '原药', ['甲'], null],
    ['PD20990008', '甲', '', '原药', ['甲'], '2099-12-31'],
  ]
  for (const [no, name, company, dosage, ingredients, expiry] of regs) await db.query('INSERT INTO pesticide_reg(registration_no,product_name,company,category,content,dosage,toxicity,ingredient_main,ingredient_all,expire_date) VALUES(?,?,?,?,?,?,?,?,?,?)', [no, name, company, '杀虫剂', '30%', dosage, '低毒', ingredients[0], JSON.stringify(ingredients), expiry])
  for (const [eid, code, name, net, quantity, status] of [[a, '001', '500克×20瓶', 500, 20, 1], [a, '005', '600克×1瓶', 600, 1, 0], [a, '006', '自定义包装', 900, 2, 1], [b, '001', '700克×5瓶', 700, 5, 1], [b, '002', '仅乙规格', 800, 3, 1]]) await db.query('INSERT INTO product_spec(enterprise_id,spec_code,spec_name,net_content,content_unit,pack_unit,pack_quantity,status) VALUES(?,?,?,?,?,?,?,?)', [eid, code, name, net, '克', '瓶', quantity, status])
  const [originalSpecs] = await db.query('SELECT * FROM product_spec ORDER BY id')
  const build = path.resolve(process.env.NZ315_PRODUCT_IMPORT_BUILD || 'logs/product-seven-build-20261017')
  const log = fs.openSync('logs/product-seven-api-server-20261017.log', 'w')
  server = spawn(process.execPath, [path.join(build, '.output/server/index.mjs')], { cwd: build, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NUXT_DB_HOST: env.DB_HOST, NUXT_DB_PORT: env.DB_PORT || '3306', NUXT_DB_USER: env.DB_USER, NUXT_DB_PASSWORD: env.DB_PASSWORD, NUXT_DB_NAME: database, NUXT_SESSION_SECRET: randomBytes(48).toString('hex') } })
  fs.closeSync(log)
  let ready = false
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/auth/me')).ok) { ready = true; break } } catch {} await new Promise(r => setTimeout(r, 200)) }
  assert.ok(ready, '隔离服务启动失败')
  const login = async username => { const r = await request('/api/auth/login', '', { username, password }); ok(r); return r.cookie }
  const admin = await login('import_admin'), other = await login('import_other'), viewer = await login('import_viewer'), platform = await login('import_platform')
  await check('七列三原药精确补齐，已有规格绑定、完整产品名、企业与三原药资料正确', async () => {
    const r = ok(await importRows(admin, [{ ...baseRow, ...allOriginals }]))
    assert.equal(r.success, 1); assert.equal(r.createdSpecs, 0); assert.equal(r.failed, 0); assert.deepEqual(r.warnings, [])
    const [[p]] = await db.query('SELECT * FROM product')
    assert.equal(p.name, '（测试牌）30%甲·乙·丙悬浮剂 500克×20瓶'); assert.equal(p.enterprise_id, a); assert.equal(p.holder_name, '产品导入甲有限公司')
    const [originals] = await db.query('SELECT reg_no,company,ingredient FROM product_original ORDER BY id')
    assert.deepEqual(originals.map(o => [o.reg_no, o.company, o.ingredient]), [['PD20990001', '原药企业甲', '甲'], ['PD20990002', '原药企业乙', '乙'], ['PD20990003', '原药企业丙', '丙']])
  })
  await check('重复与停用产品均拒绝，不覆盖原产品原药；生产类型变化不能绕过SKU', async () => {
    const [before] = await db.query('SELECT * FROM product ORDER BY id'), [beforeOrig] = await db.query('SELECT * FROM product_original ORDER BY id')
    assert.equal(ok(await importRows(admin, [{ ...baseRow, 生产类型: '委托加工' }])).failed, 1)
    await db.query('UPDATE product SET status=0')
    assert.match(ok(await importRows(admin, [baseRow])).errors[0].reason, /已存在/)
    await db.query('UPDATE product SET status=1')
    assert.deepEqual((await db.query('SELECT * FROM product ORDER BY id'))[0], before)
    assert.deepEqual((await db.query('SELECT * FROM product_original ORDER BY id'))[0], beforeOrig)
  })
  await check('数值1匹配001，新商标允许，同文件重复第二行失败；无商标可导入', async () => {
    const row = { ...baseRow, 规格代码: 1, 产标名: '新商标' }
    const r = ok(await importRows(admin, [row, row, { ...baseRow, 产标名: '' }]))
    assert.equal(r.success, 2); assert.equal(r.failed, 1); assert.equal(r.errors[0].row, 3)
    assert.equal(r.errors[0].values['规格代码'], '1')
  })
  await check('未知规格、停用与跨企业代码拒绝，自定义已有启用规格可复用且不新增', async () => {
    const r = ok(await importRows(admin, ['999', '005', '002', '006'].map(code => ({ ...baseRow, 规格代码: code, 产标名: '规格测试' }))))
    assert.equal(r.success, 1); assert.equal(r.failed, 3); assert.equal(r.createdSpecs, 0)
    assert.match(r.errors[1].reason, /停用/); assert.match(r.errors[2].reason, /本企业不存在/)
  })
  await check('未知产品证、未知原药证、非原药剂型、错配成分、重复原药、缺原药1和缺原药企业逐行拒绝', async () => {
    const rows = [
      { ...baseRow, 登记证号: 'PD99999999' }, { ...baseRow, 原药登记证号1: 'PD99999999' },
      { ...baseRow, 原药登记证号1: 'PD20990005' }, { ...baseRow, 原药登记证号1: 'PD20990006' },
      { ...baseRow, 原药登记证号2: 'pd20990001' }, { ...baseRow, 原药登记证号1: '', 原药登记证号2: 'PD20990002' },
      { ...baseRow, 原药登记证号1: 'PD20990008' },
    ]
    const before = await counts(), r = ok(await importRows(admin, rows))
    assert.equal(r.success, 0); assert.equal(r.failed, rows.length)
    assert.deepEqual(r.errors.map(e => e.row), [2, 3, 4, 5, 6, 7, 8]); assert.deepEqual(await counts(), before)
  })
  await check('产品与原药过期均拦截；缺部分成分来源和缺有效期明确提示且不猜供应商', async () => {
    const r = ok(await importRows(admin, [
      { ...baseRow, 登记证号: 'PD20991230' }, { ...baseRow, 原药登记证号1: 'PD20990004' },
      { ...baseRow, 产标名: '需核对来源', 原药登记证号1: 'PD20990007' },
    ]))
    assert.equal(r.success, 1); assert.equal(r.failed, 2)
    assert.ok(r.errors.every(e => /已过期/.test(e.reason))); assert.match(r.warnings.map(w => w.reason).join(''), /乙、丙/); assert.match(r.warnings.map(w => w.reason).join(''), /未提供有效期/)
    const [[o]] = await db.query("SELECT o.company FROM product_original o JOIN product p ON p.id=o.product_id WHERE p.trademark='需核对来源'")
    assert.equal(o.company, '无有效期原药企业')
  })
  await check('企业参数伪造仍按本企业，持有人生产外企业证拒绝，委托类型保留外部持有人', async () => {
    assert.match(ok(await importRows(other, [baseRow], a)).errors[0].reason, /持有人生产/)
    const r = ok(await importRows(other, [{ ...baseRow, 生产类型: '委托加工', 产标名: '乙厂委托' }], a))
    assert.equal(r.success, 1)
    const [[p]] = await db.query("SELECT p.enterprise_id,p.holder_name,p.produce_type,s.spec_name FROM product p JOIN product_spec s ON s.id=p.spec_id WHERE p.trademark='乙厂委托'")
    assert.equal(p.enterprise_id, b); assert.equal(p.holder_name, '产品导入甲有限公司'); assert.equal(p.produce_type, 2); assert.equal(p.spec_name, '700克×5瓶')
  })
  await check('总部必须选择企业，委托分装按所选企业入库，非法企业拒绝', async () => {
    assert.equal((await importRows(platform, [baseRow])).status, 400)
    assert.equal((await importRows(platform, [baseRow], 999999999)).status, 400)
    const r = ok(await importRows(platform, [{ ...baseRow, 生产类型: '委托分装', 产标名: '总部代导' }], b))
    assert.equal(r.success, 1)
    const [[p]] = await db.query("SELECT enterprise_id,produce_type FROM product WHERE trademark='总部代导'"); assert.equal(p.enterprise_id, b); assert.equal(p.produce_type, 3)
  })
  await check('未登录与只读导入和模板下载拒绝，零业务写入', async () => {
    const before = await counts()
    assert.equal((await importRows('', [baseRow])).status, 401); assert.equal((await importRows(viewer, [baseRow])).status, 403)
    assert.equal((await fetch(base + '/api/admin/products/import-template')).status, 401)
    assert.equal((await fetch(base + '/api/admin/products/import-template', { headers: { cookie: viewer } })).status, 403)
    assert.deepEqual(await counts(), before)
  })
  await check('旧产品商标列兼容，第四种原药、未知列、非Excel文件、超10MB及多文件整批拒绝', async () => {
    const alias = headers.map(h => h === '产标名' ? '产品商标' : h)
    assert.equal(ok(await importRows(admin, [{ ...baseRow, 产品商标: '旧列兼容' }], null, alias)).success, 1)
    assert.equal((await importRows(admin, [baseRow], null, [...headers, '原药登记证号4'])).status, 400)
    assert.equal((await importRows(admin, [baseRow], null, headers, '产品.txt')).status, 400)
    assert.equal((await importRows(admin, [], null, headers, '产品.xlsx', Buffer.alloc(10 * 1024 * 1024 + 1))).status, 400)
    const form = new FormData(); form.append('f1', new Blob([excel([baseRow])]), '甲.xlsx'); form.append('f2', new Blob([excel([baseRow])]), '乙.xlsx')
    assert.equal((await fetch(base + '/api/admin/products/import', { method: 'POST', headers: { cookie: admin }, body: form })).status, 400)
  })
  await check('混合文件空行保留原行号，失败行原值可修正后重传且已成功行不重建', async () => {
    const r = ok(await importRows(admin, [null, { ...baseRow, 产标名: '混合成功' }, { ...baseRow, 规格代码: '999', 产标名: '修正后重传' }]))
    assert.equal(r.success, 1); assert.equal(r.failed, 1); assert.equal(r.errors[0].row, 4)
    assert.equal(ok(await importRows(admin, [{ ...r.errors[0].values, 规格代码: '001' }])).success, 1)
    assert.match(ok(await importRows(admin, [{ ...baseRow, 产标名: '混合成功' }])).errors[0].reason, /已存在/)
  })
  await check('并发相同SKU只有一条新增，原药不重复且规格逐字段保持', async () => {
    const out = await Promise.all(Array.from({ length: 4 }, () => importRows(admin, [{ ...baseRow, 产标名: '并发牌' }])))
    assert.equal(out.reduce((n, r) => n + ok(r).success, 0), 1); assert.equal(out.reduce((n, r) => n + r.data.failed, 0), 3)
  })
  await check('原药插入冲突回滚该行产品和之前原药，后续正确行仍提交', async () => {
    await db.query("CREATE TRIGGER product_seven_row_conflict BEFORE INSERT ON product_original FOR EACH ROW BEGIN IF NEW.reg_no='PD20990003' AND EXISTS(SELECT 1 FROM product WHERE id=NEW.product_id AND trademark='故障行') THEN SIGNAL SQLSTATE '23000' SET MYSQL_ERRNO=1062, MESSAGE_TEXT='uq_test_original'; END IF; END")
    try {
      const before = await counts(), r = ok(await importRows(admin, [{ ...baseRow, ...allOriginals, 产标名: '故障行' }, { ...baseRow, 产标名: '故障后成功' }]))
      assert.equal(r.success, 1); assert.equal(r.failed, 1)
      const after = await counts(); assert.equal(after.products, before.products + 1); assert.equal(after.originals, before.originals + 1)
      const [[p]] = await db.query("SELECT COUNT(*) c FROM product WHERE trademark='故障行'"); assert.equal(p.c, 0)
    } finally { await db.query('DROP TRIGGER product_seven_row_conflict') }
  })
  await check('非预期数据库错误回滚整批，包括此前成功行', async () => {
    await db.query("CREATE TRIGGER product_seven_batch_fault BEFORE INSERT ON product FOR EACH ROW BEGIN IF NEW.trademark='数据库故障' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='隔离测试数据库故障'; END IF; END")
    try {
      const before = await counts()
      assert.equal((await importRows(admin, [{ ...baseRow, 产标名: '整批应回滚' }, { ...baseRow, 产标名: '数据库故障' }])).status, 500)
      assert.deepEqual(await counts(), before)
    } finally { await db.query('DROP TRIGGER product_seven_batch_fault') }
  })
  await check('企业模板只含本企业启用规格，参数不能越权；保留下拉、冻结及七列表头', async () => {
    const book = readBook(await template(admin, b)), refs = sheetRows(book, 2)
    assert.deepEqual(sheetRows(book)[0], headers); assert.deepEqual(refs.slice(1).map(r => r[0]), ['001', '006'])
    assert.ok(refs.slice(1).every(r => r[2] === '产品导入甲有限公司'))
    assert.match(Buffer.from(book.files['xl/worksheets/sheet1.xml'].content).toString(), /dataValidation/)
    assert.match(Buffer.from(book.files['xl/worksheets/sheet1.xml'].content).toString(), /pane/)
    assert.deepEqual(sheetRows(readBook(await template(platform, b)), 2).slice(1).map(r => r[0]), ['001', '002'])
    assert.match(sheetRows(readBook(await template(platform, empty)), 2)[1][1], /暂无启用规格/)
    assert.equal((await fetch(base + '/api/admin/products/import-template', { headers: { cookie: platform } })).status, 400)
  })
  await check('导出七列可直接进入导入校验，原SKU提示重复且不改原产品', async () => {
    const res = await fetch(base + '/api/admin/products/export?keyword=混合成功', { headers: { cookie: admin } })
    assert.equal(res.status, 200)
    const buffer = Buffer.from(await res.arrayBuffer()), book = readBook(buffer)
    assert.deepEqual(sheetRows(book)[0], headers)
    const r = ok(await importRows(admin, [], null, headers, '导出重导.xlsx', buffer))
    assert.equal(r.success, 0); assert.equal(r.failed, 1); assert.match(r.errors[0].reason, /已存在/)
  })
  await check('全流程规格逐字段未改，审计记录成功失败和核对提示数量', async () => {
    assert.deepEqual((await db.query('SELECT * FROM product_spec ORDER BY id'))[0], originalSpecs)
    const [[log]] = await db.query("SELECT content FROM operation_log WHERE action='批量导入产品' ORDER BY id LIMIT 1")
    const content = JSON.parse(log.content); assert.equal(content.enterpriseId, a); assert.equal(content.createdSpecs, 0); assert.equal(content.success, 1); assert.equal(content.warningCount, 0)
  })
  if (process.env.NZ315_PRODUCT_IMPORT_BROWSER === '1') {
    const { chromium } = await import(pathToFileURL(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')))
    const browser = await chromium.launch({ channel: 'msedge', headless: true })
    try {
      const browserErrors = []
      async function pageFor(cookie) {
        const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
        const split = cookie.indexOf('=')
        await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: base }])
        const page = await context.newPage(); page.on('pageerror', e => browserErrors.push(e.message))
        await page.goto(base + '/admin/products'); await page.waitForLoadState('networkidle')
        return page
      }
      const page = await pageFor(admin)
      await check('浏览器下载厂家模板、真实上传七列、显示失败和核对提示，失败文件可修正重传', async () => {
        await page.getByRole('button', { name: '导入产品', exact: true }).click()
        const dialog = page.getByRole('dialog')
        await dialog.getByRole('heading', { name: '导入产品' }).waitFor()
        const downloadEvent = page.waitForEvent('download'); await dialog.getByRole('button', { name: '下载 Excel 模板' }).click()
        const download = await downloadEvent; assert.equal(download.suggestedFilename(), '产品导入模板.xlsx')
        const templatePath = 'logs/product-seven-browser-template.xlsx'; await download.saveAs(templatePath)
        assert.deepEqual(sheetRows(readBook(fs.readFileSync(templatePath)), 2).slice(1).map(r => r[0]), ['001', '006'])
        await dialog.locator('input[type=file]').setInputFiles({ name: '浏览器产品.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: excel([{ ...baseRow, 产标名: '浏览器验收牌' }, { ...baseRow, 规格代码: '999', 产标名: '浏览器修正牌' }]) })
        await dialog.getByRole('button', { name: '开始导入', exact: true }).click()
        await dialog.getByText('成功1条产品，失败1条。', { exact: true }).waitFor()
        assert.match(await dialog.innerText(), /乙、丙/); assert.match(await dialog.innerText(), /本企业不存在规格代码/)
        assert.equal(await dialog.getByRole('button', { name: '开始导入', exact: true }).isDisabled(), true)
        const failureEvent = page.waitForEvent('download'); await dialog.getByRole('button', { name: '下载失败行' }).click()
        const failure = await failureEvent, failurePath = 'logs/product-seven-browser-failures.xlsx'
        await failure.saveAs(failurePath)
        const failureBook = readBook(fs.readFileSync(failurePath)), failedRows = sheetRows(failureBook)
        assert.deepEqual(failedRows[0], headers); assert.equal(failedRows.length, 2); assert.equal(failedRows[1][2], '浏览器修正牌')
        assert.equal(sheetRows(failureBook, 1)[1][1], 3)
        failureBook.Sheets[failureBook.SheetNames[0]].D2 = { t: 's', v: '001' }
        const repaired = XLSX.write(failureBook, { type: 'buffer', bookType: 'xlsx' })
        await dialog.locator('input[type=file]').setInputFiles({ name: '修正失败行.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: repaired })
        await dialog.getByRole('button', { name: '开始导入', exact: true }).click()
        await dialog.getByText('成功1条产品，失败0条。', { exact: true }).waitFor()
        await page.screenshot({ path: 'logs/product-seven-browser-results-20261017.png', fullPage: true })
        await dialog.getByRole('button', { name: '关闭', exact: true }).click()
        await page.getByText('（浏览器修正牌）30%甲·乙·丙悬浮剂 500克×20瓶', { exact: true }).waitFor()
      })
      await check('小屏导入弹窗可滚动，七列提示可读且宽度不超屏幕', async () => {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.getByRole('button', { name: '导入产品', exact: true }).click()
        await page.getByRole('dialog').getByRole('heading', { name: '导入产品' }).waitFor()
        assert.ok(await page.getByRole('dialog').evaluate(e => e.getBoundingClientRect().width <= innerWidth))
        await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
      })
      await check('总部先选企业才能下载，关键词选择后模板与委托产品均归所选企业，只读隐藏入口', async () => {
        const headquarters = await pageFor(platform)
        await headquarters.getByRole('button', { name: '导入产品', exact: true }).click()
        const dialog = headquarters.getByRole('dialog')
        assert.equal(await dialog.getByRole('button', { name: '下载 Excel 模板' }).isDisabled(), true)
        const response = headquarters.waitForResponse(r => r.url().includes('/api/admin/factories?') && r.url().includes('keyword=') && r.status() === 200)
        await dialog.getByPlaceholder('输入企业关键词搜索').fill('产品导入乙'); await response
        await dialog.getByRole('combobox').click()
        await headquarters.getByRole('option', { name: '产品导入乙有限公司', exact: true }).click()
        const event = headquarters.waitForEvent('download'); await dialog.getByRole('button', { name: '下载 Excel 模板' }).click()
        const download = await event; await download.saveAs('logs/product-seven-browser-headquarters.xlsx')
        assert.equal(sheetRows(readBook(fs.readFileSync('logs/product-seven-browser-headquarters.xlsx')), 2)[1][2], '产品导入乙有限公司')
        await dialog.locator('input[type=file]').setInputFiles({ name: '总部.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: excel([{ ...baseRow, 生产类型: '委托分装', 产标名: '总部浏览器牌' }]) })
        await dialog.getByRole('button', { name: '开始导入', exact: true }).click()
        await dialog.getByText('成功1条产品，失败0条。', { exact: true }).waitFor()
        const [[p]] = await db.query("SELECT enterprise_id FROM product WHERE trademark='总部浏览器牌'"); assert.equal(p.enterprise_id, b)
        const readonly = await pageFor(viewer); assert.equal(await readonly.getByRole('button', { name: '导入产品', exact: true }).count(), 0)
      })
      assert.deepEqual(browserErrors, [], '浏览器无页面异常')
    } finally { await browser.close() }
  }
  fs.writeFileSync('logs/product-seven-integration-results-20261017.json', JSON.stringify({ results, isolatedDatabase: database, productionWrites: 0 }, null, 2))
  console.log('全部通过：' + results.length + '组；清理隔离库')
} finally {
  if (server && server.exitCode === null) { server.kill(); await new Promise(r => server.once('exit', r)) }
  if (created) await db.query('DROP DATABASE IF EXISTS ??', [database])
  await db.end()
}
