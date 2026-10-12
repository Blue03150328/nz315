// 临时验证（2026-10-10）：真浏览器检查
// ① 码库管理：仅「生成入库」留档批次出现【导出】按钮，非留档批次不出现；按钮未被遮挡；点导出能真下载
// ② 追溯码生成：生成后出现防丢失提醒，导出后提醒消失
// 判据说明：不能用 body.innerHTML 判「弹窗是否打开」——按钮 aria-label 含同样中文会造成假阳性；
//           唯一可靠判据 = 弹窗内「码文件 TXT」按钮是否存在。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/')
const { chromium } = require('playwright-core')

const BASE = 'http://localhost:3100'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const log = ['=== export-ui-verify log ===']
const say = (s) => { log.push(s); console.log(s) }

const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]
}))
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true })

const tag = '__uix_' + Date.now()
const stamp = String(Date.now()).slice(-8)
const password = randomBytes(18).toString('hex')
const hash = await bcrypt.hash(password, 10)
const codeOf = (n) => '9' + '000001' + '1' + '001' + stamp + String(n).padStart(13, '0')

const STOCKED_NAME = '生成入库 2026-10-10 10:00'
const UPLOADED_NAME = '生产采集上传_2026-10-10.xlsx'
const PRODUCT_NAME = tag + '产品'

let browser
let entId = 0
try {
  const [ent] = await db.execute('INSERT INTO enterprise (name, credit_code, renew_expire, status) VALUES (?,?,?,1)', [tag + '企业', '9X' + stamp.padStart(16, '0'), '2099-12-31'])
  entId = ent.insertId
  const [spec] = await db.execute('INSERT INTO product_spec (enterprise_id, spec_name, spec_code, status) VALUES (?,?,?,1)', [entId, tag + '规格', '901'])
  const [prod] = await db.execute('INSERT INTO product (enterprise_id, name, registration_no, reg_category, produce_type, spec_id, status) VALUES (?,?,?,1,1,?,1)', [entId, PRODUCT_NAME, 'PD' + stamp, spec.insertId])
  const [b1] = await db.execute('INSERT INTO upload_batch (enterprise_id, file_name, product_id) VALUES (?,?,?)', [entId, STOCKED_NAME, prod.insertId])
  const [b2] = await db.execute('INSERT INTO upload_batch (enterprise_id, file_name, product_id) VALUES (?,?,?)', [entId, UPLOADED_NAME, prod.insertId])
  await db.query('INSERT INTO trace_code (enterprise_id, code, product_id, upload_batch_id, status, abnormal_flag) VALUES ?', [[
    [entId, codeOf(1), prod.insertId, b1.insertId, 1, 0],
    [entId, codeOf(2), prod.insertId, b1.insertId, 1, 0],
    [entId, codeOf(3), prod.insertId, b1.insertId, 1, 0],
  ]])
  await db.query('INSERT INTO trace_code (enterprise_id, code, product_id, upload_batch_id, status, abnormal_flag) VALUES ?', [[[entId, codeOf(9), prod.insertId, b2.insertId, 1, 0]]])
  await db.execute('INSERT INTO `user` (username,password,name,role,enterprise_id,status) VALUES (?,?,?,?,?,1)', [tag + '_ea', hash, '导出台账验收', 'enterprise_admin', entId])

  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: tag + '_ea', password }) })
  say('登录状态=' + login.status)
  const cookiePair = (login.headers.get('set-cookie') || '').split(';')[0]

  browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  await ctx.addCookies([{ name: 'nz315_user', value: cookiePair.slice(cookiePair.indexOf('=') + 1), url: BASE }])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  mkdirSync('tmp', { recursive: true })

  // ---------- ① 码库管理：按钮可见性 + 真下载 ----------
  await page.goto(BASE + '/admin/codes', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForSelector('text=' + STOCKED_NAME, { timeout: 60000 })

  const stockedRow = page.locator('tr', { hasText: STOCKED_NAME }).first()
  const uploadedRow = page.locator('tr', { hasText: UPLOADED_NAME }).first()
  const stockedExport = stockedRow.getByRole('button', { name: '导出' })
  const sCount = await stockedExport.count()
  const uCount = await uploadedRow.getByRole('button', { name: '导出' }).count()
  say('留档批次行【导出】按钮数=' + sCount + '；非留档批次行【导出】按钮数=' + uCount)
  if (sCount !== 1) throw new Error('留档批次应恰好有 1 个导出按钮，实际 ' + sCount)
  if (uCount !== 0) throw new Error('非留档批次不应出现导出按钮，实际 ' + uCount)

  // 遮挡探针：真实用户鼠标能否命中该按钮（elementFromPoint 中心点应为按钮自身）
  await stockedExport.scrollIntoViewIfNeeded()
  const probe = await stockedExport.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const top = document.elementFromPoint(cx, cy)
    return { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], hitSelf: top === el || el.contains(top), topHtml: (top ? top.outerHTML : '').slice(0, 110) }
  })
  say('按钮遮挡探针=' + JSON.stringify(probe))
  if (!probe.hitSelf) throw new Error('导出按钮被其他元素遮挡，真实用户点不到：' + probe.topHtml)

  const openCheck = async () => (await page.getByRole('button', { name: /码文件 TXT/ }).count()) > 0
  await stockedExport.click({ force: true })
  await page.waitForTimeout(1200)
  let shown = await openCheck()
  if (!shown) {
    await stockedExport.evaluate((el) => el.click())
    await page.waitForTimeout(1200)
    shown = await openCheck()
    say('（playwright 合成点击未生效，已用原生 el.click() 触发）')
  }
  say('格式选择弹窗已打开=' + shown)
  if (!shown) throw new Error('点击导出后未出现格式选择弹窗')
  await page.screenshot({ path: 'tmp/export-ui-01-modal.png' })

  const dlPromise = page.waitForEvent('download', { timeout: 25000 }).catch(() => null)
  await page.getByRole('button', { name: /码文件 TXT/ }).first().click({ force: true })
  await page.waitForTimeout(2500)
  const dl = await dlPromise
  if (!dl) throw new Error('点击导出 TXT 未触发下载')
  const dlName = dl.suggestedFilename()
  say('下载文件名=' + dlName)
  if (!dlName.includes(PRODUCT_NAME)) throw new Error('下载文件名应含产品名，实际 ' + dlName)
  await page.waitForTimeout(600)
  const stillOpen = await openCheck()
  say('下载后弹窗仍打开=' + stillOpen)
  if (stillOpen) throw new Error('下载成功后弹窗应自动关闭')
  await page.screenshot({ path: 'tmp/export-ui-02-codes.png' })

  // ---------- ② 生成页防丢失提醒 ----------
  // 注意：产品 USelect 的 items 来自 setup 里的 useFetch（列表未落地时下拉点开无 option），
  //       故必须等 networkidle 并把「点开→数 option」做成轮询重试，不能点一次就断言。
  await page.goto(BASE + '/admin/generator', { waitUntil: 'networkidle', timeout: 90000 })
  const combo = page.getByRole('combobox').first()
  await combo.waitFor({ state: 'visible', timeout: 60000 })
  await page.waitForTimeout(1200)
  let opts = []
  for (let i = 0; i < 6; i++) {
    await combo.click({ force: true })
    await page.waitForTimeout(800)
    opts = await page.locator('[role="option"]').allInnerTexts()
    if (opts.length) break
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(400)
  }
  say('产品下拉选项数=' + opts.length + ' 前几个=' + JSON.stringify(opts.slice(0, 5)))
  const target = page.locator('[role="option"]', { hasText: PRODUCT_NAME }).first()
  if ((await target.count()) === 0) throw new Error('产品下拉未找到测试产品：' + PRODUCT_NAME)
  await target.click({ force: true })
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '生成追溯码' }).click({ force: true })
  await page.waitForSelector('text=生成结果', { timeout: 60000 })
  await page.getByText(/尚未导出/).first().waitFor({ state: 'visible', timeout: 20000 })
  say('生成后防丢失提醒可见=是')
  await page.screenshot({ path: 'tmp/export-ui-03-warning.png' })

  const dl2Promise = page.waitForEvent('download', { timeout: 25000 }).catch(() => null)
  await page.getByRole('button', { name: '导出 TXT' }).click({ force: true })
  const dl2 = await dl2Promise
  say('生成页导出捕获=' + (dl2 ? dl2.suggestedFilename() : '未捕获'))
  await page.waitForTimeout(900)
  const warnAfter = await page.getByText(/尚未导出/).count()
  say('导出后防丢失提醒可见数=' + warnAfter)
  if (warnAfter !== 0) throw new Error('导出后防丢失提醒应消失')

  say('页面 JS 错误=' + (errors.length ? JSON.stringify(errors) : '无'))
  if (errors.length) throw new Error('页面出现 JS 错误：' + errors.join(' | '))
  say('界面校验通过')
} catch (e) {
  say('失败：' + (e && e.message ? e.message : String(e)))
  if (browser) { try { const p = browser.contexts()[0]?.pages()?.[0]; if (p) await p.screenshot({ path: 'tmp/export-ui-99-fail.png' }) } catch {} }
  process.exitCode = 1
} finally {
  writeFileSync('tmp/export-ui-verify.txt', log.join('\n'), 'utf8')
  if (browser) await browser.close()
  if (entId) {
    const [ubs] = await db.query('SELECT id FROM upload_batch WHERE enterprise_id = ?', [entId])
    const ids = ubs.map((x) => x.id)
    if (ids.length) await db.query('DELETE FROM trace_code WHERE upload_batch_id IN (?)', [ids])
    await db.query('DELETE FROM trace_code WHERE enterprise_id = ?', [entId])
    await db.query('DELETE FROM upload_batch WHERE enterprise_id = ?', [entId])
    await db.query('DELETE FROM product WHERE enterprise_id = ?', [entId])
    await db.query('DELETE FROM product_spec WHERE enterprise_id = ?', [entId])
    const [us] = await db.query('SELECT id FROM `user` WHERE LEFT(username, ?) = ?', [tag.length, tag])
    if (us.length) {
      await db.query('DELETE FROM operation_log WHERE user_id IN (?)', [us.map((x) => x.id)])
      await db.query('DELETE FROM `user` WHERE id IN (?)', [us.map((x) => x.id)])
    }
    await db.query('DELETE FROM enterprise WHERE id = ?', [entId])
    const [[left]] = await db.query('SELECT COUNT(*) AS n FROM enterprise WHERE LEFT(name, ?) = ?', [tag.length, tag])
    console.log('临时数据清理后剩余=' + left.n)
  }
  await db.end()
}
