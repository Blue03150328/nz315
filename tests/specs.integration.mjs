// 规格业务真实接口验收：只允许本机，独立企业/账号，清理后核对原业务数据。
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomBytes, createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'
import XLSX from 'xlsx'

if (process.env.NZ315_SPECS_LIVE !== '1') { console.log('默认跳过；本机设置NZ315_SPECS_LIVE=1后运行'); process.exit(0) }
const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => {
  const at = line.indexOf('=')
  return [line.slice(0, at), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')]
}))
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST), '仅允许本机数据库')
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true })
const base = 'http://127.0.0.1:3100'
const tag = '__specs_' + Date.now()
const password = randomBytes(20).toString('hex')
const userIds = []
const enterpriseIds = []
const results = []
const tables = ['enterprise', 'user', 'product_spec', 'product', 'product_original', 'trace_code', 'batch', 'upload_batch', 'message', 'risk_alert', 'scan_log']
const body = { specName: '500毫升/瓶×10', netContent: 500, contentUnit: '毫升', packUnit: '瓶', packQuantity: 10, specCode: '001' }
const fingerprint = async () => {
  const result = {}
  for (const table of tables) {
    const [rows] = await db.query('SELECT * FROM `' + table + '` ORDER BY id')
    result[table] = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  }
  return result
}
const baseline = await fingerprint()
async function request(path, cookie = '', data, method = data === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(30000) })
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }
}
async function check(name, action) { await action(); results.push({ name, pass: true }); console.log('PASS ' + name) }
async function importRows(cookie, values, enterpriseId) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['规格'], ...values.map(value => [value])]), '规格')
  const form = new FormData()
  form.append('file', new Blob([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })]), '规格.xlsx')
  if (enterpriseId) form.append('enterpriseId', String(enterpriseId))
  const response = await fetch(base + '/api/admin/specs/import', { method: 'POST', headers: { cookie }, body: form, signal: AbortSignal.timeout(30000) })
  return { status: response.status, data: await response.json() }
}
let a, b, viewer, platform
try {
  for (const suffix of ['A', 'B']) {
    const [result] = await db.execute("INSERT INTO enterprise (name,renew_expire,status) VALUES (?,'2035-12-31',1)", [tag + suffix])
    enterpriseIds.push(result.insertId)
  }
  const hash = await bcrypt.hash(password, 10)
  const roles = [['A', 'enterprise_admin', enterpriseIds[0]], ['B', 'enterprise_admin', enterpriseIds[1]], ['viewer', 'viewer', enterpriseIds[0]], ['platform', 'platform_admin', null]]
  const cookies = []
  for (const [suffix, role, enterpriseId] of roles) {
    const username = tag + suffix
    const [result] = await db.execute('INSERT INTO `user` (username,password,name,role,enterprise_id,status) VALUES (?,?,?,?,?,1)', [username, hash, '规格验收', role, enterpriseId])
    userIds.push(result.insertId)
    const login = await request('/api/auth/login', '', { username, password })
    assert.equal(login.status, 200)
    cookies.push(login.cookie)
  }
  ;[a, b, viewer, platform] = cookies
  await check('匿名及只读账号写入被拒绝', async () => {
    assert.equal((await request('/api/admin/specs', '', body)).status, 401)
    assert.equal((await request('/api/admin/specs', viewer, body)).status, 403)
  })
  let specId
  await check('手动选择001，新数量真实落库，伪造归属企业无效', async () => {
    const created = await request('/api/admin/specs', a, { ...body, enterpriseId: enterpriseIds[1] })
    assert.equal(created.status, 200, JSON.stringify(created.data))
    specId = created.data.id
    const [[row]] = await db.query('SELECT * FROM product_spec WHERE id=?', [specId])
    assert.equal(row.enterprise_id, enterpriseIds[0]); assert.equal(row.spec_code, '001'); assert.equal(row.pack_quantity, 10)
  })
  await check('001重复被拒绝，999可选，停用规格仍占用号码', async () => {
    assert.equal((await request('/api/admin/specs', a, { ...body, specName: '同码不同名称' })).status, 409)
    assert.equal((await request('/api/admin/specs', a, { ...body, specName: '边界停用规格', specCode: '999', status: 0 })).status, 200)
    const codes = await request('/api/admin/specs/codes', a)
    assert.deepEqual(codes.data.usedCodes, ['001', '999'])
    assert.equal((await request('/api/admin/specs', a, { ...body, specName: '停用码不可复用', specCode: '999' })).status, 409)
  })
  await check('不同企业可选相同001，总部须指定真实企业', async () => {
    assert.equal((await request('/api/admin/specs', b, body)).status, 200)
    assert.equal((await request('/api/admin/specs', platform, body)).status, 400)
    assert.equal((await request('/api/admin/specs', platform, { ...body, enterpriseId: 2147483647 })).status, 400)
    assert.equal((await request('/api/admin/specs', platform, { ...body, specName: '总部选号', specCode: '002', enterpriseId: enterpriseIds[1] })).status, 200)
    const codes = await request('/api/admin/specs/codes?enterpriseId=' + enterpriseIds[1], a)
    assert.equal(codes.data.enterpriseId, enterpriseIds[0])
  })
  await check('非法规格码与数量在接口写入前拒绝', async () => {
    for (const specCode of ['000', '1000', '1', 1]) assert.equal((await request('/api/admin/specs', a, { ...body, specName: '非法码', specCode })).status, 400)
    for (const packQuantity of [0, -1, 1.5, 1000000, null]) assert.equal((await request('/api/admin/specs', a, { ...body, specName: '非法数量', specCode: '003', packQuantity })).status, 400)
  })
  await check('旧自动调用利用空号002，不因已使用999误判满额', async () => {
    const { specCode: ignored, packQuantity: ignoredQuantity, ...legacy } = body
    const created = await request('/api/admin/specs', a, { ...legacy, specName: '旧调用单件' })
    assert.equal(created.status, 200); assert.equal(created.data.specCode, '002')
    const [[row]] = await db.query('SELECT pack_quantity FROM product_spec WHERE id=?', [created.data.id]); assert.equal(row.pack_quantity, 1)
  })
  await check('8并发抢同一规格码只成功1条', async () => {
    const replies = await Promise.all(Array.from({ length: 8 }, (_, index) => request('/api/admin/specs', a, { ...body, specName: '并发规格' + index, specCode: '010' })))
    assert.equal(replies.filter(reply => reply.status === 200).length, 1)
    assert.equal(replies.filter(reply => reply.status === 409).length, 7)
  })
  await check('编辑数量真实保存，旧编辑省略数量保留原值，改码及越权被拒绝', async () => {
    const changed = { ...body, specName: '500毫升/瓶×15', packQuantity: 15 }
    assert.equal((await request('/api/admin/specs/' + specId, a, changed, 'PATCH')).status, 200)
    const { packQuantity: ignored, ...legacy } = changed
    assert.equal((await request('/api/admin/specs/' + specId, a, legacy, 'PATCH')).status, 200)
    const [[row]] = await db.query('SELECT pack_quantity,spec_code FROM product_spec WHERE id=?', [specId]); assert.equal(row.pack_quantity, 15); assert.equal(row.spec_code, '001')
    assert.equal((await request('/api/admin/specs/' + specId, a, { ...changed, specCode: '050' }, 'PATCH')).status, 400)
    assert.equal((await request('/api/admin/specs/' + specId, b, changed, 'PATCH')).status, 404)
  })
  await check('批量与手动抢空号仍唯一，导入兼容新数量/旧单件/别名去重并固定本企业', async () => {
    const [imported, manual] = await Promise.all([
      importRows(a, ['500ml/瓶✖10', '500毫升/瓶×10', '200毫升/袋', '500ml/瓶×1.5'], enterpriseIds[1]),
      request('/api/admin/specs', a, { ...body, specName: '并发手动003', specCode: '003' }),
    ])
    assert.equal(imported.status, 200, JSON.stringify(imported.data)); assert.equal(imported.data.success, 2); assert.equal(imported.data.failed, 2)
    assert.ok([200, 409].includes(manual.status))
    const [rows] = await db.query('SELECT spec_name,spec_code,pack_quantity FROM product_spec WHERE enterprise_id=?', [enterpriseIds[0]])
    assert.equal(new Set(rows.map(row => row.spec_code)).size, rows.length)
    assert.equal(rows.find(row => row.spec_name === '500毫升/瓶×10').pack_quantity, 10)
    assert.equal(rows.find(row => row.spec_name === '200毫升/袋').pack_quantity, 1)
    const [[other]] = await db.query("SELECT COUNT(*) AS n FROM product_spec WHERE enterprise_id=? AND spec_name='200毫升/袋'", [enterpriseIds[1]]); assert.equal(other.n, 0)
  })
  await check('空闲码不足时整批回滚，999个满额后自动选号拒绝', async () => {
    const [used] = await db.query('SELECT spec_code FROM product_spec WHERE enterprise_id=?', [enterpriseIds[0]])
    const set = new Set(used.map(row => row.spec_code))
    const fillers = Array.from({ length: 999 }, (_, index) => String(index + 1).padStart(3, '0')).filter(code => !set.has(code) && code !== '998')
    for (const code of fillers) await db.execute('INSERT INTO product_spec (enterprise_id,spec_name,spec_code,status) VALUES (?,?,?,1)', [enterpriseIds[0], tag + '_fill_' + code, code])
    const imported = await importRows(a, ['88毫升/瓶×2', '89毫升/瓶×2'])
    assert.equal(imported.status, 400)
    const [[count]] = await db.query('SELECT COUNT(*) AS n FROM product_spec WHERE enterprise_id=?', [enterpriseIds[0]]); assert.equal(count.n, 998)
    assert.equal((await request('/api/admin/specs', a, { ...body, specName: '最后空号', specCode: '998' })).status, 200)
    const { specCode: ignored, ...auto } = body
    assert.equal((await request('/api/admin/specs', a, { ...auto, specName: '满额新规格' })).status, 400)
  })
} finally {
  // 仅删除本脚本创建的企业、账号及关联验收记录，原业务库不覆盖。
  if (enterpriseIds.length) {
    const placeholders = enterpriseIds.map(() => '?').join(',')
    await db.execute('DELETE FROM product_spec WHERE enterprise_id IN (' + placeholders + ')', enterpriseIds)
  }
  if (userIds.length) {
    const placeholders = userIds.map(() => '?').join(',')
    await db.execute('DELETE FROM operation_log WHERE user_id IN (' + placeholders + ')', userIds)
    await db.execute('DELETE FROM `user` WHERE id IN (' + placeholders + ')', userIds)
  }
  for (const id of enterpriseIds) await db.execute('DELETE FROM enterprise WHERE id=? AND name LIKE ?', [id, tag + '%'])
  assert.deepEqual(await fingerprint(), baseline, '验收清理后原业务数据须完全一致')
  results.push({ name: '11张业务表清理后指纹恢复', pass: true })
  mkdirSync('logs', { recursive: true })
  writeFileSync('logs/specs-integration-20261012.json', JSON.stringify(results, null, 2))
  await db.end()
}
