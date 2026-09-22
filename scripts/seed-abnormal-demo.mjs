#!/usr/bin/env node
// 本地「异常场景」测试数据 + 二维码生成器（扫码验收用）
//
// 用途：一键造出 9 张可扫的二维码，覆盖公众端 /trace 的全部异常分支，供真机扫码验收。
//   node scripts/seed-abnormal-demo.mjs                 # 造数据 + 出图（默认局域网地址）
//   node scripts/seed-abnormal-demo.mjs --base http://127.0.0.1:3100
//   node scripts/seed-abnormal-demo.mjs --verify        # 出图后再自证：接口 resultType + 结果页 SSR 文案（推荐）
//   node scripts/seed-abnormal-demo.mjs --clean         # 只清理本脚本造的数据，不出图
//
// 产物（默认 `qr-test/`）：`*.png` 九张码 · `index.html` 总览页（手机对着屏幕扫）· `manifest.json` 机器可读清单
// ⚠️ 要用这些码写别的校验脚本时，**从 manifest.json 取码，不要手抄** —— 32 位数字手抄必错（2026-09-22 已踩）。
//
// 🔴 安全闸（硬性）：**只允许连 127.0.0.1 / localhost 的库**。这不是洁癖：
//    本项目的 `.env` 在部署时指向过服务器库（`DB_PORT` 曾误指 cynx 的 3306 生产库），
//    一旦脚本在真实库上跑，就会往 `trace_code` 核心表插演示码、往 `enterprise` 插演示企业。
//    想改这个限制，请先想清楚——本脚本的定位就是"本机开发库专用"。
//
// 造出来的数据全部带 `【测试】` 前缀 + 独立企业，`--clean` 按企业名/码前缀精确删除，不碰任何既有数据。
//
// ⚠️ 二维码里编码的是 `{base}/trace?code={码}`：
//    - 手机扫（真机验收）→ 用局域网地址，手机与本机同一 Wi-Fi 且防火墙放行 3100
//    - 本机浏览器扫 → 用 127.0.0.1（浏览器只在 HTTPS/localhost 下给网页相机权限）
//    index.html 里两种链接都给，二维码用 `--base` 那一种。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WORKSPACE_MODULES = 'C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules'
/** 依次在项目 node_modules 与隔离工作区里找依赖（qrcode/pngjs 不在项目依赖里，避免污染项目） */
function load(name) {
  try { return require(name) } catch { return require(path.join(WORKSPACE_MODULES, name)) }
}

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d }

const OUT_DIR = path.resolve(opt('--out', 'qr-test'))
const CLEAN_ONLY = has('--clean')
/** --verify：造完数据后打本机 3100 的 /api/trace 自证「每个码真的走预期分支」。
 *  为什么必须有这一步：二维码能扫 ≠ 结果页正确。分支判定全在服务端（abnormal_flag /
 *  批次有效期 / 登记证有效期 / 重复查询统计），只有真打接口才能证明这一串数据串起来是对的。
 *  ⚠️ 会写 scan_log（正常业务行为），重复查询场景靠预置的 3 条跨省记录兜住阈值，多打几次不影响判定。 */
const VERIFY = has('--verify')
const VERIFY_BASE = String(opt('--verify-base', 'http://127.0.0.1:3100')).replace(/\/$/, '')
/** 场景文件 → 期望的 resultType（与 server/api/trace.get.ts 的分支一一对应） */
const EXPECT_TYPE = {
  '1-genuine': 'genuine',
  '2-repeat': 'repeat',
  '3-expired-product': 'expired',
  '4-frozen': 'frozen',
  '5-voided': 'voided',
  '6-expired-reg': 'reg-expired',
  '7-not-found': 'not-found',
  '8-bad-structure': 'not-found',
  '9-external-registry': 'external-reg',
}
/** 场景文件 → 结果页必须出现的文案片段（证明"页面真渲染出来了"，不只是接口返回对）
 *  ⚠️ 为什么必须校验页面：接口 resultType 正确 ≠ 页面正确。而 32 位码**绝不能手抄** ——
 *  2026-09-22 用临时脚本手工敲码做校验时，把第 6 个码的 `990002` 抄成 `990001`，
 *  结果该码在库里查不到、页面渲染成"未查询到"，还因为两个 TraceNotFound 页面恰好等长，
 *  被误读成"服务端结果随请求顺序翻转"。所以校验一律用脚本自己生成的码，不外部硬编码。 */
const PAGE_MARKERS = {
  '1-genuine': ['【测试】30%草甘膦水剂'],
  '2-repeat': ['该追溯码已被查询', '查询地域跨'],
  '3-expired-product': ['该产品已过有效期'],
  '4-frozen': ['该追溯码暂不可用'],
  '5-voided': ['该追溯码已作废'],
  '6-expired-reg': ['登记证 PD20990002 已于 2020-01-01 到期'],
  '7-not-found': ['该追溯码未在追溯系统中登记'],
  '8-bad-structure': ['不符合32位单元识别代码规则'],
  '9-external-registry': ['该码不是农资315签发的', '国家农药登记资料库比对', 'PD20092927'],
}

// ---------- .env ----------
const env = Object.fromEntries(
  fs.readFileSync(path.resolve('.env'), 'utf8')
    .split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const DB_HOST = env.DB_HOST || '127.0.0.1'
const DB_PORT = Number(env.DB_PORT || 3306)
const DB_NAME = env.DB_NAME || 'nz315'

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1']
if (!LOCAL_HOSTS.includes(DB_HOST.toLowerCase())) {
  console.error(`\n🔴 拒绝执行：目标库不是本机（DB_HOST=${DB_HOST}）。`)
  console.error('   本脚本只用于本机开发库造演示数据；跑在真实库上会往 trace_code / enterprise 写入演示记录。')
  process.exit(2)
}

const BASE = String(opt('--base', `http://${lanIPv4()}:3100`)).replace(/\/$/, '')

function lanIPv4() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
  return '127.0.0.1'
}

// ---------- 演示数据定义 ----------
const ENT_NAME = '【测试】异常场景演示企业'
const ENT = {
  name: ENT_NAME,
  credit_code: 'TEST-ABNORMAL-0001',
  contact: '测试联系人',
  phone: '0531-00000000',
  legal_person: '测试',
  license_no: '农药生许（测试）0001',
  qualification_expire: '2030-12-31',
  renew_expire: '2030-12-31',
  status: 1,
}

const SPEC = { spec_name: '【测试】200毫升/瓶', net_content: 200, content_unit: '毫升', pack_unit: '瓶', spec_code: '901' }

// 码结构：第1位类别 + 2-7位登记证后六位 + 第8位生产类型 + 9-11位规格码 + 其余 21 位（本脚本用 15 个 0 + 6 位序号）
const SEQ_LEN = 6
function buildCode(registrationNo, specCode, seq) {
  const last6 = String(registrationNo).replace(/\D/g, '').slice(-6)
  const prefix = '1' + last6 + '1' + specCode
  return prefix + '0'.repeat(32 - prefix.length - SEQ_LEN) + String(seq).padStart(SEQ_LEN, '0')
}

const PRODUCT_OK = {
  name: '【测试】30%草甘膦水剂',
  registration_no: 'PD20990001',
  registration_expire: '2029-12-31',
  ingredient: '草甘膦',
  dosage: '水剂',
  content: '30%',
  toxicity: '低毒',
  category: '除草剂',
  trademark: '测试牌',
  holder_name: ENT_NAME,
}
const PRODUCT_EXPIRED_REG = {
  name: '【测试】40%毒死蜱乳油',
  registration_no: 'PD20990002',
  registration_expire: '2020-01-01',   // 已过期 → 触发「登记证已过期」（8类异常-4）
  ingredient: '毒死蜱',
  dosage: '乳油',
  content: '40%',
  toxicity: '中等毒',
  category: '杀虫剂',
  trademark: '测试牌',
  holder_name: ENT_NAME,
}

const BATCH_OK = { batch_no: 'TEST-20260901', produce_date: '2026-09-01', expire_date: '2029-09-01', quality_cert_no: 'TEST-QC-20260901', qc_result: 1, qc_report_no: 'TEST-RPT-20260901' }
const BATCH_EXPIRED = { batch_no: 'TEST-20200101', produce_date: '2020-01-01', expire_date: '2021-01-01', quality_cert_no: 'TEST-QC-20200101', qc_result: 1, qc_report_no: 'TEST-RPT-20200101' }

const CODE_A = (seq) => buildCode(PRODUCT_OK.registration_no, SPEC.spec_code, seq)
const CODE_B = (seq) => buildCode(PRODUCT_EXPIRED_REG.registration_no, SPEC.spec_code, seq)

/** 场景清单：seq 与库内码一一对应；db=false 表示"码本身不入库"，用于查无此码/外部码 */
const SCENARIOS = [
  { file: '1-genuine', title: '正常（对照组）', expect: '查询结果正常', tone: 'ok', seq: 1,
    note: '完整数据：已绑定批次、登记证有效、码正常。用来对照其它异常页面的差异。' },
  { file: '2-repeat', title: '重复查询（跨 3 省）', expect: '重复查询提示', tone: 'warn', seq: 2, repeat: true,
    note: '预置 3 条跨省扫码记录（山东济南 / 河南郑州 / 广东广州）→ 本码查询次数 ≥3 且跨 ≥2 省即触发。' },
  { file: '3-expired-product', title: '产品已过有效期', expect: '产品已过有效期', tone: 'bad', seq: 3, batch: 'expired',
    note: '批次有效期至 2021-01-01（已过）→ 触发「产品已过有效期」。' },
  { file: '4-frozen', title: '已冻结', expect: '追溯码暂不可用', tone: 'muted', seq: 4, abnormal: 1,
    abnormal_reason: '【测试】印刷模糊，临时冻结' },
  { file: '5-voided', title: '已作废', expect: '追溯码已作废', tone: 'bad', seq: 5, abnormal: 2,
    abnormal_reason: '【测试】疑似假冒，作废处理', note: '作废码按 PRD 不展示产品与批次信息。' },
  { file: '6-expired-reg', title: '登记证已过期', expect: '登记证已过期', tone: 'bad', code: CODE_B(6), product: 'expiredReg',
    note: '登记证有效期至 2020-01-01 → 触发「登记证已过期」，同时会写一条风险预警。' },
  { file: '7-not-found', title: '查无此码（结构合规）', expect: '未查询到该追溯码信息', tone: 'bad', code: '19999991901' + '0'.repeat(15) + '000007', db: false,
    note: '码结构合法，但既不在本平台库、登记证后六位 999999 在登记资料库也没有 → 走 not-found。' },
  { file: '8-bad-structure', title: '编码结构非法', expect: '未查询到该追溯码信息', tone: 'bad', code: '30929279' + '901' + '0'.repeat(15) + '000008', db: false,
    note: '第 1 位=3（应为 1=PD/2=WP）、第 8 位=9（应为 1/2/3）→ 结构卡会判"不符合规则"。' },
  { file: '9-external-registry', title: '外部平台码（登记库命中）', expect: '该码不是农资315签发的', tone: 'warn', code: '10929272000000000000000000000000', db: false,
    note: '别人平台的码：前 8 位 1-092927-2 命中登记库 PD20092927 硝钠·萘乙酸 / 河南欣农化工有限公司。' },
]

// ---------- 建库 ----------
const mysql = load('mysql2/promise')
const conn = await mysql.createConnection({ host: DB_HOST, port: DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: DB_NAME })
const log = (...a) => console.log(...a)

/**
 * 取首行（没有则 null）。
 * ⚠️ 口径坑，项目里已踩过两次：raw mysql2 的 `conn.query()` 返回 **`[rows, fields]`**，
 * 而项目自己的封装 `server/utils/db.ts` 的 `query()` 返回 **行数组本身**（没有 fields）。
 * 两种写法混用必然出错（`const [row] = await conn.query(...)` 拿到的是数组，`row.id` 恒 undefined，
 * 而 `if (row)` 对空数组也是真 → 静默返回 undefined，报错点会漂到很远）。统一走这个 helper。
 */
async function firstRow(sql, params) {
  const [rows] = await conn.query(sql, params)
  return rows[0] ?? null
}

async function findEnterprise() {
  const [rows] = await conn.query('SELECT id FROM enterprise WHERE name = ? LIMIT 1', [ENT_NAME])
  return rows[0]?.id ?? null
}

if (CLEAN_ONLY) {
  const entId = await findEnterprise()
  let n = 0
  if (entId) {
    const [codes] = await conn.query('SELECT code FROM trace_code WHERE enterprise_id = ?', [entId])
    const list = codes.map(c => c.code)
    if (list.length) {
      const [sl] = await conn.query('DELETE FROM scan_log WHERE code IN (?)', [list]); n += sl.affectedRows
      const [ra] = await conn.query('DELETE FROM risk_alert WHERE enterprise_id = ?', [entId]); n += ra.affectedRows
      const [tc] = await conn.query('DELETE FROM trace_code WHERE enterprise_id = ?', [entId]); n += tc.affectedRows
    }
    const [po] = await conn.query('DELETE po FROM product_original po JOIN product p ON p.id = po.product_id WHERE p.enterprise_id = ?', [entId]); n += po.affectedRows
    const [b] = await conn.query('DELETE FROM batch WHERE enterprise_id = ?', [entId]); n += b.affectedRows
    const [p] = await conn.query('DELETE FROM product WHERE enterprise_id = ?', [entId]); n += p.affectedRows
    const [s] = await conn.query('DELETE FROM product_spec WHERE enterprise_id = ?', [entId]); n += s.affectedRows
    const [e] = await conn.query('DELETE FROM enterprise WHERE id = ?', [entId]); n += e.affectedRows
  }
  log(`✅ 已清理演示数据（企业「${ENT_NAME}」），共删除 ${n} 行。`)
  await conn.end()
  process.exit(0)
}

log(`目标库：${DB_HOST}:${DB_PORT}/${DB_NAME}（仅限本机，安全闸已通过）`)
log(`二维码地址前缀：${BASE}\n`)

// 1) 企业（按名字复用，幂等）
let entId = await findEnterprise()
if (!entId) {
  const [r] = await conn.query(
    `INSERT INTO enterprise (name, credit_code, contact, phone, legal_person, license_no, qualification_expire, renew_expire, status)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [ENT.name, ENT.credit_code, ENT.contact, ENT.phone, ENT.legal_person, ENT.license_no, ENT.qualification_expire, ENT.renew_expire, ENT.status])
  entId = r.insertId
  log(`+ enterprise #${entId} ${ENT.name}`)
} else log(`= enterprise #${entId}（已存在，复用）`)

// 2) 规格
const specRow = await firstRow('SELECT id FROM product_spec WHERE enterprise_id = ? AND spec_code = ? LIMIT 1', [entId, SPEC.spec_code])
let specId
if (specRow) specId = specRow.id
else {
  const [r] = await conn.query(
    'INSERT INTO product_spec (enterprise_id, spec_name, net_content, content_unit, pack_unit, spec_code, status) VALUES (?,?,?,?,?,?,1)',
    [entId, SPEC.spec_name, SPEC.net_content, SPEC.content_unit, SPEC.pack_unit, SPEC.spec_code])
  specId = r.insertId
  log(`+ product_spec #${specId} ${SPEC.spec_name}（规格码 ${SPEC.spec_code}）`)
}

// 3) 产品（含原药信息：从登记资料库里挑一条同成分的原药/母药，让 1049 六项展示完整）
async function upsertProduct(def) {
  const row = await firstRow('SELECT id FROM product WHERE registration_no = ? LIMIT 1', [def.registration_no])
  if (row) return row.id
  const [r] = await conn.query(
    `INSERT INTO product (enterprise_id, trademark, name, registration_no, registration_expire, reg_category, holder_name, produce_type,
       dosage, content, spec_id, shelf_life, category, toxicity, is_restricted, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [entId, def.trademark, def.name, def.registration_no, def.registration_expire, 1, def.holder_name, 1,
      def.dosage, def.content, specId, '2年', def.category, def.toxicity, 0, 1])
  const pid = r.insertId
  const orig = await firstRow(
    `SELECT registration_no, product_name, company FROM pesticide_reg
      WHERE dosage IN ('原药','母药') AND ingredient_main = ? ORDER BY expire_date DESC LIMIT 1`, [def.ingredient])
  if (orig) {
    await conn.query('INSERT INTO product_original (product_id, ingredient, reg_no, company) VALUES (?,?,?,?)',
      [pid, def.ingredient, orig.registration_no, orig.company])
    log(`+ product #${pid} ${def.name}（附原药 ${orig.registration_no} ${orig.company}）`)
  } else log(`+ product #${pid} ${def.name}（登记库未找到「${def.ingredient}」原药，原药栏将为空）`)
  return pid
}
const prodIdOk = await upsertProduct(PRODUCT_OK)
const prodIdExpiredReg = await upsertProduct(PRODUCT_EXPIRED_REG)

// 4) 批次（正常 + 已过期）
async function upsertBatch(productId, def) {
  const row = await firstRow('SELECT id FROM batch WHERE product_id = ? AND batch_no = ? LIMIT 1', [productId, def.batch_no])
  if (row) return row.id
  const [r] = await conn.query(
    `INSERT INTO batch (enterprise_id, product_id, batch_no, produce_date, quality_cert_no, expire_date, qc_result, qc_report_no, quantity, code_count)
     VALUES (?,?,?,?,?,?,?,?,?,0)`,
    [entId, productId, def.batch_no, def.produce_date, def.quality_cert_no, def.expire_date, def.qc_result, def.qc_report_no, 1000])
  log(`+ batch #${r.insertId} ${def.batch_no}（有效期至 ${def.expire_date}）`)
  return r.insertId
}
const batchOk = await upsertBatch(prodIdOk, BATCH_OK)
const batchExpired = await upsertBatch(prodIdOk, BATCH_EXPIRED)

// 5) 追溯码（已存在则更新，保证可重复运行）
async function upsertCode(code, { productId, batchId, abnormal = 0, reason = null }) {
  const row = await firstRow('SELECT id FROM trace_code WHERE code = ? LIMIT 1', [code])
  if (row) {
    await conn.query('UPDATE trace_code SET product_id=?, batch_id=?, status=2, abnormal_flag=?, abnormal_reason=?, bound_at=NOW() WHERE id=?',
      [productId, batchId, abnormal, reason, row.id])
    return row.id
  }
  const [r] = await conn.query(
    `INSERT INTO trace_code (enterprise_id, code, product_id, batch_id, status, abnormal_flag, abnormal_reason, uploaded_at, bound_at)
     VALUES (?,?,?,?,2,?,?,NOW(),NOW())`,
    [entId, code, productId, batchId, abnormal, reason])
  return r.insertId
}

for (const s of SCENARIOS) {
  if (s.db === false) continue
  const productId = s.product === 'expiredReg' ? prodIdExpiredReg : prodIdOk
  let batchId = batchOk
  if (s.batch === 'expired') batchId = batchExpired
  const code = s.code || CODE_A(s.seq)
  const id = await upsertCode(code, { productId, batchId, abnormal: s.abnormal || 0, reason: s.abnormal_reason || null })
  log(`+ trace_code #${id} ${code} → ${s.title}${s.abnormal ? `（abnormal_flag=${s.abnormal}）` : ''}`)
}

// 6) 重复查询场景：预置 3 条跨省扫码记录（真实扫码不会写 province，这里是"模拟历史扫码"）
{
  const code = CODE_A(2)
  const rows = [
    ['2026-09-20 09:12:33', '山东省', '济南市', '112.232.11.20', '微信'],
    ['2026-09-21 15:40:08', '河南省', '郑州市', '123.15.28.60', '微信'],
    ['2026-09-22 08:05:47', '广东省', '广州市', '113.108.44.9', '支付宝'],
  ]
  await conn.query('DELETE FROM scan_log WHERE code = ?', [code])
  for (const [t, prov, city, ip, dev] of rows) {
    await conn.query(
      'INSERT INTO scan_log (enterprise_id, code, product_id, scan_time, province, city, scan_device, scan_subject, ip_location) VALUES (?,?,?,?,?,?,?,1,?)',
      [entId, code, prodIdOk, t, prov, city, dev, ip])
  }
  log(`+ scan_log ×3（跨省）→ ${code}`)
}

// ---------- 生成二维码 ----------
const QR = load('qrcode')
const { PNG } = load('pngjs')
const SCALE = 10        // 单模块像素
const MARGIN = 4        // 静区（模块数，规范要求 ≥4）
fs.mkdirSync(OUT_DIR, { recursive: true })

/** 用 qrcode 算出模块矩阵，自己用 pngjs 画 PNG（避免依赖 qrcode 内部的 pngjs 解析路径）
 *  ⚠️ qrcode 的 BitMatrix.get 参数顺序是 (row, col) 即 (y, x)，写反会得到"转置"的图 —— 扫不出来。
 *  最后一步用 zxing 反解每张图，就是为了兜住这类低级但致命的错误。 */
function renderQrPng(text) {
  const qr = QR.create(text, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const size = (n + MARGIN * 2) * SCALE
  const png = new PNG({ width: size, height: size })
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / SCALE) - MARGIN
      const my = Math.floor(y / SCALE) - MARGIN
      const dark = mx >= 0 && my >= 0 && mx < n && my < n && qr.modules.get(my, mx)
      const v = dark ? 0 : 255
      const i = (size * y + x) << 2
      png.data[i] = v; png.data[i + 1] = v; png.data[i + 2] = v; png.data[i + 3] = 255
    }
  }
  return { buf: PNG.sync.write(png), size }
}

/** 用 zxing 反解生成的 PNG，证明"这张图真能被扫出来"（不是只看文件存在） */
function decodeVerify(buf) {
  const zx = load('@zxing/library')
  const png = PNG.sync.read(buf)
  const lum = new Uint8ClampedArray(png.width * png.height)
  for (let i = 0, p = 0; i < png.data.length; i += 4, p++) {
    lum[p] = (png.data[i] * 299 + png.data[i + 1] * 587 + png.data[i + 2] * 114) / 1000
  }
  const src = new zx.RGBLuminanceSource(lum, png.width, png.height)
  const bitmap = new zx.BinaryBitmap(new zx.HybridBinarizer(src))
  const hints = new Map()
  hints.set(zx.DecodeHintType.TRY_HARDER, true)
  try { return new zx.QRCodeReader().decode(bitmap, hints).getText() } catch { return null }
}

const results = []
for (const s of SCENARIOS) {
  const code = s.code || CODE_A(s.seq)
  const url = `${BASE}/trace?code=${code}`
  const { buf, size } = renderQrPng(url)
  const file = path.join(OUT_DIR, `${s.file}.png`)
  fs.writeFileSync(file, buf)
  const decoded = decodeVerify(buf)
  results.push({ ...s, code, url, file, size, decoded, ok: decoded === url })
  log(`${decoded === url ? '✅' : '❌'} ${s.file}.png  ${size}px  ${s.title}  ${decoded === url ? '（zxing 反解一致）' : `（反解结果异常：${decoded}）`}`)
}

// ---------- （可选）接口 + 页面自证 ----------
// 两层都要验：接口 resultType 证明「数据串起来走对了分支」；页面文案证明「客户端真渲染出来了」。
// 只验接口会漏掉白屏/组件挂不上这类问题，只验页面会漏掉「渲染了对的组件但分支错」。
if (VERIFY) {
  log(`\n—— 接口自证：${VERIFY_BASE}/api/trace ——`)
  for (const r of results) {
    // ⚠️ results 里的 file 已被覆盖成完整路径，查表必须取 basename（踩过一次：显示"期望 undefined"）
    const key = path.basename(r.file, '.png')
    const expect = EXPECT_TYPE[key]
    try {
      const res = await fetch(`${VERIFY_BASE}/api/trace?code=${r.code}`)
      const body = res.ok ? await res.json() : null
      const got = res.ok ? String(body?.resultType || '') : `HTTP ${res.status}`
      r.verify = { ok: got === expect, got, expect, reason: (body?.reasons || [])[0] || '', count: body?.queryCount }
      log(`${got === expect ? '✅' : '❌'} ${key}  期望 ${expect} / 实际 ${got}${got === expect ? '' : '  ← 不一致！'}`)
    } catch (e) {
      r.verify = { ok: false, got: '请求失败: ' + e.message, expect }
      log(`❌ ${key}  请求失败：${e.message}（dev 服务没起？用 node scripts/dev-start.mjs）`)
    }
  }

  log(`\n—— 页面自证（SSR 文案）：${VERIFY_BASE}/trace ——`)
  for (const r of results) {
    const key = path.basename(r.file, '.png')
    const marks = PAGE_MARKERS[key] || []
    try {
      const res = await fetch(`${VERIFY_BASE}/trace?code=${r.code}`)
      const html = await res.text()
      const missing = marks.filter(m => !html.includes(m))
      const ok = res.ok && missing.length === 0
      r.page = { ok, status: res.status, size: html.length, missing }
      log(`${ok ? '✅' : '❌'} ${key}  HTTP ${res.status} ${html.length}B${missing.length ? '  缺失文案：' + missing.join(' | ') : ''}`)
    } catch (e) {
      r.page = { ok: false, status: 0, size: 0, missing: ['请求失败: ' + e.message] }
      log(`❌ ${key}  请求失败：${e.message}`)
    }
  }
}

// ---------- index.html 总览页（手机对着屏幕扫） ----------
const TONE = { ok: '#15803d', warn: '#b45309', bad: '#b91c1c', muted: '#475569' }
const cards = results.map((r, i) => `
  <div class="card">
    <div class="hd"><span class="idx">${i + 1}</span><b>${r.title}</b><span class="badge" style="color:${TONE[r.tone]};border-color:${TONE[r.tone]}">预期：${r.expect}</span></div>
    <div class="bd">
      <img src="${path.basename(r.file)}" alt="${r.title}" />
      <div class="meta">
        <div class="k">追溯码</div><div class="v mono">${r.code}</div>
        <div class="k">扫码地址</div><div class="v mono sm">${r.url}</div>
        <div class="k">本机浏览器</div><div class="v"><a href="${r.url.replace(BASE, 'http://127.0.0.1:3100')}" target="_blank">127.0.0.1:3100 打开</a></div>
        ${r.note ? `<div class="note">${r.note}</div>` : ''}
        ${r.verify ? `<div class="note vr">接口自证：期望 <b>${r.verify.expect}</b> / 实际 <b>${r.verify.got}</b> ${r.verify.ok ? '✅' : '❌'}</div>` : ''}
        ${r.page ? `<div class="note vr">页面自证：SSR ${r.page.size}B ${r.page.ok ? '文案齐 ✅' : '缺 ' + (r.page.missing || []).join(' / ') + ' ❌'}</div>` : ''}
      </div>
    </div>
  </div>`).join('')

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>农资315 · 异常场景扫码测试码</title>
<style>
 body{margin:0;padding:24px;background:#f8fafc;color:#0f172a;font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
 h1{margin:0 0 4px;font-size:20px} .sub{color:#64748b;margin-bottom:18px}
 .tips{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;margin-bottom:18px}
 .tips li{margin:4px 0}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px}
 .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.05)}
 .hd{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #eef2f7;flex-wrap:wrap}
 .idx{display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;border-radius:50%;background:#0f172a;color:#fff;font-size:12px}
 .badge{margin-left:auto;font-size:12px;border:1px solid;border-radius:999px;padding:1px 8px}
 .bd{display:flex;gap:14px;padding:14px}
 img{width:168px;height:168px;image-rendering:pixelated;border:1px solid #eef2f7;border-radius:8px;background:#fff}
 .meta{min-width:0;flex:1} .k{color:#64748b;font-size:12px;margin-top:6px} .v{word-break:break-all}
 .mono{font-family:ui-monospace,Consolas,monospace} .sm{font-size:12px;color:#334155}
 .note{margin-top:8px;font-size:12px;color:#475569;background:#f1f5f9;border-radius:6px;padding:6px 8px}
 .vr{color:#166534;background:#f0fdf4}
 a{color:#1d4ed8}
</style></head><body>
<h1>农资315 · 异常场景扫码测试码</h1>
<div class="sub">生成时间 ${new Date().toLocaleString('zh-CN')} · 地址前缀 ${BASE} · 共 ${results.length} 张</div>
<div class="tips"><b>怎么用</b>
<ul>
  <li>手机与本机连同一 Wi-Fi → 用<b>微信扫一扫</b>或相机扫二维码，直接打开结果页。</li>
  <li>本机浏览器验扫码页：先开 <a href="http://127.0.0.1:3100/scan" target="_blank">/scan</a>（localhost 才有相机权限），再扫屏幕上的码。</li>
  <li>前提：本地 dev 服务在跑（<span class="mono">node scripts/dev-start.mjs</span>），且手机能访问本机 3100 端口（防火墙放行）。</li>
</ul></div>
<div class="grid">${cards}</div>
</body></html>`
const htmlPath = path.join(OUT_DIR, 'index.html')
fs.writeFileSync(htmlPath, html, 'utf8')

await conn.end()
const bad = results.filter(r => !r.ok)
const badVerify = results.filter(r => r.verify && !r.verify.ok)
const badPage = results.filter(r => r.page && !r.page.ok)
// 机器可读清单：后续任何人写校验/自动化都用它取码，**不要手抄 32 位码**（抄错过一次）
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
  generatedAt: new Date().toISOString(), base: BASE, db: `${DB_HOST}:${DB_PORT}/${DB_NAME}`,
  items: results.map(r => ({
    file: path.basename(r.file), title: r.title, code: r.code, url: r.url,
    expect: r.expect, expectType: EXPECT_TYPE[path.basename(r.file, '.png')],
    apiResultType: r.verify?.got ?? null, pageOk: r.page?.ok ?? null,
  })),
}, null, 2), 'utf8')

log(`\n生成完毕：${results.length} 张二维码 → ${OUT_DIR}`)
log(`总览页：${htmlPath}`)
log(`清单：${path.join(OUT_DIR, 'manifest.json')}`)
if (bad.length) { log(`⚠️ ${bad.length} 张反解不一致：${bad.map(b => path.basename(b.file)).join(', ')}`); process.exit(1) }
log('全部二维码 zxing 反解与期望 URL 一致（图是真能扫的）。')
if (VERIFY) {
  if (badVerify.length) { log(`⚠️ ${badVerify.length} 个场景接口返回与预期不符：${badVerify.map(b => `${path.basename(b.file, '.png')}(期望 ${b.verify.expect} / 实际 ${b.verify.got})`).join(', ')}`); process.exit(1) }
  log(`接口自证全部通过：${results.length} 个码真打 /api/trace，resultType 与预期完全一致。`)
  if (badPage.length) { log(`⚠️ ${badPage.length} 个结果页文案缺失：${badPage.map(b => `${path.basename(b.file, '.png')}(${(b.page.missing || []).join(' | ')})`).join(', ')}`); process.exit(1) }
  log(`页面自证全部通过：${results.length} 个结果页 SSR 文案齐全。`)
}
