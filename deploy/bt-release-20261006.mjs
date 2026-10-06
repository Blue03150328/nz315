// 宝塔受控发布：先独立构建，再停站备份与切换，仅管理 nz315。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'

const LIVE = '/var/www/nz315'
const STAGE = '/var/www/.nz315-candidate-20261006-201b65a'
const OLD = '/var/www/.nz315-previous-20261006-201b65a'
const FAILED = '/var/www/.nz315-failed-20261006-201b65a'
const SAFE = '/var/backups/nz315/release-20261006-201b65a'
const NODE = '/usr/local/node22/bin/node'
const PACKAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'nz315-201b65a-source.tar.gz')
const PACKAGE_HASH = '0a1f8734a27908740724e5cfcafa157fd3f83ff7a78e901901c26fb6409e270c'
const TOOL_HASH = '04373ae1dc21752636f1b68945edb2dca8cff19c8b005b2ace1070cbc0a72fe8'
const STATE = path.join(SAFE, 'state.json')
const mode = process.argv[2]

function must(value, message) { if (!value) throw new Error(message) }
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function command(exe, args, options = {}) {
  return execFileSync(exe, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options })
}
function pm2(args) { return command('pm2', args) }
function processes() { return JSON.parse(pm2(['jlist'])) }
function config(root) { return parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8')) }
function state() { return JSON.parse(fs.readFileSync(STATE, 'utf8')) }
function save(value) { fs.writeFileSync(STATE, JSON.stringify(value, null, 2), { mode: 0o600 }) }
function ensureDirectory(target) {
  must(fs.existsSync(target) && fs.lstatSync(target).isDirectory() && !fs.lstatSync(target).isSymbolicLink(), '应用目录不存在或为符号链接：' + target)
}
function publicPermissions(root) {
  // 仅开放静态文件的读取权限；服务端构建及生产配置仍为受限权限。
  for (const name of fs.readdirSync(root)) {
    const file = path.join(root, name)
    const stat = fs.lstatSync(file)
    if (stat.isSymbolicLink()) continue
    fs.chmodSync(file, stat.isDirectory() ? 0o755 : 0o644)
    if (stat.isDirectory()) publicPermissions(file)
  }
  fs.chmodSync(root, 0o755)
}
function metadata() {
  ensureDirectory(LIVE)
  const all = processes()
  const nz = all.filter(p => p.name === 'nz315')
  must(nz.length === 1, '必须存在且仅存在一个 nz315 PM2 进程')
  const e = nz[0].pm2_env
  must(e.status === 'online', 'nz315 当前不是 online')
  must(e.pm_cwd === LIVE && e.pm_exec_path === LIVE + '/.output/server/index.mjs', '现役 PM2 路径不符合本执行单，请保留旧站并反馈结果')
  must(e.exec_interpreter === NODE && String(e.NITRO_PORT || e.PORT) === '3100', '现役 Node 或端口不符合本执行单')
  must(e.exec_mode === 'fork_mode', '现役不是单实例 fork 模式')
  const env = config(LIVE)
  for (const k of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'SESSION_SECRET']) must(env[k], '生产配置缺少键：' + k)
  must(env.DB_NAME === 'nz315', '数据库名必须是 nz315')
  // 保留 PM2 原配置；数据库或会话密钥覆盖与文件不一致时停止，避免构建和备份指向不同配置。
  const mappings = { NUXT_DB_HOST: 'DB_HOST', NUXT_DB_PORT: 'DB_PORT', NUXT_DB_USER: 'DB_USER', NUXT_DB_PASSWORD: 'DB_PASSWORD', NUXT_DB_NAME: 'DB_NAME', NUXT_SESSION_SECRET: 'SESSION_SECRET' }
  for (const [key, fileKey] of Object.entries(mappings)) if (e[key] !== undefined) must(String(e[key]) === env[fileKey], 'PM2 与 .env 配置不一致：' + key + '，停止自动流程')
  const other = all.filter(p => p.name !== 'nz315').map(p => ({ id: p.pm_id, name: p.name, pid: p.pid, status: p.pm2_env.status }))
  return { env, other, pid: nz[0].pid }
}
async function connect(root) {
  const env = config(root)
  const mysql = createRequire(path.join(root, 'package.json'))('mysql2/promise')
  return mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME })
}
export function expectedColumns(root) {
  // 只读取固定源码中的建表文本，不执行 db-init，不执行其旧数据迁移或演示数据。
  const source = fs.readFileSync(path.join(root, 'scripts/db-init.mjs'), 'utf8').replaceAll('\\`', '`')
  const expected = []
  for (const m of source.matchAll(/CREATE TABLE IF NOT EXISTS `?(\w+)`? \(([\s\S]*?)\) ENGINE=/g)) {
    for (const c of m[2].matchAll(/^\s*`?(\w+)`?\s+(?:BIGINT|TINYINT|INT|CHAR|VARCHAR|TEXT|MEDIUMTEXT|JSON|DATE|DATETIME|DECIMAL)\b/gm)) expected.push([m[1], c[1]])
  }
  must(new Set(expected.map(c => c[0])).size === 17 && expected.length > 180, '固定源码结构解析不完整')
  return expected
}
const additions = {
  'farm_bill.dosage': "ALTER TABLE farm_bill ADD COLUMN dosage VARCHAR(50) NULL COMMENT '剂型（扫码带入或手填）' AFTER product_name",
  'farm_bill.store_name': "ALTER TABLE farm_bill ADD COLUMN store_name VARCHAR(100) NULL COMMENT '具体购买门店（可空）' AFTER channel",
}
export function permittedMissing(expected, found) {
  const missing = expected.map(c => c.join('.')).filter(c => !found.has(c))
  must(missing.every(c => Object.hasOwn(additions, c)), '存在本执行单未覆盖的缺表或缺列：' + missing.join('、'))
  return missing
}
async function schema(root) {
  const db = await connect(root)
  try {
    const [rows] = await db.query('SELECT TABLE_NAME AS t,COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()')
    const found = new Set(rows.map(r => r.t + '.' + r.c))
    const missing = permittedMissing(expectedColumns(root), found)
    const [indices] = await db.query('SELECT TABLE_NAME AS t,INDEX_NAME AS i FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()')
    const foundIndices = new Set(indices.map(r => r.t + '.' + r.i))
    const ddl = fs.readFileSync(path.join(root, 'scripts/db-init.mjs'), 'utf8').replaceAll('\\`', '`')
    const requiredIndices = []
    for (const m of ddl.matchAll(/CREATE TABLE IF NOT EXISTS `?(\w+)`? \(([\s\S]*?)\) ENGINE=/g)) {
      requiredIndices.push(m[1] + '.PRIMARY')
      for (const index of m[2].matchAll(/^\s*(?:UNIQUE )?KEY (\w+)/gm)) requiredIndices.push(m[1] + '.' + index[1])
    }
    const absentIndices = requiredIndices.filter(i => !foundIndices.has(i))
    must(!absentIndices.length, '现役缺少必要索引：' + absentIndices.join('、') + '；本执行单不自动补索引')
    const [engines] = await db.query("SELECT TABLE_NAME AS t,ENGINE AS e FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'")
    must(engines.every(t => t.e === 'InnoDB'), '存在非 InnoDB 表，需单独核对备份一致性')
    return missing
  } finally { await db.end() }
}
function syncPublic() {
  // 保留服务器上传件及校验文件，再覆盖候选仓库管理的静态文件；不带入工具运行缓存。
  must(!fs.existsSync(LIVE + '/public/tools/app-data'), '现役 public/tools/app-data 存在，请先单独处理公开缓存')
  command('cp', ['-a', LIVE + '/public/.', STAGE + '/public/'])
  command('tar', ['-xzf', PACKAGE, '-C', STAGE, 'public'])
  must(fs.existsSync(STAGE + '/public/tools/nz315-qr-tool-v1.2.0.exe'), '服务器缺少离线工具，请上传官方 v1.2.0 后重新准备')
  must(sha(STAGE + '/public/tools/nz315-qr-tool-v1.2.0.exe') === TOOL_HASH, '现役离线工具校验不符')
}
async function fingerprint() {
  const r = await fetch('https://www.nz315.cn/_nuxt/builds/latest.json?release_check=' + Date.now(), { signal: AbortSignal.timeout(20000), cache: 'no-store' })
  must(r.ok, '公网指纹请求失败')
  return r.json()
}
async function prepare() {
  must(!fs.existsSync(STAGE) && !fs.existsSync(OLD) && !fs.existsSync(SAFE), '已存在本次候选或备份目录，停止重复执行；先查看原结果')
  must(sha(PACKAGE) === PACKAGE_HASH, '源码包 SHA256 不匹配')
  const meta = metadata()
  const before = await fingerprint()
  const free = Number(command('df', ['-Pk', '/var/www']).trim().split('\n').at(-1).trim().split(/\s+/)[3])
  must(free >= 4 * 1024 * 1024, '/var/www 可用空间不足 4GB')
  const backupFree = Number(command('df', ['-Pk', '/var/backups']).trim().split('\n').at(-1).trim().split(/\s+/)[3])
  must(backupFree >= 2 * 1024 * 1024, '/var/backups 可用空间不足2GB')
  must(command(NODE, ['--version']).startsWith('v22.'), '需要本执行单指定的 Node22')
  const dump = command('sh', ['-c', 'command -v mysqldump || true']).trim()
  must(dump, '当前 PATH 无 mysqldump；在宝塔确认 MySQL80 程序路径并加入终端 PATH')
  must(/\b8\.0\./.test(command(dump, ['--version'])), '备份程序必须为 MySQL8.0 mysqldump')
  const currentSchema = await connect(LIVE)
  await currentSchema.end()
  const sourceBefore = {}
  for (const f of ['package.json', 'package-lock.json', 'scripts/db-init.mjs']) sourceBefore[f] = sha(LIVE + '/' + f)
  fs.mkdirSync(SAFE, { recursive: true, mode: 0o700 })
  fs.mkdirSync(STAGE, { mode: 0o700 })
  command('tar', ['-xzf', PACKAGE, '-C', STAGE])
  const sourceFiles = command('tar', ['-tzf', PACKAGE]).trim().split('\n').filter(f => !f.endsWith('/'))
  const differences = sourceFiles.filter(f => !fs.existsSync(LIVE + '/' + f) || sha(LIVE + '/' + f) !== sha(STAGE + '/' + f))
  fs.writeFileSync(SAFE + '/source-diff.json', JSON.stringify({ source: '201b65a', oldCriticalHashes: sourceBefore, changedOrAdded: differences }, null, 2), { mode: 0o600 })
  command('cp', ['-a', LIVE + '/.env', STAGE + '/.env'])
  fs.chmodSync(STAGE + '/.env', 0o600)
  syncPublic()
  fs.mkdirSync(STAGE + '/logs', { recursive: true, mode: 0o700 })
  const buildEnv = { ...process.env, PATH: '/usr/local/node22/bin:' + process.env.PATH }
  command('/usr/local/node22/bin/npm', ['ci', '--no-audit', '--no-fund'], { cwd: STAGE, env: buildEnv, stdio: 'inherit' })
  const pending = await schema(STAGE)
  command(NODE, ['node_modules/nuxt/bin/nuxt.mjs', 'build'], { cwd: STAGE, env: buildEnv, stdio: 'inherit' })
  must(fs.existsSync(STAGE + '/.output/server/index.mjs'), '构建未生成入口')
  const next = JSON.parse(fs.readFileSync(STAGE + '/.output/public/_nuxt/builds/latest.json', 'utf8'))
  await candidateSmoke()
  const oldMarker = fs.existsSync(LIVE + '/.deploy-version') ? fs.readFileSync(LIVE + '/.deploy-version', 'utf8') : '现役无源码版本标记'
  save({ phase: 'prepared', before, next, envHash: sha(LIVE + '/.env'), pending, other: meta.other, dump, oldMarker, sourceBefore, packageHash: PACKAGE_HASH })
  console.log(JSON.stringify({ 结果: '准备完成，旧站仍运行', 现役源码: oldMarker, 源码差异文件数: differences.length, 差异记录: SAFE + '/source-diff.json', 旧指纹: before, 新指纹: next, 待补列: pending, 下一步: 'publish' }, null, 2))
}
async function candidateSmoke() {
  const child = spawn(NODE, ['.output/server/index.mjs'], { cwd: STAGE, env: { ...process.env, HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: '33100', NITRO_PORT: '33100' }, stdio: ['ignore', 'ignore', 'ignore'] })
  let error
  child.on('error', e => { error = e })
  try {
    let ready = false
    for (let i = 0; i < 20; i++) {
      if (error || child.exitCode !== null) throw new Error('候选预览进程未能启动，请核对33100是否空闲')
      try { const r = await fetch('http://127.0.0.1:33100/_nuxt/builds/latest.json', { signal: AbortSignal.timeout(1000) }); const d = await r.json(); const expected = JSON.parse(fs.readFileSync(STAGE + '/.output/public/_nuxt/builds/latest.json', 'utf8')); if (d.id === expected.id) { ready = true; break } } catch {}
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    must(ready, '候选预览没有返回本次构建指纹')
    for (const route of ['/login', '/scan']) { const r = await fetch('http://127.0.0.1:33100' + route, { signal: AbortSignal.timeout(10000) }); must(r.ok, '候选页面失败：' + route) }
    const guard = await fetch('http://127.0.0.1:33100/api/admin/products', { signal: AbortSignal.timeout(10000) })
    must(guard.status === 401, '候选未登录权限守卫失败')
  } finally {
    child.kill('SIGTERM')
    if (child.exitCode === null) await Promise.race([new Promise(resolve => child.once('close', resolve)), new Promise(resolve => setTimeout(resolve, 5000))])
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}
async function backupDatabase(root, dump) {
  const env = config(root)
  const file = SAFE + '/nz315.sql.gz'
  const child = spawn(dump, ['--no-defaults', '-h', env.DB_HOST, '-P', env.DB_PORT, '-u', env.DB_USER, '--single-transaction', '--routines', '--events', '--triggers', '--hex-blob', '--set-gtid-purged=OFF', '--no-tablespaces', '--default-character-set=utf8mb4', env.DB_NAME], { env: { ...process.env, MYSQL_PWD: env.DB_PASSWORD }, stdio: ['ignore', 'pipe', 'pipe'] })
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error('mysqldump 失败，未切换应用'))) })
  // 原始错误可能含连接信息，保存到受限备份目录，终端仅输出结果。
  const errors = fs.createWriteStream(SAFE + '/mysqldump.error.log', { mode: 0o600 })
  child.stderr.pipe(errors)
  await Promise.all([done, pipeline(child.stdout, createGzip(), fs.createWriteStream(file, { mode: 0o600 }))])
  command('gzip', ['-t', file])
  must(fs.statSync(file).size > 100, '数据库备份异常过小')
  fs.writeFileSync(file + '.sha256', sha(file) + '  nz315.sql.gz\n', { mode: 0o600 })
}
function otherUnchanged(saved) {
  const current = processes().filter(p => p.name !== 'nz315').map(p => ({ id: p.pm_id, name: p.name, pid: p.pid, status: p.pm2_env.status }))
  must(JSON.stringify(current) === JSON.stringify(saved.other), '其他 PM2 进程状态发生变化，请核对')
}
async function publish() {
  const s = state()
  must(s.phase === 'prepared', '必须先 prepare，且只能切换一次')
  must(sha(PACKAGE) === PACKAGE_HASH && s.packageHash === PACKAGE_HASH, '准备后源码包发生变化，停止发布')
  metadata()
  must(sha(LIVE + '/.env') === s.envHash && sha(STAGE + '/.env') === s.envHash, '准备后生产配置已变，请重新核对')
  for (const [f, hash] of Object.entries(s.sourceBefore)) must(sha(LIVE + '/' + f) === hash, '准备后现役源码已变化：' + f)
  must(JSON.stringify(await fingerprint()) === JSON.stringify(s.before), '准备后线上版本已变化，停止切换')
  must(!fs.existsSync(OLD), '旧应用保存目录已存在')
  await schema(STAGE)
  fs.writeFileSync(SAFE + '/pm2-before.private.json', pm2(['jlist']), { mode: 0o600 })
  console.log('开始停站窗口：仅停止 nz315，其他 PM2 进程保持运行。')
  pm2(['stop', 'nz315'])
  s.phase = 'stopped'; save(s)
  try {
    // 保留完整现役目录和配置；额外留一份配置，供人工诊断。
    command('cp', ['-a', LIVE + '/.env', SAFE + '/production.env'])
    command('tar', ['-czf', SAFE + '/application.tar.gz', '--exclude=./node_modules', '--exclude=./.git', '--exclude=./logs', '--exclude=./backup', '--exclude=./.output.bak-*', '--exclude=./.nuxt', '-C', LIVE, '.'])
    command('gzip', ['-t', SAFE + '/application.tar.gz'])
    fs.writeFileSync(SAFE + '/application.tar.gz.sha256', sha(SAFE + '/application.tar.gz') + '  application.tar.gz\n', { mode: 0o600 })
    await backupDatabase(LIVE, s.dump)
    command(NODE, ['scripts/verify-db-migration.mjs', 'dump'], { cwd: STAGE, stdio: 'inherit' })
    const pending = await schema(STAGE)
    if (pending.length) {
      const db = await connect(STAGE)
      try { await db.query('SET SESSION lock_wait_timeout=15'); for (const col of pending) { console.log('仅补可空列：' + col); await db.query(additions[col]) } } finally { await db.end() }
    }
    command(NODE, ['scripts/verify-db-migration.mjs', 'compare'], { cwd: STAGE, stdio: 'inherit' })
    // 沿用已有备份历史，且不复制旧运行源码或旧构建。
    if (fs.existsSync(LIVE + '/backup')) command('cp', ['-a', LIVE + '/backup', STAGE + '/backup'])
    command('cp', ['-a', LIVE + '/public/.', STAGE + '/public/'])
    command('tar', ['-xzf', PACKAGE, '-C', STAGE, 'public'])
    command('cp', ['-a', STAGE + '/public/.', STAGE + '/.output/public/'])
    fs.renameSync(LIVE, OLD)
    s.phase = 'old-moved'; save(s)
    fs.renameSync(STAGE, LIVE)
    // 恢复现役应用目录权限，保证现有 nginx 静态映射仍可读取；配置保持0600。
    fs.chmodSync(LIVE, fs.statSync(OLD).mode & 0o777)
    fs.chmodSync(LIVE + '/.env', 0o600)
    fs.chmodSync(LIVE + '/.output', 0o755)
    publicPermissions(LIVE + '/public')
    publicPermissions(LIVE + '/.output/public')
    s.phase = 'switched'; save(s)
    fs.writeFileSync(LIVE + '/.deploy-version', JSON.stringify({ source: '201b65a', packageSHA256: PACKAGE_HASH, build: s.next, deployedAt: new Date().toISOString() }, null, 2) + '\n')
    pm2(['restart', 'nz315'])
    await verify()
    s.phase = 'published'; save(s)
    console.log('切换及匿名冒烟通过；保持厂家停写，完成后台人工验收后开放。')
  } catch (e) {
    console.error('发布步骤失败：' + (e.code || e.message))
    if (fs.existsSync(OLD)) await rollback()
    else { pm2(['restart', 'nz315']); s.phase = 'failed-before-switch'; save(s); console.log('已重新启动旧应用；已补的可空列保留，不覆盖数据库。') }
    throw new Error('发布失败，已执行应用恢复流程；不要继续重复 publish')
  }
}
async function verify() {
  const s = state()
  let ok = false
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch('http://127.0.0.1:3100/login', { signal: AbortSignal.timeout(3000) }); if (r.ok) { ok = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  must(ok, '回环登录页未恢复')
  for (const url of ['https://www.nz315.cn/login', 'https://www.nz315.cn/scan']) {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); must(r.ok, '页面冒烟失败：' + url)
  }
  const r = await fetch('https://www.nz315.cn/api/admin/products', { signal: AbortSignal.timeout(15000), redirect: 'manual' })
  must(r.status === 401, '后台未登录守卫异常，预期401，实际' + r.status)
  const actual = await fingerprint()
  must(actual.id === s.next.id && actual.timestamp === s.next.timestamp, '公网指纹与候选构建不一致')
  otherUnchanged(s)
  console.log(JSON.stringify({ 匿名冒烟: '通过', 公网指纹: actual, 其他进程: '未变化', 备份: SAFE, 旧应用: OLD }, null, 2))
}
async function rollback() {
  const s = state()
  must(fs.existsSync(OLD), '没有旧应用目录，停止回退')
  must(!fs.existsSync(FAILED), '已有失败现场目录，停止重复回退')
  if (mode === 'rollback') {
    const current = JSON.parse(fs.readFileSync(LIVE + '/.deploy-version', 'utf8'))
    must(current.source === '201b65a' && current.build?.id === s.next.id, '现役已不是本执行单切换的版本，停止回退')
  }
  pm2(['stop', 'nz315'])
  if (fs.existsSync(LIVE)) fs.renameSync(LIVE, FAILED)
  fs.renameSync(OLD, LIVE)
  pm2(['restart', 'nz315'])
  s.phase = 'rolled-back'; save(s)
  let restored
  for (let i = 0; i < 20; i++) {
    try { restored = await fingerprint(); if (restored.id === s.before.id && restored.timestamp === s.before.timestamp) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  must(restored?.id === s.before.id && restored?.timestamp === s.before.timestamp, '旧应用已重启，公网旧指纹尚未恢复，请检查PM2及代理')
  console.log('旧应用与公网旧指纹已恢复；新应用现场保存在 ' + FAILED + '。数据库不覆盖，新增可空列保留。')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) try {
  must(process.platform === 'linux', '仅在宝塔 Linux 服务器运行；本机不执行生产流程')
  must(['prepare', 'publish', 'verify', 'rollback'].includes(mode), '用法：node bt-release-20261006.mjs prepare|publish|verify|rollback')
  must(process.getuid() === 0, '请使用管理现役 PM2 的 root 宝塔终端')
  process.umask(0o077)
  await ({ prepare, publish, verify, rollback })[mode]()
} catch (e) {
  console.error('已停止：' + (e.code || e.message))
  process.exitCode = 1
}
