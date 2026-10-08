// 本机阿尔法采集文件同步；默认先校验最新完整文件，再原子更新独立资料表。
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import XLSX from 'xlsx'
import { ensureAlphaTables } from './alpha-sync/schema.mjs'
import { PRODUCT_HEADERS, LISTING_HEADERS, sourceDate, selectLatest, checkFreshness, syncDue,
  rowsFromSheet, normalizeSnapshot, applySnapshot, hash } from './alpha-sync/core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOG = path.join(ROOT, 'logs', 'alpha-sync.ndjson')
const args = process.argv.slice(2)

export async function loadLocalDbConfig() {
  const env = {}
  for (const line of (await fs.readFile(path.join(ROOT, '.env'), 'utf8')).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i)
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  const config = { host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306),
    user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME || 'nz315',
    charset: 'utf8mb4', dateStrings: ['DATE'], timezone: 'Z', connectTimeout: 10000 }
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.host) || config.database !== 'nz315') {
    throw new Error('同步仅允许本机nz315数据库，拒绝连接其它目标')
  }
  return config
}

async function log(result) {
  const entry = { time: new Date().toISOString(), ...result }
  await fs.mkdir(path.dirname(LOG), { recursive: true })
  await fs.appendFile(LOG, `${JSON.stringify(entry)}\n`)
  console.log(JSON.stringify(entry))
}

async function readLatest(directory) {
  const file = path.join(directory, selectLatest(await fs.readdir(directory)))
  const date = sourceDate(path.basename(file))
  checkFreshness(date)
  const before = await fs.stat(file)
  if (Date.now() - before.mtimeMs < 120000) throw new Error('最新价格表正在生成或刚生成，请两分钟后重试')
  const buffer = await fs.readFile(file)
  const after = await fs.stat(file)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('读取期间文件变化，拒绝同步')
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const products = rowsFromSheet(XLSX, workbook.Sheets['产品价格表'], PRODUCT_HEADERS, '产品价格表')
  const listings = rowsFromSheet(XLSX, workbook.Sheets['店铺上架'], LISTING_HEADERS, '店铺上架')
  if (products.length < 100) throw new Error('全平台价格表少于100行，拒绝疑似不完整文件')
  const snapshot = normalizeSnapshot(products, listings)
  // 采集器成功日志确认文件已完整导出，不在失败或半成品上推进同步日期。
  const collectorLog = await fs.readFile(path.resolve(directory, '..', 'logs', 'run.log'), 'utf8')
  if (!collectorLog.split(/\r?\n/).some(line => line.includes('[alpha] 完成：')
      && line.includes(`完成：${products.length} 行`) && line.includes(file))) {
    throw new Error('采集日志未确认这份文件完整导出，拒绝同步')
  }
  return { snapshot, metadata: { file, date, sha256: hash(buffer) } }
}

async function main() {
  if (args.some(arg => !['--dry-run', '--due', '--status'].includes(arg))) throw new Error('仅支持 --dry-run、--due、--status')
  const config = JSON.parse(await fs.readFile(path.join(ROOT, 'config', 'alpha-sync.json'), 'utf8'))
  const dbConfig = await loadLocalDbConfig()
  if (args.includes('--dry-run')) {
    const { snapshot, metadata } = await readLatest(config.sourceDirectory)
    return log({ status: 'validated', sourceDate: metadata.date, prices: snapshot.products.length,
      listings: snapshot.listings.length, sha256: metadata.sha256 })
  }
  const conn = await mysql.createConnection(dbConfig)
  let locked = false
  try {
    await conn.query("SET time_zone='+00:00'")
    const [locks] = await conn.query("SELECT GET_LOCK('nz315:alpha-price-sync',0) AS acquired")
    locked = locks[0].acquired === 1
    if (!locked) return log({ status: 'skipped', reason: '已有同步任务正在运行' })
    const [tables] = await conn.query("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='alpha_sync_run'")
    let last = null
    if (tables.length) {
      const [rows] = await conn.query('SELECT * FROM alpha_sync_run ORDER BY completed_at DESC LIMIT 1')
      last = rows[0] || null
    }
    if (args.includes('--status')) return log({ status: 'info', lastSuccess: last,
      intervalDays: config.intervalDays, nextDue: last ? new Date(last.completed_at.getTime() + config.intervalDays * 86400000).toISOString() : null })
    if (args.includes('--due') && !syncDue(last?.completed_at, new Date(), config.intervalDays)) {
      return log({ status: 'skipped', reason: '距离上次成功同步未满15天' })
    }
    const { snapshot, metadata } = await readLatest(config.sourceDirectory)
    await ensureAlphaTables(conn)
    await log(await applySnapshot(conn, snapshot, metadata))
  } finally {
    if (locked) await conn.query("SELECT RELEASE_LOCK('nz315:alpha-price-sync')")
    await conn.end()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async error => {
    // 驱动错误只记录代码，不打印可能包含凭据或整批业务数据的报文。
    await log({ status: 'failed', error: error.code || error.message }).catch(() => {})
    process.exitCode = 1
  })
}
