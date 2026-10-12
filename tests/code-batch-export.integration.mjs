// 「生成入库」留档批次导出验收（2026-10-10），仅本机运行。
// NZ315_EXPORT_LIVE=1 node tests/code-batch-export.integration.mjs
// 覆盖：匿名401 / 非留档批次403 / 跨企业404 / 非法格式400 / 空批次400 /
//       txt·urls·csv 三种格式内容与条数 / csv 列含义 / Content-Disposition 中文文件名 / 导出写入审计日志。
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'

if (process.env.NZ315_EXPORT_LIVE !== '1') { console.log('默认跳过；设置 NZ315_EXPORT_LIVE=1 后验收本机'); process.exit(0) }
const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]
}))
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST), '禁止操作远程数据库')
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true })

const tag = '__uexp_' + Date.now()
const stamp = String(Date.now()).slice(-8)
const password = randomBytes(18).toString('hex')
const hash = await bcrypt.hash(password, 10)
const results = []
const base = 'http://localhost:3100'
const codeOf = (n) => '9' + '000001' + '1' + '001' + stamp + String(n).padStart(13, '0') // 32 位

async function api(path) {
  const r = await fetch(base + path, { headers: { cookie: sessions.ea || '' }, signal: AbortSignal.timeout(30000) })
  return { status: r.status, data: await r.json().catch(() => null), headers: r.headers }
}
async function raw(path, cookie) {
  const r = await fetch(base + path, { headers: cookie === undefined ? { cookie: sessions.ea || '' } : { cookie }, signal: AbortSignal.timeout(30000) })
  return { status: r.status, headers: r.headers, text: await r.text() }
}
async function check(name, fn) { await fn(); results.push(name); console.log('PASS ' + name) }

const sessions = {}
const ids = {}
let success = false

const cleanup = async () => {
  const [ents] = await db.query('SELECT id FROM enterprise WHERE LEFT(name, ?) = ?', [tag.length, tag])
  const eids = ents.map((e) => e.id)
  if (eids.length) {
    const [ubs] = await db.query('SELECT id FROM upload_batch WHERE enterprise_id IN (?)', [eids])
    const ubIds = ubs.map((u) => u.id)
    if (ubIds.length) await db.query('DELETE FROM trace_code WHERE upload_batch_id IN (?)', [ubIds])
    await db.query('DELETE FROM trace_code WHERE enterprise_id IN (?)', [eids])
    await db.query('DELETE FROM upload_batch WHERE enterprise_id IN (?)', [eids])
    await db.query('DELETE FROM product WHERE enterprise_id IN (?)', [eids])
    await db.query('DELETE FROM product_spec WHERE enterprise_id IN (?)', [eids])
  }
  const [users] = await db.query('SELECT id FROM `user` WHERE LEFT(username, ?) = ?', [tag.length, tag])
  const uids = users.map((u) => u.id)
  if (uids.length) {
    await db.query('DELETE FROM operation_log WHERE user_id IN (?)', [uids])
    await db.query('DELETE FROM `user` WHERE id IN (?)', [uids])
  }
  if (eids.length) await db.query('DELETE FROM enterprise WHERE id IN (?)', [eids])
  const [[rest]] = await db.query(
    'SELECT (SELECT COUNT(*) FROM enterprise WHERE LEFT(name, ?) = ?) + (SELECT COUNT(*) FROM `user` WHERE LEFT(username, ?) = ?) + (SELECT COUNT(*) FROM product WHERE LEFT(name, ?) = ?) AS n',
    [tag.length, tag, tag.length, tag, tag.length, tag])
  assert.equal(rest.n, 0, '本轮测试数据必须全部清理')
  console.log('本轮临时企业与账号已清理')
}

try {
  // —— 夹具：企业 A（含留档/非留档/空批次）+ 企业 B（跨企业校验）——
  const [entA] = await db.execute('INSERT INTO enterprise (name, credit_code, renew_expire, status) VALUES (?,?,?,1)', [tag + 'A企业', '9A' + stamp.padStart(16, '0'), '2099-12-31'])
  const [entB] = await db.execute('INSERT INTO enterprise (name, credit_code, renew_expire, status) VALUES (?,?,?,1)', [tag + 'B企业', '9B' + stamp.padStart(16, '0'), '2099-12-31'])
  ids.entA = entA.insertId; ids.entB = entB.insertId

  const [spec] = await db.execute('INSERT INTO product_spec (enterprise_id, spec_name, spec_code, status) VALUES (?,?,?,1)', [ids.entA, tag + '规格', '901'])
  const [prod] = await db.execute('INSERT INTO product (enterprise_id, name, registration_no, reg_category, produce_type, spec_id, status) VALUES (?,?,?,1,1,?,1)', [ids.entA, tag + '产品', 'PD' + stamp, spec.insertId])
  const [prodB] = await db.execute('INSERT INTO product (enterprise_id, name, registration_no, reg_category, produce_type, status) VALUES (?,?,?,1,1,1)', [ids.entB, tag + 'B产品', 'PDB' + stamp])

  const mkBatch = async (eid, pid, fileName) => (await db.execute('INSERT INTO upload_batch (enterprise_id, file_name, product_id, created_by) VALUES (?,?,?,NULL)', [eid, fileName, pid]))[0].insertId
  ids.stocked = await mkBatch(ids.entA, prod.insertId, '生成入库 2026-10-10 10:00')
  ids.uploaded = await mkBatch(ids.entA, prod.insertId, '生产采集上传_2026-10-10.xlsx')
  ids.otherEnt = await mkBatch(ids.entB, prodB.insertId, '生成入库 2026-10-10 11:00')
  ids.emptyStocked = await mkBatch(ids.entA, prod.insertId, '生成入库 2026-10-10 12:00')

  const stockedCodes = [codeOf(1), codeOf(2), codeOf(3), codeOf(4), codeOf(5)]
  const rows = stockedCodes.map((c, i) => [ids.entA, c, prod.insertId, ids.stocked, i === 4 ? 2 : 1, 0])
  await db.query('INSERT INTO trace_code (enterprise_id, code, product_id, upload_batch_id, status, abnormal_flag) VALUES ?', [rows])
  await db.query('INSERT INTO trace_code (enterprise_id, code, product_id, upload_batch_id, status, abnormal_flag) VALUES ?', [[[ids.entA, codeOf(11), prod.insertId, ids.uploaded, 1, 0]]])
  await db.query('INSERT INTO trace_code (enterprise_id, code, product_id, upload_batch_id, status, abnormal_flag) VALUES ?', [[[ids.entB, codeOf(21), prodB.insertId, ids.otherEnt, 1, 0]]])

  const [u] = await db.execute('INSERT INTO `user` (username,password,name,role,enterprise_id,status) VALUES (?,?,?,?,?,1)', [tag + '_ea', hash, '导出验收', 'enterprise_admin', ids.entA])
  ids.user = u.insertId
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: tag + '_ea', password }) })
  assert.equal(login.status, 200, '夹具账号登录失败')
  sessions.ea = (login.headers.get('set-cookie') || '').split(';')[0]
  sessions.anon = ''

  const url = (id, fmt) => '/api/admin/codes/upload-batches/' + id + '/export' + (fmt ? '?format=' + fmt : '')

  await check('匿名访问导出接口 401', async () => {
    const r = await fetch(base + url(ids.stocked, 'txt'), { signal: AbortSignal.timeout(30000) })
    assert.equal(r.status, 401)
    await r.text()
  })

  await check('非「生成入库」批次拒绝导出（403）', async () => {
    const r = await api(url(ids.uploaded, 'txt'))
    assert.equal(r.status, 403)
    assert.match(String(r.data?.statusMessage || ''), /生成入库/)
  })

  await check('跨企业批次不可导出（404，企业隔离）', async () => {
    assert.equal((await api(url(ids.otherEnt, 'txt'))).status, 404)
  })

  await check('非法格式 400；空留档批次 400', async () => {
    assert.equal((await api(url(ids.stocked, 'pdf'))).status, 400)
    assert.equal((await api(url(ids.emptyStocked, 'txt'))).status, 400)
  })

  await check('txt：条数与码值顺序正确、带 UTF-8 BOM', async () => {
    // 注意：fetch 的 res.text() 依 WHATWG 规范会剥掉 BOM，验证 BOM 必须看原始字节
    const r = await fetch(base + url(ids.stocked, 'txt'), { headers: { cookie: sessions.ea }, signal: AbortSignal.timeout(30000) })
    assert.equal(r.status, 200)
    const buf = Buffer.from(await r.arrayBuffer())
    assert.deepEqual([...buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF], '应带 UTF-8 BOM（与生成页导出一致）')
    const lines = buf.subarray(3).toString('utf8').split('\n').filter(Boolean)
    assert.equal(lines.length, 5)
    assert.deepEqual(lines, stockedCodes)
    assert.ok(lines.every((l) => l.length === 32), '每行应为 32 位追溯码')
    assert.match(String(r.headers.get('content-type')), /text\/plain/)
  })

  await check('urls：每行为「扫码前缀 + 码」，前缀一致', async () => {
    const r = await raw(url(ids.stocked, 'urls'))
    assert.equal(r.status, 200)
    const lines = r.text.replace(/^\uFEFF/, '').split('\n').filter(Boolean)
    assert.equal(lines.length, 5)
    const prefix = lines[0].slice(0, lines[0].length - 32)
    assert.ok(prefix.length > 0, '应包含扫码地址前缀')
    for (let i = 0; i < lines.length; i++) assert.equal(lines[i], prefix + stockedCodes[i])
    assert.match(prefix, /^https?:\/\//)
  })

  await check('csv：表头正确、含分段与绑定状态、含中文生产类型', async () => {
    const r = await raw(url(ids.stocked, 'csv'))
    assert.equal(r.status, 200)
    assert.match(String(r.headers.get('content-type')), /text\/csv/)
    const lines = r.text.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean)
    assert.equal(lines.length, 1 + 5, '表头 1 行 + 数据 5 行')
    assert.equal(lines[0], 'sn,农药名称,登记证号,生产企业,生产类型,规格码,生成时间,绑定状态,登记类别,登记证后6位,自定义段')
    assert.equal(lines[1].split(',')[0], stockedCodes[0])
    assert.match(lines[1], /持有人生产/, '生产类型应由码第 8 位推得')
    assert.ok(lines[1].includes(',"001",'), '规格码列应取码第 9-11 位')
    assert.equal(lines.filter((l) => l.includes('未绑定')).length, 4)
    assert.equal(lines.filter((l) => l.includes('已绑定')).length, 1)
    assert.ok(lines[1].includes(',9,000001,'), '登记类别与登记证后 6 位应由码分段推得')
  })

  await check('Content-Disposition 提供 RFC5987 中文文件名', async () => {
    const r = await raw(url(ids.stocked, 'txt'))
    const cd = String(r.headers.get('content-disposition') || '')
    assert.match(cd, /attachment/)
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i)
    assert.ok(m, '应带 filename*=UTF-8\'\' 编码文件名')
    const name = decodeURIComponent(m[1])
    assert.match(name, new RegExp('^' + ids.entA + '_'))
    assert.match(name, /\.txt$/)
    assert.ok(name.includes(tag + '产品'), '文件名应含产品名')
  })

  await check('导出写入审计日志（模块=码库管理 / 动作=导出留档码）', async () => {
    const [all] = await db.query("SELECT content FROM operation_log WHERE action = '导出留档码' AND user_id = ?", [ids.user])
    assert.ok(all.length >= 1, '应至少记录一条导出审计（实际 ' + all.length + '）')
    assert.ok(all.some((l) => String(l.content || '').includes(String(ids.stocked))), '日志应含被导出的批次ID')
  })

  success = true
} finally {
  mkdirSync('logs', { recursive: true })
  try { await cleanup() } finally {
    await db.end()
    console.log('通过：' + results.length + ' 项' + (success ? '' : '（存在失败）'))
  }
}
