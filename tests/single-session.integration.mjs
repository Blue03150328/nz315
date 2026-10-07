// 本机独立账号验收：新登录替换旧登录、并发唯一性、迟到退出、改密与锁内重验。
// 默认跳过；运行：NZ315_SESSION_LIVE=1 node tests/single-session.integration.mjs。
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'
register('./_ts-loader.mjs', import.meta.url)

if (process.env.NZ315_SESSION_LIVE !== '1') { console.log('默认跳过；本机设置 NZ315_SESSION_LIVE=1 后运行'); process.exit(0) }
const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('=')
  return [l.slice(0, i), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]
}))
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST), '仅允许本机数据库')
globalThis.useRuntimeConfig = () => ({ dbHost: env.DB_HOST, dbPort: Number(env.DB_PORT || 3306), dbUser: env.DB_USER, dbPassword: env.DB_PASSWORD, dbName: env.DB_NAME, sessionSecret: env.SESSION_SECRET || 'dev-session-secret-change-me' })
globalThis.createError = opts => Object.assign(new Error(opts.statusMessage), opts)
const { startBackendSession, endBackendSession, revokeUserSessions, createSessionToken, verifySessionToken } = await import('../server/utils/auth.ts')
const { getPool } = await import('../server/utils/db.ts')
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME })
const base = 'http://localhost:3100'
const tag = '__session_' + Date.now()
const password = randomBytes(18).toString('hex')
const hash = await bcrypt.hash(password, 10)
const ids = []
const results = []
async function check(name, fn) {
  await fn()
  results.push({ name, pass: true })
  console.log('PASS ' + name)
}
async function request(path, cookie = '', body) {
  const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) })
  return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] }
}
async function login(username = tag, loginPassword = password) {
  const r = await request('/api/auth/login', '', { username, password: loginPassword })
  assert.equal(r.status, 200)
  assert.ok(r.data.user, '首次登录响应必须含公开用户信息')
  assert.equal(r.data.user.password, undefined)
  assert.equal(r.data.user.session_epoch, undefined)
  assert.ok(r.cookie)
  return r.cookie
}
async function epoch() { const [[row]] = await db.query('SELECT session_epoch FROM `user` WHERE id=?', [ids[0]]); return Number(row.session_epoch) }

try {
  for (const [username, role] of [[tag, 'code_admin'], [tag + '_admin', 'platform_admin']]) {
    const [r] = await db.execute('INSERT INTO `user` (username,password,name,role,status) VALUES (?,?,?,?,1)', [username, hash, '单设备验收临时账号', role])
    ids.push(r.insertId)
  }
  let a, b
  await check('新登录替换旧登录，旧设备读写请求均被拒绝', async () => {
    a = await login()
    assert.equal((await request('/api/auth/me', a)).data.user.id, ids[0])
    b = await login()
    assert.notEqual(a, b)
    const old = await request('/api/auth/me', a)
    assert.equal(old.data.user, null)
    assert.equal(old.data.sessionInvalidated, true)
    assert.equal((await request('/api/admin/products', a)).status, 401)
    const write = await request('/api/admin/codes/generate', a, {})
    assert.equal(write.status, 401)
    assert.match(write.data.statusMessage, /其他设备登录/)
    assert.equal((await request('/api/auth/me', b)).data.user.id, ids[0])
  })
  await check('旧设备退出及迟到退出均不注销新会话', async () => {
    assert.equal((await request('/api/auth/logout', a, {})).status, 200)
    assert.equal((await request('/api/auth/me', b)).data.user.id, ids[0])
    // 模拟旧退出请求已解析会话、但更新在新登录完成后才到达数据库。
    await endBackendSession(verifySessionToken(decodeURIComponent(a.split('=').slice(1).join('='))))
    assert.equal((await request('/api/auth/me', b)).data.user.id, ids[0])
  })
  await check('错误密码不会踢掉当前登录', async () => {
    assert.equal((await request('/api/auth/login', '', { username: tag, password: 'incorrect-password' })).status, 401)
    assert.equal((await request('/api/auth/me', b)).data.user.id, ids[0])
  })
  await check('当前设备退出后，复制的旧凭证不能继续使用', async () => {
    assert.equal((await request('/api/auth/logout', b, {})).status, 200)
    assert.equal((await request('/api/auth/me', b)).data.user, null)
    assert.equal((await request('/api/admin/products', b)).status, 401)
  })
  await check('12个真实并发登录结束后只保留一个有效会话', async () => {
    const cookies = await Promise.all(Array.from({ length: 12 }, () => login()))
    assert.equal(new Set(cookies).size, 12)
    const states = await Promise.all(cookies.map(cookie => request('/api/auth/me', cookie)))
    assert.equal(states.filter(r => r.data.user).length, 1)
    assert.equal(states.filter(r => r.data.sessionInvalidated).length, 11)
  })
  await check('同毫秒登录和时钟回拨仍分配不同版本，注销版本也递增', async () => {
    const clock = Date.now
    let one, two
    try {
      Date.now = () => 1
      one = await startBackendSession(ids[0], hash, '127.0.0.1')
      two = await startBackendSession(ids[0], hash, '127.0.0.1')
      assert.equal(two.sessionVersion, one.sessionVersion + 1)
      await endBackendSession({ userId: ids[0], issuedAt: one.sessionVersion })
      assert.equal(await epoch(), two.sessionVersion)
      await revokeUserSessions(ids[0])
      assert.equal(await epoch(), two.sessionVersion + 1)
    } finally { Date.now = clock }
    const forged = 'nz315_user=' + createSessionToken(ids[0], (await epoch()) + 1000)
    assert.equal((await request('/api/auth/me', forged)).data.user, null, '未来版本不能通过旧版的大于等于判定')
  })
  await check('密码重置注销当前会话，旧密码不可重新登录', async () => {
    const current = await login()
    const admin = await login(tag + '_admin')
    const nextPassword = randomBytes(18).toString('hex')
    assert.equal((await request('/api/admin/users/' + ids[0] + '/reset-password', admin, { password: nextPassword })).status, 200)
    assert.equal((await request('/api/auth/me', current)).data.user, null)
    assert.equal((await request('/api/auth/login', '', { username: tag, password })).status, 401)
    assert.equal((await request('/api/auth/me', await login(tag, nextPassword))).data.user.id, ids[0])
  })
  await check('锁内重验拒绝已变更的旧密码及禁用账号，失败不改变会话版本', async () => {
    const before = await epoch()
    await assert.rejects(startBackendSession(ids[0], hash, '127.0.0.1'), e => e.statusCode === 401)
    assert.equal(await epoch(), before)
    const [[u]] = await db.query('SELECT password FROM `user` WHERE id=?', [ids[0]])
    await db.execute('UPDATE `user` SET status=0 WHERE id=?', [ids[0]])
    await assert.rejects(startBackendSession(ids[0], u.password, '127.0.0.1'), e => e.statusCode === 403)
    assert.equal(await epoch(), before)
  })
} finally {
  // 精确按本轮账号ID清理，其他账号、业务数据和日志不碰。
  if (ids.length) {
    await db.query('DELETE FROM operation_log WHERE user_id IN (?)', [ids])
    await db.query('DELETE FROM `user` WHERE id IN (?) AND username LIKE ?', [ids, tag + '%'])
    const [[r]] = await db.query('SELECT COUNT(*) AS n FROM `user` WHERE id IN (?)', [ids])
    assert.equal(r.n, 0)
  }
  await db.end()
  await getPool().end()
  mkdirSync('logs/single-session-2026-10-07', { recursive: true })
  writeFileSync('logs/single-session-2026-10-07/results.json', JSON.stringify({ results, cleaned: true }, null, 2))
}
console.log('全部通过：' + results.length + ' 项；临时账号与日志已清理')
