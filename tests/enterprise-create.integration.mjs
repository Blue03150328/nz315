// 真实接口验收，仅运行本机；临时账号不替换现有账号会话，按本轮ID清理。
// NZ315_ENTERPRISE_LIVE=1 node tests/enterprise-create.integration.mjs
// --keep-ui 保留独立界面验收夹具；验收后以 --cleanup 精确清理。
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'

if (process.env.NZ315_ENTERPRISE_LIVE !== '1') { console.log('默认跳过；设置 NZ315_ENTERPRISE_LIVE=1 后验收本机'); process.exit(0) }
const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]
}))
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST), '禁止操作远程数据库')
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true })
const fixturePath = 'logs/enterprise-create-ui.json'
const cleanup = async (fixture) => {
  assert.match(fixture.tag, /^__ent_\d+$/)
  // 也覆盖界面验收中新增的企业和账号，只按本轮唯一前缀选择再按ID清理。
  const [enterprises] = await db.query('SELECT id FROM enterprise WHERE LEFT(name, ?) = ?', [fixture.tag.length, fixture.tag])
  const [users] = await db.query('SELECT id FROM `user` WHERE LEFT(username, ?) = ?', [fixture.tag.length, fixture.tag])
  const eids = enterprises.map(e => e.id), uids = users.map(u => u.id)
  if (uids.length) {
    await db.query('DELETE FROM operation_log WHERE user_id IN (?)', [uids])
    await db.query('DELETE FROM `user` WHERE id IN (?)', [uids])
  }
  if (eids.length) await db.query('DELETE FROM enterprise WHERE id IN (?)', [eids])
  const [[remaining]] = await db.query('SELECT (SELECT COUNT(*) FROM enterprise WHERE LEFT(name, ?) = ?) + (SELECT COUNT(*) FROM `user` WHERE LEFT(username, ?) = ?) AS n', [fixture.tag.length, fixture.tag, fixture.tag.length, fixture.tag])
  assert.equal(remaining.n, 0, '本轮测试数据必须全部清理')
  if (uids.length) {
    const [[logs]] = await db.query('SELECT COUNT(*) AS n FROM operation_log WHERE user_id IN (?)', [uids])
    assert.equal(logs.n, 0, '本轮测试日志必须全部清理')
  }
  if (existsSync(fixturePath)) unlinkSync(fixturePath)
  console.log('本轮临时企业、账号及操作日志已清理')
}
if (process.argv.includes('--cleanup')) {
  try {
    await cleanup(JSON.parse(readFileSync(fixturePath, 'utf8')))
    const resultPath = 'logs/enterprise-create-results.json'
    if (existsSync(resultPath)) {
      const result = JSON.parse(readFileSync(resultPath, 'utf8'))
      writeFileSync(resultPath, JSON.stringify({ ...result, cleaned: true }, null, 2))
    }
  } finally { await db.end() }
  process.exit(0)
}
assert.ok(!existsSync(fixturePath), '上一轮界面验收夹具尚未清理')
const tag = '__ent_' + Date.now()
const password = randomBytes(18).toString('hex')
const fixture = { tag, password, accounts: {} }
const results = []
const base = 'http://localhost:3100'
async function request(path, cookie = '', body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(base + path, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) })
  return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] }
}
async function check(name, fn) { await fn(); results.push(name); console.log('PASS ' + name) }
let success = false
try {
  const [[clock]] = await db.query('SELECT CURDATE() AS today')
  const body = { name: tag + '企业', creditCode: '91' + String(Date.now()).padStart(16, '0'), contact: '验收联系人', phone: '0531-12345678', legalPerson: '验收法人', licenseNo: '验收许可证', qualificationExpire: '2099-12-31', renewExpire: clock.today }
  const hash = await bcrypt.hash(password, 10)
  const [seed] = await db.execute('INSERT INTO enterprise (name, credit_code, renew_expire, status) VALUES (?,?,?,1)', [tag + '权限夹具', '92' + String(Date.now()).padStart(16, '0'), '2099-12-31'])
  for (const [role, suffix] of [['platform_admin', 'hq'], ['enterprise_admin', 'owner'], ['code_admin', 'code'], ['viewer', 'view']]) {
    const username = tag + '_' + suffix
    await db.execute('INSERT INTO `user` (username,password,name,role,enterprise_id,status) VALUES (?,?,?,?,?,1)', [username, hash, '企业新增验收', role, role === 'platform_admin' ? null : seed.insertId])
    const login = await request('/api/auth/login', '', { username, password })
    assert.equal(login.status, 200)
    fixture.accounts[role] = { username, cookie: login.cookie }
  }
  const hq = fixture.accounts.platform_admin.cookie
  await check('匿名401，厂家主账号/码管理员/只读账号均403，伪造总部角色无效', async () => {
    assert.equal((await request('/api/admin/enterprises', '', body)).status, 401)
    for (const role of ['enterprise_admin', 'code_admin', 'viewer']) {
      assert.equal((await request('/api/admin/enterprises', fixture.accounts[role].cookie, { ...body, role: 'platform_admin' })).status, 403)
    }
    const [[row]] = await db.query('SELECT COUNT(*) AS n FROM enterprise WHERE credit_code=?', [body.creditCode])
    assert.equal(row.n, 0)
  })
  let enterpriseId
  await check('总部成功创建完整企业并记录审计', async () => {
    const created = await request('/api/admin/enterprises', hq, body)
    assert.equal(created.status, 200, JSON.stringify(created.data))
    enterpriseId = created.data.id
    const [[row]] = await db.query('SELECT * FROM enterprise WHERE id=?', [enterpriseId])
    assert.equal(row.renew_expire, clock.today)
    assert.equal(row.contact, body.contact)
    const [logs] = await db.query("SELECT id FROM operation_log WHERE action='新增企业' AND JSON_EXTRACT(content, '$.id')=?", [enterpriseId])
    assert.equal(logs.length, 1)
  })
  await check('重复信用代码返回409，6次并发仅创建1家', async () => {
    assert.equal((await request('/api/admin/enterprises', hq, body)).status, 409)
    const concurrentBody = { ...body, name: tag + '并发', creditCode: '93' + String(Date.now()).padStart(16, '0') }
    const responses = await Promise.all(Array.from({ length: 6 }, () => request('/api/admin/enterprises', hq, concurrentBody)))
    assert.equal(responses.filter(r => r.status === 200).length, 1)
    assert.equal(responses.filter(r => r.status === 409).length, 5)
  })
  await check('服务日期必填且不可过期，资质日期/信用代码/长度校验', async () => {
    for (const patch of [{ renewExpire: '' }, { renewExpire: '2000-01-01' }, { qualificationExpire: '2027-02-29' }, { creditCode: '123' }, { name: '企'.repeat(256) }]) {
      assert.equal((await request('/api/admin/enterprises', hq, { ...body, ...patch })).status, 400)
    }
  })
  await check('新增厂家主账号可登录，到期/停用仍受原守卫约束', async () => {
    const username = tag + '_new'
    const created = await request('/api/admin/users', hq, { username, password, role: 'enterprise_admin', enterpriseId })
    assert.equal(created.status, 200)
    const login = await request('/api/auth/login', '', { username, password })
    assert.equal(login.status, 200)
    assert.equal((await request('/api/admin/settings/enterprise', login.cookie)).data.id, enterpriseId)
    assert.equal((await request('/api/admin/enterprises', login.cookie, body)).status, 403)
    await db.execute('UPDATE enterprise SET renew_expire=? WHERE id=?', ['2000-01-01', enterpriseId])
    assert.equal((await request('/api/auth/login', '', { username, password })).status, 403)
    await db.execute('UPDATE enterprise SET renew_expire=?, status=0 WHERE id=?', [clock.today, enterpriseId])
    assert.equal((await request('/api/auth/login', '', { username, password })).status, 403)
    await db.execute('UPDATE enterprise SET status=1 WHERE id=?', [enterpriseId])
  })
  await check('总部编辑存量企业，厂家不能跨企业修改', async () => {
    assert.equal((await request('/api/admin/settings/enterprise/' + enterpriseId, hq, { ...body, contact: '已修改联系人' }, 'PATCH')).status, 200)
    assert.equal((await request('/api/admin/settings/enterprise/' + enterpriseId, fixture.accounts.enterprise_admin.cookie, body, 'PATCH')).status, 403)
  })
  await check('企业第101家仍可分页检索，支持按信用代码查询', async () => {
    const rows = Array.from({ length: 101 }, (_, i) => [tag + '分页' + i, '2099-12-31'])
    await db.query('INSERT INTO enterprise (name, renew_expire) VALUES ?', [rows])
    const page = await request('/api/admin/factories?keyword=' + encodeURIComponent(tag + '分页') + '&page=6&pageSize=20', hq)
    assert.equal(page.data.total, 101)
    assert.equal(page.data.rows.length, 1)
    const found = await request('/api/admin/factories?keyword=' + body.creditCode, hq)
    assert.equal(found.data.rows[0].id, enterpriseId)
    assert.equal(found.data.rows[0].renew_expire, clock.today)
  })
  success = true
} finally {
  mkdirSync('logs', { recursive: true })
  if (success && process.argv.includes('--keep-ui')) {
    // 本机临时凭据仅写入已忽略的logs；界面验收结束必须执行--cleanup。
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2))
    console.log('界面验收夹具已保留于忽略目录，使用 --cleanup 清理')
  } else await cleanup(fixture)
  await db.end()
  writeFileSync('logs/enterprise-create-results.json', JSON.stringify({ results, success, cleaned: !process.argv.includes('--keep-ui') || !success }, null, 2))
}
console.log('通过：' + results.length + ' 项')
