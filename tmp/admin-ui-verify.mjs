// 临时验证：真浏览器检查「新增用户」对话框角色下拉是否出现「总部管理员」（仅本机，跑完自动清理）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import bcrypt from 'bcryptjs'
import mysql from 'mysql2/promise'

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/')
const { chromium } = require('playwright-core')

const BASE = 'http://localhost:3100'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const log = []
const say = (s) => { log.push(s); console.log(s) }

const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]
}))
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true })

const tag = '__uiv_' + Date.now()
const password = randomBytes(18).toString('hex')
let uid = 0
let browser
try {
  const hash = await bcrypt.hash(password, 10)
  const [r] = await db.execute('INSERT INTO `user` (username,password,name,role,enterprise_id,status) VALUES (?,?,?,?,?,1)', [tag, hash, '界面校验总部', 'platform_admin', null])
  uid = r.insertId

  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: tag, password }) })
  const cookiePair = (login.headers.get('set-cookie') || '').split(';')[0]
  const cookieValue = cookiePair.slice(cookiePair.indexOf('=') + 1)
  say('登录状态=' + login.status + ' cookie提取=' + (cookieValue ? '成功' : '失败'))

  browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.addCookies([{ name: 'nz315_user', value: cookieValue, url: BASE }])
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

  mkdirSync('tmp', { recursive: true })
  await page.goto(BASE + '/admin/settings', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForTimeout(2500)
  say('落地后 URL=' + page.url())
  say('落地后 tab 按钮数=' + (await page.locator('[role="tab"]').count()))
  await page.screenshot({ path: 'tmp/admin-ui-01-landing.png' })

  const tab = page.locator('[role="tab"]', { hasText: '用户权限' })
  say('「用户权限」tab 命中数=' + (await tab.count()))
  if (await tab.count()) await tab.first().click()
  else await page.getByText('用户权限', { exact: true }).first().click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'tmp/admin-ui-02-users-tab.png' })

  const inner = await page.evaluate(() => document.body.innerText.slice(0, 600))
  say('--- 页面文本片段 ---\n' + inner)
  say('「新增用户」按钮数=' + (await page.getByRole('button', { name: '新增用户' }).count()))

  const addBtn = page.getByRole('button', { name: '新增用户' }).first()
  await addBtn.waitFor({ state: 'visible', timeout: 20000 })
  await addBtn.click()
  await page.waitForSelector('text=初始密码', { timeout: 20000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'tmp/admin-ui-03-modal.png' })

  // 展开角色下拉：点开弹窗里显示当前角色值「码管理员」的那个 combobox
  const combo = page.locator('[role="dialog"] [role="combobox"], .b-modal [role="combobox"]')
  say('弹窗内 combobox 数=' + (await combo.count()))
  if (await combo.count()) await combo.first().click()
  else await page.getByText('码管理员', { exact: true }).last().click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: 'tmp/admin-ui-04-dropdown.png' })

  const platCount = await page.getByText('总部管理员', { exact: true }).count()
  const eaCount = await page.getByText('厂家主账号', { exact: true }).count()
  say('下拉中「总部管理员」出现=' + platCount + '；「厂家主账号」出现=' + eaCount)
  if (platCount < 1) throw new Error('角色下拉未出现「总部管理员」选项')
  if (eaCount < 1) throw new Error('角色下拉缺少「厂家主账号」（原有选项丢失）')

  // 选中「总部管理员」后：「所属企业」字段应隐藏（总部账号不挂企业）、且无需选企业即可提交
  const opt = page.getByRole('option', { name: '总部管理员' })
  say('下拉 option「总部管理员」命中数=' + (await opt.count()))
  await opt.first().click()
  await page.waitForTimeout(700)
  const entLabelAfter = await page.getByText('所属企业').count()
  say('选中总部管理员后「所属企业」出现次数=' + entLabelAfter)
  await page.screenshot({ path: 'tmp/admin-ui-05-platform-selected.png' })
  if (entLabelAfter !== 0) throw new Error('选中总部管理员后「所属企业」应隐藏，实际仍有 ' + entLabelAfter + ' 处')

  say('页面 JS 错误=' + (errors.length ? JSON.stringify(errors) : '无'))
  say('界面校验通过')
} catch (e) {
  say('失败：' + (e && e.message ? e.message : String(e)))
  if (browser) {
    try {
      const pages = browser.contexts()[0]?.pages() || []
      if (pages[0]) await pages[0].screenshot({ path: 'tmp/admin-ui-99-failure.png' })
    } catch {}
  }
  process.exitCode = 1
} finally {
  writeFileSync('tmp/admin-ui-verify.txt', log.join('\n'), 'utf8')
  if (browser) await browser.close()
  if (uid) {
    await db.query('DELETE FROM operation_log WHERE user_id = ?', [uid])
    await db.query('DELETE FROM `user` WHERE id = ?', [uid])
    const [[left]] = await db.query('SELECT COUNT(*) AS n FROM `user` WHERE LEFT(username, ?) = ?', [tag.length, tag])
    console.log('临时账号清理后剩余=' + left.n)
  }
  await db.end()
}
