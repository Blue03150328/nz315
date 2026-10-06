// 厂家完整业务验收：只允许本机，独立产品与规格，清理后比对原有数据指纹。
import mysql from 'mysql2/promise'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'

if (process.env.NZ315_MANUFACTURER_LIVE !== '1') {
  console.log('默认跳过；本机验收设置 NZ315_MANUFACTURER_LIVE=1，使用 --setup / --run / --cleanup')
  process.exit(0)
}
const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]
}))
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(env.DB_HOST), '仅允许本机数据库')
const base = 'http://localhost:3100'
const dir = 'logs/manufacturer-2026-10-06'
mkdirSync(dir, { recursive: true })
const manifestPath = dir + '/manifest.json'
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true })
let cookie = ''
let state
const results = []
const tables = ['enterprise', 'product_spec', 'product', 'product_original', 'batch', 'trace_code', 'upload_batch', 'scan_log', 'risk_alert', 'message']
async function fingerprints() {
  const out = {}
  for (const table of tables) {
    const [rows] = await db.query('SELECT * FROM `' + table + '` ORDER BY id')
    out[table] = { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }
  }
  return out
}
async function request(path, body, method = body ? 'POST' : 'GET', auth = cookie) {
  const r = await fetch(base + path, { signal: AbortSignal.timeout(30000), method, headers: { cookie: auth, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text(); let data
  try { data = JSON.parse(text) } catch { data = text.slice(0, 500) }
  return { status: r.status, data }
}
async function good(path, body, method) {
  const r = await request(path, body, method)
  assert.equal(r.status, 200, path + ': ' + JSON.stringify(r.data)); return r.data
}
async function login(username) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'admin123' }) })
  assert.equal(r.status, 200, '登录' + username)
  return r.headers.get('set-cookie').split(';')[0]
}
function save() { writeFileSync(manifestPath, JSON.stringify(state, null, 2)) }
async function check(name, fn) {
  try { const evidence = await fn(); results.push({ name, pass: true, evidence }); console.log('PASS ' + name) }
  catch (e) { results.push({ name, pass: false, evidence: e.message }); console.log('FAIL ' + name + ': ' + e.message) }
  writeFileSync(dir + '/results.json', JSON.stringify(results, null, 2))
}
const codesPath = '/api/admin/codes'
const ubPath = id => codesPath + '/upload-batches/' + id
const trace = code => good('/api/trace?code=' + code)
const gen = quantity => good(codesPath + '/generate', { productId: state.productId, quantity })
const importBody = (codes, suffix = 'import') => ({ codes, productId: state.productId, batchNo: state.tag + '_' + suffix, produceDate: '2026-10-05', qualityCertNo: state.tag + '_qc', expireDate: '2028-10-05', fileName: state.tag + '_' + suffix + '.txt' })
const rows = async () => (await db.query('SELECT * FROM trace_code WHERE product_id=? ORDER BY id', [state.productId]))[0]
try {
  cookie = await login('lvfeng')
  if (process.argv.includes('--setup')) {
    if (existsSync(manifestPath)) {
      const previous = JSON.parse(readFileSync(manifestPath, 'utf8'))
      assert.equal(previous.cleanup?.matches, true, '已有未清理测试清单，禁止覆盖')
      assert.match(previous.tag, /^__厂家全流程_\d+$/)
      renameSync(manifestPath, dir + '/manifest-' + previous.tag.slice('__厂家全流程_'.length) + '-cleaned.json')
    }
    const me = await good('/api/auth/me')
    state = { tag: '__厂家全流程_' + Date.now(), enterpriseId: me.user.enterprise_id, baseline: await fingerprints(), results: [] }
    state.baselineMessageIds = (await db.query('SELECT id FROM message'))[0].map(r => Number(r.id))
    save()
    const spec = await good('/api/admin/specs', { specName: state.tag + '_100毫升瓶', netContent: 100, contentUnit: '毫升', packUnit: '瓶' })
    state.specId = spec.id; state.specCode = spec.specCode; save()
    const [[reg]] = await db.query("SELECT r.* FROM pesticide_reg r WHERE r.expire_date > '2028-10-05' AND r.registration_no REGEXP '^PD[0-9]{8}$' AND NOT EXISTS (SELECT 1 FROM product p WHERE p.registration_no=r.registration_no OR RIGHT(p.registration_no,6)=RIGHT(r.registration_no,6)) ORDER BY r.id LIMIT 1")
    assert.ok(reg)
    state.productBody = { name: state.tag, registrationNo: reg.registration_no, registrationExpire: reg.expire_date, specId: state.specId, holderName: reg.company, produceType: 2, regCategory: 1, dosage: reg.dosage, content: reg.content, toxicity: reg.toxicity, category: reg.category || '杀虫剂', originals: [{ regNo: reg.registration_no, company: reg.company, ingredient: reg.ingredient_main }] }
    const p = await good('/api/admin/products', state.productBody)
    state.productId = p.id; save()
    console.log(JSON.stringify({ tag: state.tag, productId: p.id, specId: spec.id, specCode: spec.specCode, registrationNo: reg.registration_no }))
  } else {
    state = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert.match(state.tag, /^__厂家全流程_\d+$/)
    if (process.argv.includes('--run')) {
      await check('新建规格自动分配三位码', async () => assert.match(state.specCode, /^\d{3}$/))
      await check('重复规格名称拒绝', async () => assert.equal((await request('/api/admin/specs', { specName: state.tag + '_100毫升瓶', contentUnit: '毫升', packUnit: '瓶' })).status, 400))
      await check('重复产品登记证拒绝', async () => assert.equal((await request('/api/admin/products', state.productBody)).status, 400))
      await check('厂家无法豁免虚假登记证', async () => assert.equal((await request('/api/admin/products', { ...state.productBody, registrationNo: 'PD99999999', regExempt: true })).status, 400))
      let generated
      await check('生成100码且32位头和MD5校验位正确', async () => {
        generated = await gen(100); state.generatedCodes = generated.allCodes; save()
        assert.equal(generated.quantity, 100); assert.equal(new Set(generated.allCodes).size, 100)
        const head = '1' + state.productBody.registrationNo.slice(-6) + '2' + state.specCode
        for (const code of generated.allCodes) {
          assert.match(code, /^\d{32}$/); assert.ok(code.startsWith(head))
          const expected = String(parseInt(createHash('md5').update(code.slice(0, 30)).digest('hex').slice(-4), 16) % 100).padStart(2, '0')
          assert.equal(code.slice(30), expected)
        }
        return { count: 100, head }
      })
      await check('仅生成不写入码库', async () => assert.ok((await rows()).every(r => !state.generatedCodes.includes(r.code))))
      for (const quantity of [0, -1, 1.5, 500001]) await check('生成数量边界拒绝 ' + quantity, async () => assert.equal((await request(codesPath + '/generate', { productId: state.productId, quantity })).status, 400))
      let stock
      await check('生成码入库留档100条且未绑定', async () => {
        stock = await good(codesPath + '/stock-in', { codes: generated.allCodes, productId: state.productId }); state.stockId = stock.uploadBatchId; save()
        assert.equal(stock.imported, 100); assert.ok((await rows()).filter(r => generated.allCodes.includes(r.code)).every(r => r.status === 1 && r.batch_id === null)); return stock
      })
      await check('未绑定扫码展示产品且不改码状态', async () => {
        const r = await trace(generated.allCodes[0]); assert.equal(r.status, 'generated'); assert.equal(r.resultType, 'genuine'); assert.equal(r.product.name, state.tag); assert.equal(r.batch, null)
        assert.equal((await rows()).find(r => r.code === generated.allCodes[0]).status, 1); return { status: r.status, queryCount: r.queryCount }
      })
      await check('全部重复留档零新增且不建空记录', async () => {
        const before = (await db.query('SELECT COUNT(*) c FROM upload_batch WHERE product_id=?', [state.productId]))[0][0].c
        const r = await good(codesPath + '/stock-in', { codes: generated.allCodes, productId: state.productId })
        assert.equal(r.imported, 0); assert.equal(r.duplicateDatabase, 100); assert.equal(r.uploadBatchId, null)
        assert.equal((await db.query('SELECT COUNT(*) c FROM upload_batch WHERE product_id=?', [state.productId]))[0][0].c, before)
      })
      await check('留档输入内部重复码应去重而非整批500', async () => {
        const g = await gen(1); const r = await request(codesPath + '/stock-in', { codes: [g.allCodes[0], g.allCodes[0]], productId: state.productId })
        assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.data.imported, 1); assert.equal(r.data.skippedDup, 1)
      })
      await check('留档后新建生产批次绑定100条', async () => {
        const r = await good(ubPath(stock.uploadBatchId) + '/correct', { batchNo: state.tag + '_stock', produceDate: '2026-10-05', qualityCertNo: state.tag + '_qc', expireDate: '2028-10-05' })
        state.stockBatchId = r.batchId; save(); assert.equal(r.rebound, 100); return r
      })
      await check('绑定扫码三要素及原药完整', async () => {
        const r = await trace(generated.allCodes[1]); assert.equal(r.status, 'bound'); assert.equal(r.batch.batchNo, state.tag + '_stock'); assert.equal(r.batch.produceDate, '2026-10-05'); assert.equal(r.batch.qualityCertNo, state.tag + '_qc'); assert.equal(r.product.originals.length, 1)
      })
      await check('已绑定单码与整批删除被拦截', async () => {
        const code = (await rows()).find(r => r.code === generated.allCodes[1]); assert.equal((await request(codesPath + '/' + code.id, undefined, 'DELETE')).status, 400); assert.equal((await request(ubPath(stock.uploadBatchId), undefined, 'DELETE')).status, 400)
      })
      let external
      await check('外部TXT/URL/CSV混合输入清洗校验', async () => {
        external = (await gen(10)).allCodes; state.externalCodes = external; save()
        const content = '\uFEFFsn,农药名称\r\n' + external[0] + '\r\nhttps://www.nz315.cn/trace?code=' + external[1] + '\r\n' + external[2] + ',测试\r\n' + external[0] + '\r\nabc\r\n'
        state.externalContent = content; save(); const p = await good(codesPath + '/parse', { content }); assert.equal(p.validCount, 3); assert.equal(p.invalidCount, 2); return { total: p.total, valid: p.validCount, reasons: p.reasonCount }
      })
      let imported
      await check('外部上传部分成功并自动建批', async () => {
        imported = await good(codesPath + '/import', { ...importBody([], 'external'), content: state.externalContent }); assert.equal(imported.imported, 3); assert.equal(imported.skippedDup, 1); assert.equal(imported.skippedInvalid, 1); state.externalBatchId = imported.batchId; save(); return imported
      })
      await check('补采复用生产批次但保留独立上传记录', async () => {
        const r = await good(codesPath + '/import', importBody(external.slice(3, 5), 'external')); assert.equal(r.batchId, imported.batchId); assert.equal(r.batchCreated, false); assert.notEqual(r.uploadBatchId, imported.uploadBatchId); return r
      })
      await check('同批次三要素冲突回滚且不留码', async () => {
        const r = await good(codesPath + '/import', { ...importBody([external[5]], 'external'), qualityCertNo: '冲突证号' }); assert.equal(r.ok, false); assert.equal(r.notWritten, 1); assert.ok(!(await rows()).some(x => x.code === external[5])); return r
      })
      await check('全部坏码不创建空批次', async () => {
        const r = await good(codesPath + '/import', importBody(['abc', 'wrong'], 'bad')); assert.equal(r.imported, 0); assert.equal(r.uploadBatchId, null)
        const [[b]] = await db.query('SELECT COUNT(*) c FROM batch WHERE product_id=? AND batch_no=?', [state.productId, state.tag + '_bad']); assert.equal(b.c, 0)
      })
      await check('上传完成消息仅一次且可标记已读', async () => {
        const [messages] = await db.query('SELECT * FROM message WHERE link=?', ['/admin/codes?uploadBatchId=' + imported.uploadBatchId]); assert.equal(messages.length, 1)
        await good('/api/admin/messages/' + messages[0].id, { isRead: 1 }, 'PATCH')
      })
      await check('已生成未绑定码允许删除且只影响一条', async () => {
        const g = await gen(2); const s = await good(codesPath + '/stock-in', { productId: state.productId, codes: g.allCodes }); const r = (await rows()).find(x => x.code === g.allCodes[0]); await good(codesPath + '/' + r.id, undefined, 'DELETE'); assert.ok((await rows()).some(x => x.code === g.allCodes[1])); await good(ubPath(s.uploadBatchId), undefined, 'DELETE')
      })
      const first = (await rows()).find(r => r.code === generated.allCodes[2])
      await check('单码生产日期纠错不影响同批其他码', async () => {
        await good(codesPath + '/' + first.id + '/correct', { produceDate: '2026-10-04' }); assert.equal((await trace(first.code)).batch.produceDate, '2026-10-04'); assert.equal((await trace(generated.allCodes[3])).batch.produceDate, '2026-10-05')
      })
      await check('单码过期纠错后扫码必须提示过期', async () => {
        await good(codesPath + '/' + first.id + '/correct', { expireDate: '2020-01-01' }); const r = await trace(first.code); assert.equal(r.batch.expireDate, '2020-01-01'); assert.equal(r.resultType, 'expired', JSON.stringify({ resultType: r.resultType, displayedExpiry: r.batch.expireDate }))
      })
      await check('整批只修改生产日期应保留原有效期', async () => {
        await good(ubPath(stock.uploadBatchId) + '/correct', { produceDate: '2026-10-04' }); const [[b]] = await db.query('SELECT expire_date FROM batch WHERE id=?', [state.stockBatchId]); assert.equal(b.expire_date, '2028-10-05', '未填有效期却被改成生产日期'); return b
      })
      await check('文件改日期保留单码有效期覆盖，生产批次保持原值', async () => {
        assert.equal((await trace(first.code)).batch.expireDate, '2020-01-01')
        assert.equal((await trace(generated.allCodes[3])).batch.expireDate, '2028-10-05')
        const [[b]] = await db.query('SELECT produce_date FROM batch WHERE id=?', [state.stockBatchId]); assert.equal(b.produce_date, '2026-10-05')
      })
      await check('生产批次只改生产日期保留各码有效期修正', async () => {
        await good('/api/admin/batches/' + state.stockBatchId, { produceDate: '2026-10-03' }, 'PATCH')
        assert.equal((await trace(first.code)).batch.expireDate, '2020-01-01')
        assert.equal((await trace(generated.allCodes[3])).batch.expireDate, '2028-10-05')
      })
      await check('选中码仅修改证号，日期和范围外码保持原值', async () => {
        const target = (await rows()).find(r => r.code === generated.allCodes[3])
        const before = await trace(target.code); const outside = await trace(generated.allCodes[4])
        await good(codesPath + '/batch-correct', { ids: [target.id], qualityCertNo: state.tag + '_selected' })
        const after = await trace(target.code)
        assert.equal(after.batch.produceDate, before.batch.produceDate); assert.equal(after.batch.expireDate, before.batch.expireDate)
        assert.deepEqual((await trace(generated.allCodes[4])).batch, outside.batch)
        const [[u]] = await db.query('SELECT quality_cert_no FROM upload_batch WHERE id=?', [stock.uploadBatchId]); assert.equal(u.quality_cert_no, null)
      })
      await check('非法日期拒绝且未部分修改', async () => {
        const before = await rows()
        assert.equal((await request(codesPath + '/batch-correct', { ids: [first.id], produceDate: '2026-02-30', qualityCertNo: '不得写入' })).status, 400)
        assert.deepEqual(await rows(), before)
      })
      await check('同一生产批次的另一上传文件不受文件修正影响', async () => {
        const all = await rows(); const a = all.find(r => r.code === external[0]); const b = all.find(r => r.code === external[3])
        const outside = await trace(b.code)
        await good(ubPath(a.upload_batch_id) + '/correct', { produceDate: '2026-10-02' })
        assert.equal((await trace(a.code)).batch.produceDate, '2026-10-02'); assert.deepEqual((await trace(b.code)).batch, outside.batch)
        const [[batch]] = await db.query('SELECT produce_date FROM batch WHERE id=?', [state.externalBatchId]); assert.equal(batch.produce_date, '2026-10-05')
      })
      // 恢复独立测试批次，便于后面的冻结与恢复断言。
      await good(ubPath(stock.uploadBatchId) + '/correct', { produceDate: '2026-10-05', expireDate: '2028-10-05' })
      await good(codesPath + '/' + first.id + '/correct', { expireDate: '2028-10-05' })
      await check('整批冻结且扫码冻结', async () => { await good(ubPath(stock.uploadBatchId) + '/flag', { flag: 1, reason: state.tag }); assert.equal((await trace(first.code)).resultType, 'frozen') })
      await check('冻结整批拒绝修正', async () => assert.equal((await request(ubPath(stock.uploadBatchId) + '/correct', { produceDate: '2026-10-04' })).status, 400))
      await check('冻结码拒绝绑定已有生产批次', async () => assert.equal((await request(codesPath + '/' + first.id + '/correct', { batchId: state.stockBatchId })).status, 400))
      await check('冻结恢复后扫码正常', async () => { await good(ubPath(stock.uploadBatchId) + '/flag', { flag: 0 }); assert.equal((await trace(first.code)).resultType, 'genuine') })
      await check('作废必须原因', async () => assert.equal((await request(codesPath + '/' + first.id, { flag: 2 }, 'PATCH')).status, 400))
      await check('作废扫码不泄露产品和批次', async () => { await good(codesPath + '/' + first.id, { flag: 2, reason: state.tag }, 'PATCH'); const r = await trace(first.code); assert.equal(r.resultType, 'voided'); assert.ok(!r.product && !r.batch) })
      await check('作废终态不能恢复或修正', async () => { assert.equal((await request(codesPath + '/' + first.id, { flag: 0 }, 'PATCH')).status, 400); assert.equal((await request(codesPath + '/' + first.id + '/correct', { qualityCertNo: '其他' })).status, 400) })
      await check('同地多次扫码不误报重复查询', async () => { for (let i = 0; i < 3; i++) assert.equal((await trace(generated.allCodes[4])).resultType, 'genuine') })
      await check('跨省重复查询触发且预警合并', async () => {
        await db.query('INSERT INTO scan_log (enterprise_id,code,product_id,scan_time,scan_device,scan_subject,province,city) VALUES (?,?,?,NOW(),?,1,?,?),(?,?,?,NOW(),?,1,?,?)', [state.enterpriseId, generated.allCodes[5], state.productId, '测试', '山东省', '济南市', state.enterpriseId, generated.allCodes[5], state.productId, '测试', '河南省', '郑州市'])
        assert.equal((await trace(generated.allCodes[5])).resultType, 'repeat'); await trace(generated.allCodes[5])
        const [a] = await db.query('SELECT * FROM risk_alert WHERE product_id=? AND alert_type=1', [state.productId]); assert.equal(a.length, 1); assert.ok(a[0].repeat_count >= 2); state.repeatAlertId = a[0].id; save(); return { alertId: a[0].id, repeatCount: a[0].repeat_count }
      })
      await check('预警核实合规可处理', async () => { await good('/api/admin/alerts/' + state.repeatAlertId, { status: 1 }, 'PATCH'); const [[a]] = await db.query('SELECT handle_status FROM risk_alert WHERE id=?', [state.repeatAlertId]); assert.equal(a.handle_status, 1) })
      await check('扫码明细与数据库次数一致', async () => { const r = await good('/api/admin/statistics?keyword=' + generated.allCodes[5]); const [[n]] = await db.query('SELECT COUNT(*) c FROM scan_log WHERE code=?', [generated.allCodes[5]]); assert.equal(r.detail.total, n.c) })
      await check('质量不合格生产批次拒绝补采', async () => {
        await good('/api/admin/batches/' + state.externalBatchId, { batchNo: state.tag + '_external', produceDate: '2026-10-05', qualityCertNo: state.tag + '_qc', expireDate: '2028-10-05', qcResult: 0 }, 'PATCH')
        const r = await good(codesPath + '/import', importBody([external[6]], 'external')); assert.equal(r.ok, false); assert.equal(r.imported, 0)
      })
      await check('质量不合格生产批次拒绝单码重新绑定', async () => {
        const target = (await rows()).find(r => r.code === generated.allCodes[7])
        assert.equal((await request(codesPath + '/' + target.id + '/correct', { batchId: state.externalBatchId })).status, 400)
      })
      await check('不合格批次在选中码和文件绑定也拒绝伪造合格参数', async () => {
        const g = await gen(2); const s = await good(codesPath + '/stock-in', { codes: g.allCodes, productId: state.productId })
        const all = await rows(); const ids = g.allCodes.map(code => all.find(r => r.code === code).id)
        for (const [path, body] of [[codesPath + '/batch-correct', { ids, batchId: state.externalBatchId, qcResult: 1 }], [ubPath(s.uploadBatchId) + '/correct', { batchId: state.externalBatchId, qcResult: 1 }]]) assert.equal((await request(path, body)).status, 400)
        assert.ok((await rows()).filter(r => ids.includes(r.id)).every(r => r.status === 1 && r.batch_id === null))
      })
      await check('过期登记证允许外部导入绑定且扫码提示', async () => {
        await db.query('UPDATE product SET registration_expire=? WHERE id=?', ['2020-01-01', state.productId])
        const r = await good(codesPath + '/import', importBody([external[7]], 'expiredreg')); assert.equal(r.ok, true); assert.equal(r.imported, 1)
        assert.equal((await trace(external[7])).resultType, 'reg-expired')
      })
      await check('过期登记证扫码给出明确提示', async () => assert.equal((await trace(generated.allCodes[6])).resultType, 'reg-expired'))
      await check('过期登记证文件新绑定及单码批量绑定统一放行', async () => {
        const g = await gen(3); const s = await good(codesPath + '/stock-in', { codes: g.allCodes, productId: state.productId })
        const bound = await good(ubPath(s.uploadBatchId) + '/correct', { batchNo: state.tag + '_expiredstock', produceDate: '2026-10-05' }); assert.equal(bound.rebound, 3)
        assert.equal((await trace(g.allCodes[0])).resultType, 'reg-expired')
        const next = await gen(2); await good(codesPath + '/stock-in', { codes: next.allCodes, productId: state.productId })
        const all = await rows(); const ids = next.allCodes.map(code => all.find(r => r.code === code).id)
        assert.equal((await good(codesPath + '/' + ids[0] + '/correct', { batchId: bound.batchId })).rebound, 1)
        assert.equal((await good(codesPath + '/batch-correct', { ids: [ids[1]], batchId: bound.batchId })).rebound, 1)
        for (const code of next.allCodes) assert.equal((await trace(code)).resultType, 'reg-expired')
      })
      await db.query('UPDATE product SET registration_expire=? WHERE id=?', [state.productBody.registrationExpire, state.productId])
      await check('码头生产类型必须与关联产品一致', async () => {
        const bad = external[8].slice(0, 7) + '3' + external[8].slice(8); const r = await good(codesPath + '/import', importBody([bad], 'wrongtype')); assert.equal(r.imported, 0, JSON.stringify(r))
      })
      await check('码头规格必须与关联产品规格一致', async () => {
        const [[s]] = await db.query('SELECT spec_code FROM product_spec WHERE enterprise_id=? AND id<>? AND status=1 LIMIT 1', [state.enterpriseId, state.specId]); assert.ok(s)
        const bad = external[9].slice(0, 8) + s.spec_code + external[9].slice(11); const r = await good(codesPath + '/import', importBody([bad], 'wrongspec')); assert.equal(r.imported, 0, JSON.stringify(r))
      })
      await check('完整头部预览提交一致，错误行拒绝且外部尾部原样保留', async () => {
        const head = generated.allCodes[0].slice(0, 11); const valid = head + '9'.repeat(21)
        const bad = ['2' + valid.slice(1), valid.slice(0, 7) + '3' + valid.slice(8), valid.slice(0, 8) + '999' + valid.slice(11), valid.slice(0, 1) + '999999' + valid.slice(7)]
        const p = await good(codesPath + '/parse', { codes: [valid, ...bad], productId: state.productId })
        assert.equal(p.validCount, 1); assert.equal(p.invalidCount, 4)
        const s = await good(codesPath + '/stock-in', { codes: [valid, ...bad], productId: state.productId })
        assert.equal(s.imported, 1); assert.equal(s.skippedInvalid, 4); assert.ok((await rows()).some(r => r.code === valid))
      })
      await check('留档12并发只新增一次且不创建空上传记录', async () => {
        const g = await gen(4); const before = (await db.query('SELECT COUNT(*) c FROM upload_batch WHERE product_id=?', [state.productId]))[0][0].c
        const input = [...g.allCodes, g.allCodes[0]]
        const responses = await Promise.all(Array.from({ length: 12 }, () => good(codesPath + '/stock-in', { codes: input, productId: state.productId })))
        assert.equal(responses.reduce((n, r) => n + r.imported, 0), 4)
        assert.equal(responses.filter(r => r.uploadBatchId).length, 1)
        for (const r of responses) { assert.equal(r.duplicateFile, 1); assert.equal(r.total, r.imported + r.skippedDup + r.skippedInvalid) }
        assert.equal((await db.query('SELECT COUNT(*) c FROM upload_batch WHERE product_id=?', [state.productId]))[0][0].c, before + 1)
        return { requests: 12, inserted: 4 }
      })
      await check('上传12并发只新增一次且仅一条完成通知', async () => {
        const g = await gen(4); const body = importBody([...g.allCodes, g.allCodes[0]], 'concurrent')
        const responses = await Promise.all(Array.from({ length: 12 }, () => good(codesPath + '/import', body)))
        assert.ok(responses.every(r => r.ok)); assert.equal(responses.reduce((n, r) => n + r.imported, 0), 4)
        const success = responses.find(r => r.imported > 0); assert.equal(responses.filter(r => r.uploadBatchId).length, 1)
        assert.equal((await db.query('SELECT COUNT(*) c FROM message WHERE link=?', ['/admin/codes?uploadBatchId=' + success.uploadBatchId]))[0][0].c, 1)
        return { requests: 12, inserted: 4, notifications: 1 }
      })
      await check('冻结混合选择整笔拒绝且正常码不部分修改', async () => {
        const g = await gen(2); await good(codesPath + '/stock-in', { codes: g.allCodes, productId: state.productId })
        const all = await rows(); const ids = g.allCodes.map(code => all.find(r => r.code === code).id)
        await good(codesPath + '/' + ids[0], { flag: 1 }, 'PATCH')
        const before = await rows()
        assert.equal((await request(codesPath + '/batch-correct', { ids, produceDate: '2026-10-04' })).status, 400)
        assert.deepEqual(await rows(), before)
        await good(codesPath + '/' + ids[0], { flag: 0 }, 'PATCH')
      })
      await check('真实数据库插码故障回滚批次及上传记录，留档返回500', async () => {
        const g = await gen(2); const trigger = 'nz315_verify_insert_' + Number(state.productId)
        state.triggers = [trigger]; save()
        const before = await rows(); const count = async table => (await db.query('SELECT COUNT(*) c FROM ' + table + ' WHERE product_id=?', [state.productId]))[0][0].c
        const batches = await count('batch'); const uploads = await count('upload_batch')
        await db.query('CREATE TRIGGER ' + trigger + " BEFORE INSERT ON trace_code FOR EACH ROW BEGIN IF NEW.product_id=" + Number(state.productId) + " THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='验收注入故障'; END IF; END")
        try {
          const stock = await request(codesPath + '/stock-in', { codes: [g.allCodes[0]], productId: state.productId }); assert.equal(stock.status, 500)
          const imported = await good(codesPath + '/import', importBody([g.allCodes[1]], 'dbfault')); assert.equal(imported.ok, false); assert.equal(imported.imported, 0)
          assert.equal(await count('batch'), batches); assert.equal(await count('upload_batch'), uploads); assert.deepEqual(await rows(), before)
        } finally { await db.query('DROP TRIGGER IF EXISTS ' + trigger); state.triggers = []; save() }
      })
      await check('文件快照写入故障后修正码全部回滚', async () => {
        const target = (await rows()).find(r => r.code === generated.allCodes[8]); const before = await rows()
        const trigger = 'nz315_verify_update_' + Number(state.productId); state.triggers = [trigger]; save()
        await db.query('CREATE TRIGGER ' + trigger + " BEFORE UPDATE ON upload_batch FOR EACH ROW BEGIN IF NEW.product_id=" + Number(state.productId) + " THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='验收快照故障'; END IF; END")
        try { assert.equal((await request(codesPath + '/' + target.id + '/correct', { produceDate: '2026-10-01' })).status, 500); assert.deepEqual(await rows(), before) }
        finally { await db.query('DROP TRIGGER IF EXISTS ' + trigger); state.triggers = []; save() }
      })
      await check('代表规模1万条生成留档及重复重试计数正确', async () => {
        const started = performance.now(); const g = await gen(10000); const generatedMs = Math.round(performance.now() - started)
        const writeStart = performance.now(); const r = await good(codesPath + '/stock-in', { codes: g.allCodes, productId: state.productId })
        const writeMs = Math.round(performance.now() - writeStart); assert.equal(r.imported, 10000)
        const retry = await good(codesPath + '/stock-in', { codes: g.allCodes, productId: state.productId }); assert.equal(retry.imported, 0); assert.equal(retry.duplicateDatabase, 10000); assert.equal(retry.uploadBatchId, null)
        return { quantity: 10000, generatedMs, writeMs }
      })
      await check('代表规模1万条文件解析上传绑定及重复重试正确', async () => {
        const g = await gen(10000); const content = g.allCodes.join('\n')
        const parseStart = performance.now()
        const parsed = await good(codesPath + '/parse', { content, productId: state.productId, includeCodes: false })
        const parseMs = Math.round(performance.now() - parseStart)
        assert.equal(parsed.validCount, 10000); assert.equal(parsed.invalidCount, 0)
        const body = { ...importBody([], 'largefile'), content }
        const writeStart = performance.now(); const r = await good(codesPath + '/import', body)
        const writeMs = Math.round(performance.now() - writeStart); assert.equal(r.imported, 10000)
        const importedRows = (await rows()).filter(row => row.upload_batch_id === r.uploadBatchId)
        assert.equal(importedRows.length, 10000); assert.ok(importedRows.every(row => row.status === 2 && row.batch_id === r.batchId))
        const retry = await good(codesPath + '/import', body)
        assert.equal(retry.imported, 0); assert.equal(retry.skippedDup, 10000); assert.equal(retry.uploadBatchId, null)
        return { quantity: 10000, inputBytes: Buffer.byteLength(content), parseMs, writeMs }
      })
      const viewer = await login('viewer'); const operator = await login('codeop')
      await check('只读账号生成/留档/导入/修正/标记全部拒绝', async () => {
        for (const [path, body, method] of [[codesPath + '/generate', { productId: state.productId, quantity: 1 }], [codesPath + '/stock-in', { productId: state.productId, codes: external }], [codesPath + '/import', importBody(external)], [codesPath + '/' + first.id + '/correct', { produceDate: '2026-10-04' }], [codesPath + '/' + first.id, { flag: 1 }, 'PATCH']]) assert.equal((await request(path, body, method || 'POST', viewer)).status, 403)
      })
      await check('码管理员可看本企业不可新增用户', async () => { assert.equal((await request(codesPath + '?productId=' + state.productId, undefined, 'GET', operator)).status, 200); assert.equal((await request('/api/admin/users', {}, 'POST', operator)).status, 403) })
      await check('跨企业伪造产品和上传批次参数无法读写', async () => {
        const [[p]] = await db.query('SELECT id FROM product WHERE enterprise_id<>? LIMIT 1', [state.enterpriseId]); assert.ok(p)
        assert.equal((await request(codesPath + '/generate', { productId: p.id, quantity: 1 })).status, 400)
        assert.equal((await good(codesPath + '?productId=' + p.id)).total, 0)
        assert.equal((await request(codesPath + '/import', { ...importBody(external), productId: p.id })).status, 400)
        const [[u]] = await db.query('SELECT id FROM upload_batch WHERE enterprise_id<>? LIMIT 1', [state.enterpriseId]); assert.ok(u)
        assert.equal((await good(codesPath + '/upload-batches?uploadBatchId=' + u.id)).total, 0)
        assert.equal((await request(ubPath(u.id) + '/flag', { flag: 1 })).status, 404)
      })
      await check('匿名后台写操作拒绝', async () => assert.equal((await request(codesPath + '/generate', { productId: state.productId, quantity: 1 }, 'POST', '')).status, 401))
      await check('不合法码中文提示且不产生码库行', async () => { const r = await trace('abc'); assert.ok(['invalid', 'not-found'].includes(r.resultType)); return { resultType: r.resultType, reasons: r.reasons } })
      console.log(JSON.stringify({ passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, dir }))
      if (results.some(r => !r.pass)) process.exitCode = 1
    }
    if (process.argv.includes('--cleanup')) {
      for (const trigger of state.triggers || []) {
        assert.match(trigger, /^nz315_verify_(insert|update)_\d+$/)
        await db.query('DROP TRIGGER IF EXISTS ' + trigger)
      }
      await db.beginTransaction()
      if (state.productId) {
        const [uploads] = await db.query('SELECT id FROM upload_batch WHERE product_id=?', [state.productId])
        for (const u of uploads) await db.query('DELETE FROM message WHERE link=?', ['/admin/codes?uploadBatchId=' + u.id])
        // 风险消息没有产品关联，必须按本轮新建ID和本企业收口；原有消息不在清理范围。
        if (state.baselineMessageIds) {
          const [notifications] = await db.query("SELECT id FROM message WHERE enterprise_id=? AND type='risk' AND title IN ('风险预警：重复查询码','风险预警：登记证已过期')", [state.enterpriseId])
          for (const n of notifications) if (!state.baselineMessageIds.includes(Number(n.id))) await db.query('DELETE FROM message WHERE id=?', [n.id])
        }
        await db.query('DELETE FROM message WHERE content LIKE ? OR title LIKE ?', ['%' + state.tag + '%', '%' + state.tag + '%'])
        await db.query('DELETE FROM risk_alert WHERE product_id=?', [state.productId])
        await db.query('DELETE FROM scan_log WHERE product_id=?', [state.productId])
        await db.query('DELETE FROM trace_code WHERE product_id=?', [state.productId])
        await db.query('DELETE FROM upload_batch WHERE product_id=?', [state.productId])
        await db.query('DELETE FROM batch WHERE product_id=?', [state.productId])
        await db.query('DELETE FROM product_original WHERE product_id=?', [state.productId])
        await db.query('DELETE FROM product WHERE id=? AND name=?', [state.productId, state.tag])
      }
      if (state.specId) await db.query('DELETE FROM product_spec WHERE id=? AND spec_name=?', [state.specId, state.tag + '_100毫升瓶'])
      await db.commit()
      const after = await fingerprints(); state.cleanup = { after, matches: JSON.stringify(after) === JSON.stringify(state.baseline) }; save()
      console.log(JSON.stringify(state.cleanup)); assert.deepEqual(after, state.baseline, '清理后原有数据行数与内容应完全相等，正常操作审计保留')
    }
  }
} finally { await db.end() }
