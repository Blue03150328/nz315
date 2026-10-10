// 新增总部管理员（2026-10-10）真实接口验收，仅本机运行。
// NZ315_ADMIN_LIVE=1 node tests/admin-account.integration.mjs
// 覆盖：提权闸（非总部管理员不得创建总部管理员）/ 总部管理员可创建且 enterprise_id 为 NULL /
//       新账号确有平台权限 / 非总部管理员不得操作总部账号 / 禁用总部账号的并发防自锁。
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'

if (process.env.NZ315_ADMIN_LIVE !== '1') { console.log('默认跳过；设置 NZ315_ADMIN_LIVE=1 后验收本机'); process.exit(0) }
const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]
}))
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST), '禁止操作远程数据库')
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true })

const tag = '__uadm_' + Date.now()
const password = randomBytes(18).toString('hex')
const hash = await bcrypt.hash(password, 10)
const results = []
const base = 'http://localhost:3100'
async function request(path, cookie = '', body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetch(base + path, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) })
  return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] }
}
async function check(name, fn) { await fn(); results.push(name); console.log('PASS ' + name) }

// 并发用例会临时禁用基线的总部管理员；无论成败都必须在 finally 里复原（否则本机后台被锁死）
let baselineIds = []
let success = false
const sessions = {}
const ids = {}
const cleanup = async () => {
  if (baselineIds.length) await db.query('UPDATE `user` SET status = 1 WHERE id IN (?)', [baselineIds])
  const [users] = await db.query('SELECT id FROM `user` WHERE LEFT(username, ?) = ?', [tag.length, tag])
  const uids = users.map(u => u.id)
  if (uids.length) {
    await db.query('DELETE FROM operation_log WHERE user_id IN (?)', [uids])
    await db.query('DELETE FROM `user` WHERE id IN (?)', [uids])
  }
  await db.query('DELETE FROM enterprise WHERE LEFT(name, ?) = ?', [tag.length, tag])
  const [[remaining]] = await db.query('SELECT (SELECT COUNT(*) FROM `user` WHERE LEFT(username, ?) = ?) + (SELECT COUNT(*) FROM enterprise WHERE LEFT(name, ?) = ?) AS n', [tag.length, tag, tag.length, tag])
  assert.equal(remaining.n, 0, '本轮测试数据必须全部清理')
  const [[alive]] = await db.query("SELECT COUNT(*) AS n FROM `user` WHERE role = 'platform_admin' AND status = 1")
  assert.ok(alive.n >= 1, '清理后本机必须仍存在启用的总部管理员')
  console.log('清理完成；本机启用中的总部管理员剩余 ' + alive.n + ' 个')
}

try {
  // —— 夹具：一个企业 + 五个账号（两个总部管理员、厂家主账号、码管理员、只读账号）——
  const [ent] = await db.execute('INSERT INTO enterprise (name, credit_code, renew_expire, status) VALUES (?,?,?,1)', [tag + '验收企业', '99' + String(Date.now()).padStart(16, '0'), '2099-12-31'])
  ids.enterprise = ent.insertId
  const fixtures = [
    ['hq1', 'platform_admin', null], ['hq2', 'platform_admin', null],
    ['ea', 'enterprise_admin', ids.enterprise], ['ca', 'code_admin', ids.enterprise], ['vw', 'viewer', ids.enterprise],
  ]
  for (const [key, role, eid] of fixtures) {
    const username = tag + '_' + key
    const [r] = await db.execute('INSERT INTO `user` (username,password,name,role,enterprise_id,status) VALUES (?,?,?,?,?,1)', [username, hash, '总部账号验收', role, eid])
    ids[key] = r.insertId
    const login = await request('/api/auth/login', '', { username, password })
    assert.equal(login.status, 200, '夹具账号登录失败：' + key)
    sessions[key] = login.cookie
  }

  await check('匿名401；厂家主账号/码管理员/只读账号创建总部管理员一律403且不落库', async () => {
    const payload = { username: tag + '_evil', password, role: 'platform_admin' }
    assert.equal((await request('/api/admin/users', '', payload)).status, 401)
    for (const key of ['ea', 'ca', 'vw']) {
      assert.equal((await request('/api/admin/users', sessions[key], payload)).status, 403)
    }
    const [[row]] = await db.query('SELECT COUNT(*) AS n FROM `user` WHERE username = ?', [tag + '_evil'])
    assert.equal(row.n, 0, '越权创建必须没有落库')
  })

  await check('总部管理员可创建总部管理员，落库 enterprise_id 为 NULL', async () => {
    const created = await request('/api/admin/users', sessions.hq1, { username: tag + '_hq3', password, name: '验收总部三号', role: 'platform_admin' })
    assert.equal(created.status, 200, JSON.stringify(created.data))
    ids.hq3 = created.data.id
    const [[row]] = await db.query('SELECT enterprise_id, role, status FROM `user` WHERE id = ?', [ids.hq3])
    assert.equal(row.enterprise_id, null)
    assert.equal(row.role, 'platform_admin')
    assert.equal(Number(row.status), 1)
  })

  await check('新建总部管理员可登录，且在用户列表显示为总部管理员', async () => {
    const login = await request('/api/auth/login', '', { username: tag + '_hq3', password })
    assert.equal(login.status, 200)
    sessions.hq3 = login.cookie
    // requirePlatformAdmin 专属接口（数据备份）应可访问
    assert.equal((await request('/api/admin/backup', sessions.hq3)).status, 200)
    const list = await request('/api/admin/users?keyword=' + encodeURIComponent(tag + '_hq3'), sessions.hq3)
    assert.equal(list.status, 200)
    const plat = list.data.rows.find((r) => r.id === 0)
    assert.ok(plat, '平台总部组应出现在结果中')
    const mine = plat.users.find((u) => u.id === ids.hq3)
    assert.ok(mine, '新建总部账号应在平台总部组内')
    assert.equal(mine.roleLabel, '总部管理员')
  })

  await check('厂家主账号不得重置密码或禁用总部管理员账号', async () => {
    assert.equal((await request('/api/admin/users/' + ids.hq3 + '/reset-password', sessions.ea, { password })).status, 403)
    assert.equal((await request('/api/admin/users/' + ids.hq3, sessions.ea, { status: 0 }, 'PATCH')).status, 403)
  })

  await check('总部管理员可重置其他总部账号密码，旧会话随即失效', async () => {
    const fresh = await request('/api/auth/login', '', { username: tag + '_hq3', password })
    const oldCookie = fresh.cookie
    assert.equal((await request('/api/admin/users', oldCookie)).status, 200)
    const nextPw = randomBytes(18).toString('hex')
    assert.equal((await request('/api/admin/users/' + ids.hq3 + '/reset-password', sessions.hq1, { password: nextPw })).status, 200)
    assert.equal((await request('/api/admin/users', oldCookie)).status, 401, '改密须递增会话版本，旧 cookie 立即失效')
    assert.equal((await request('/api/auth/login', '', { username: tag + '_hq3', password: nextPw })).status, 200)
  })

  await check('两名总部管理员并发互禁：恰一次成功，且始终保留一个可登录的总部管理员', async () => {
    // 前置条件：启用集合必须恰为 hq1 / hq2。
    // 注意本轮前面已建了 hq3，且真实 admin 也启用着——必须一并临时禁用，否则「除目标外仍有启用」恒成立，永远触发不到防自锁。
    // 被临时禁用的账号 id 记入 baselineIds，finally 里无条件复原。
    const [baseRows] = await db.query("SELECT id FROM `user` WHERE role = 'platform_admin' AND status = 1 AND id NOT IN (?)", [[ids.hq1, ids.hq2]])
    baselineIds = baseRows.map((r) => r.id)
    if (baselineIds.length) await db.query('UPDATE `user` SET status = 0 WHERE id IN (?)', [baselineIds])
    await db.query('UPDATE `user` SET status = 1 WHERE id IN (?)', [[ids.hq1, ids.hq2]])
    const [[ready]] = await db.query("SELECT COUNT(*) AS n FROM `user` WHERE role = 'platform_admin' AND status = 1")
    assert.equal(ready.n, 2, '并发前置条件：启用中的总部管理员应恰为 2 个（实际 ' + ready.n + '）')
    const l1 = await request('/api/auth/login', '', { username: tag + '_hq1', password })
    const l2 = await request('/api/auth/login', '', { username: tag + '_hq2', password })
    assert.equal(l1.status, 200); assert.equal(l2.status, 200)
    const [r1, r2] = await Promise.all([
      request('/api/admin/users/' + ids.hq2, l1.cookie, { status: 0 }, 'PATCH'),
      request('/api/admin/users/' + ids.hq1, l2.cookie, { status: 0 }, 'PATCH'),
    ])
    console.log('并发响应 r1=' + r1.status + ' ' + JSON.stringify(r1.data) + ' | r2=' + r2.status + ' ' + JSON.stringify(r2.data))
    const [states] = await db.query('SELECT id, username, role, status FROM `user` WHERE id IN (?)', [[ids.hq1, ids.hq2]])
    console.log('并发后账号状态：' + JSON.stringify(states))
    const [[alive0]] = await db.query("SELECT COUNT(*) AS n FROM `user` WHERE role = 'platform_admin' AND status = 1")
    console.log('并发后启用中的总部管理员数量：' + alive0.n)
    const okCount = [r1, r2].filter((r) => r.status === 200).length
    assert.equal(okCount, 1, '并发互禁应恰有 1 次成功（实际 ' + r1.status + '/' + r2.status + '）')
    const [[alive]] = await db.query("SELECT COUNT(*) AS n FROM `user` WHERE role = 'platform_admin' AND status = 1")
    assert.equal(alive.n, 1, '必须仍存在 1 个启用的总部管理员')
  })

  success = true
} finally {
  mkdirSync('logs', { recursive: true })
  try { await cleanup() } finally {
    await db.end()
    writeFileSync('logs/admin-account-results.json', JSON.stringify({ results, success }, null, 2))
  }
}
console.log('通过：' + results.length + ' 项')
