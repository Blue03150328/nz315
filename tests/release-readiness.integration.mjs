// 上线前本机验收：验证当前事务读、来源校验及隔离库备份恢复；不连接生产库。
import mysql from 'mysql2/promise'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { register } from 'node:module'
register('./_ts-loader.mjs', import.meta.url)

if (process.env.NZ315_RELEASE_LIVE !== '1') { console.log('默认跳过；仅本机设置 NZ315_RELEASE_LIVE=1 后选择 --guards 或 --backup'); process.exit(0) }
const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] }))
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST), '仅允许本机数据库')
assert.match(env.DB_NAME, /^[a-zA-Z0-9_]+$/)
const config = { host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true }
const db = await mysql.createConnection(config)
const base = 'http://localhost:3100'
const dir = 'logs/release-2026-10-06'
mkdirSync(dir, { recursive: true })
const results = []
async function check(name, fn) { try { results.push({ name, pass: true, evidence: await fn() }); console.log('PASS ' + name) } catch (e) { results.push({ name, pass: false, evidence: e.message }); console.log('FAIL ' + name + ': ' + e.message) } }
async function login(username) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'admin123' }) })
  assert.equal(r.status, 200); return r.headers.get('set-cookie').split(';')[0]
}
async function request(path, body, cookie, extra = {}) {
  const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { cookie: cookie || '', 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) })
  return { status: r.status, data: await r.json() }
}
try {
  const manufacturer = await login('lvfeng')
  if (process.argv.includes('--guards')) {
    await check('恶意Origin无法通过伪造转发Host绕过', async () => {
      const path = '/api/admin/codes/generate'
      for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' }]) assert.equal((await request(path, {}, manufacturer, headers)).status, 403)
      assert.equal((await request(path, {}, manufacturer, { Origin: base, 'x-forwarded-host': 'evil.example' })).status, 400)
      assert.equal((await request(path, {}, manufacturer)).status, 400)
    })
    await check('外部核验前置拒绝点分内网及IPv6地址', async () => {
      globalThis.createError = ({ statusCode, statusMessage }) => Object.assign(new Error(statusMessage), { statusCode })
      const { fetchExternalSource } = await import('../server/utils/external-verification.ts')
      for (const source of ['http://127.0.0.1/', 'http://10.0.0.1/', 'http://172.16.1.2/', 'http://192.168.1.1/', 'http://169.254.169.254/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/']) await assert.rejects(fetchExternalSource(source, '123'), e => e.statusCode === 400)
    })
    const state = JSON.parse(readFileSync('logs/manufacturer-2026-10-06/manifest.json', 'utf8'))
    assert.match(state.tag, /^__厂家全流程_\d+$/)
    assert.notEqual(state.cleanup?.matches, true)
    const [[product]] = await db.query('SELECT name FROM product WHERE id=?', [state.productId])
    assert.equal(product.name, state.tag)
    const [[code]] = await db.query('SELECT * FROM trace_code WHERE product_id=? AND abnormal_flag=0 AND batch_id IS NOT NULL ORDER BY id LIMIT 1', [state.productId])
    assert.ok(code)
    // 显式等待InnoDB报告锁等待，证明请求已进入事务；随后提交状态变化。
    async function race(table, id, field, value, body) {
      assert.ok(['trace_code', 'batch'].includes(table))
      const lock = await mysql.createConnection(config)
      const [[before]] = await db.query('SELECT * FROM `' + table + '` WHERE id=?', [id])
      let pending
      try {
        await lock.beginTransaction()
        await lock.query('UPDATE `' + table + '` SET `' + field + '`=? WHERE id=?', [value, id])
        pending = request('/api/admin/codes/' + code.id + '/correct', body, manufacturer)
        let waited = false
        for (let i = 0; i < 500; i++) {
          const [[r]] = await db.query('SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME=?', [env.DB_NAME, table])
          if (r.n > 0) { waited = true; break }
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        assert.ok(waited, '未观察到请求锁等待，不能把顺序测试算作并发')
        await lock.commit()
        assert.equal((await pending).status, 400)
        const [[after]] = await db.query('SELECT * FROM trace_code WHERE id=?', [code.id])
        assert.equal(after.quality_cert_no, code.quality_cert_no)
        assert.equal(after.batch_id, code.batch_id)
        return { lockWaitObserved: true, rejected: true }
      } finally {
        await lock.rollback()
        if (pending) await pending
        await db.query('UPDATE `' + table + '` SET `' + field + '`=? WHERE id=?', [before[field], id])
        await lock.end()
      }
    }
    await check('请求等待期间提交冻结，修改按最新状态拒绝', () => race('trace_code', code.id, 'abnormal_flag', 1, { qualityCertNo: '不得写入_并发冻结' }))
    await check('请求等待期间提交不合格，重绑定按最新状态拒绝', () => race('batch', code.batch_id, 'qc_result', 0, { batchId: code.batch_id, qcResult: 1 }))
  }
  if (process.argv.includes('--backup')) {
    const admin = await login('admin')
    await check('备份下载拒绝未登录、厂家、路径穿越与不存在文件', async () => {
      const path = '/api/admin/backup/download?file=nz315_20000101000000.sql'
      assert.equal((await request(path)).status, 401)
      assert.equal((await request(path, undefined, manufacturer)).status, 403)
      assert.equal((await request('/api/admin/backup/download?file=..%2F.env', undefined, admin)).status, 400)
      assert.equal((await request(path, undefined, admin)).status, 404)
    })
    await check('总部备份实际下载并在独立库恢复，原库不覆盖', async () => {
      const [[{ n: active }]] = await db.query("SELECT COUNT(*) AS n FROM product WHERE name LIKE '__厂家全流程_%'")
      assert.equal(active, 0, '先清理厂家测试数据再备份')
      const [tables] = await db.query('SHOW TABLES')
      const names = tables.map(r => Object.values(r)[0]).filter(name => name !== 'operation_log')
      for (const name of names) assert.match(name, /^[a-zA-Z0-9_]+$/)
      const baseline = {}
      for (const name of names) {
        const [[count]] = await db.query('SELECT COUNT(*) AS n FROM `' + name + '`')
        const [[checksum]] = await db.query('CHECKSUM TABLE `' + name + '`')
        assert.notEqual(checksum.Checksum, null)
        baseline[name] = { count: count.n, checksum: checksum.Checksum }
      }
      const backup = await request('/api/admin/backup', {}, admin)
      assert.equal(backup.status, 200)
      const file = backup.data.file
      assert.match(file, /^nz315_[0-9]{14}\.sql$/)
      const download = await fetch(base + '/api/admin/backup/download?file=' + file, { headers: { cookie: admin }, signal: AbortSignal.timeout(60000) })
      assert.equal(download.status, 200)
      assert.equal(download.headers.get('cache-control'), 'no-store')
      assert.ok(download.headers.get('content-disposition').includes(file))
      const bytes = Buffer.from(await download.arrayBuffer())
      assert.equal(bytes.length, backup.data.size)
      assert.deepEqual(bytes, readFileSync('backup/' + file))
      const downloaded = dir + '/' + file
      writeFileSync(downloaded, bytes)
      const restoreDb = 'nz315_verify_restore_' + Date.now()
      assert.match(restoreDb, /^nz315_verify_restore_\d+$/)
      try {
        await db.query('CREATE DATABASE `' + restoreDb + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
        await new Promise((resolve, reject) => {
          const executable = process.platform === 'win32' ? 'C:/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe' : 'mysql'
          const child = spawn(executable, ['-h', env.DB_HOST, '-P', String(config.port), '-u', env.DB_USER, '--default-character-set=utf8mb4', restoreDb], { env: { ...process.env, MYSQL_PWD: env.DB_PASSWORD }, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] })
          child.stderr.resume()
          child.on('error', () => reject(new Error('恢复程序无法启动')))
          child.on('close', code => code === 0 ? resolve() : reject(new Error('恢复失败，退出码' + code)))
          createReadStream(downloaded).pipe(child.stdin)
        })
        for (const name of names) {
          const [[count]] = await db.query('SELECT COUNT(*) AS n FROM `' + restoreDb + '`.`' + name + '`')
          const [[checksum]] = await db.query('CHECKSUM TABLE `' + restoreDb + '`.`' + name + '`')
          assert.deepEqual({ count: count.n, checksum: checksum.Checksum }, baseline[name], name + '恢复不一致')
          const [[current]] = await db.query('CHECKSUM TABLE `' + name + '`')
          assert.equal(current.Checksum, baseline[name].checksum, name + '原库内容变化')
        }
        return { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), comparedTables: names.length, auditLogExcluded: true, restored: true, originalDatabaseUnchanged: true }
      } finally { await db.query('DROP DATABASE IF EXISTS `' + restoreDb + '`') }
    })
  }
} finally {
  await db.end()
  writeFileSync(dir + '/' + (process.argv.includes('--backup') ? 'backup' : 'guards') + '-results.json', JSON.stringify(results, null, 2))
}
if (results.some(r => !r.pass)) process.exitCode = 1
