// 真浏览器端到端回归：公众端「记一笔」保存
// 用法：node e2e-bill.mjs <标签>
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire('file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json')
const { chromium } = require('playwright-core')

const tag = process.argv[2] || 'run'
const { token } = JSON.parse(fs.readFileSync(new URL('./session.json', import.meta.url), 'utf8'))
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://localhost:3100'
const out = (n) => 'E:/二维码管理/tmp/e2e-' + tag + '-' + n + '.png'

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 })
await ctx.addCookies([{ name: 'nz315_consumer', value: token, url: BASE }])
const page = await ctx.newPage()

const errors = []
const billPosts = []
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()) })
page.on('response', r => {
  if (r.url().includes('/api/bill') && r.request().method() === 'POST') {
    billPosts.push(r.status())
  }
})
const step = (n, s) => console.log('[' + n + '] ' + s)
// 每次用唯一产品名，避免撞上服务端的「同日/同产品/同金额」重复守卫（409）
const uniq = String(Date.now()).slice(-6)
const PRODUCT = '验证产品' + uniq
const AMOUNT = '14444'

// 真到手机上会弹「发现重复记账，仍要保存吗」——headless 里自动确认，避免阻塞
page.on('dialog', d => d.accept())

await page.goto(BASE + '/bill', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
step(1, '打开 /bill（已注入合法消费者会话）')

await page.locator('button:has-text("记一笔")').first().click()
const amountInput = page.locator('input[placeholder="先填这笔花了多少钱"]')
const nameInput = page.locator('input[placeholder="例如：25%多·酮可湿性粉剂"]')
await amountInput.waitFor({ state: 'visible', timeout: 20000 })
step(2, '弹窗已打开，金额输入框可见')

await amountInput.fill(AMOUNT)
await nameInput.fill(PRODUCT)
await page.waitForTimeout(400)
step(3, '填入 总金额=' + AMOUNT + '、产品名称=' + PRODUCT)
await page.screenshot({ path: out('form') })

await page.locator('button:has-text("保存")').first().click()
step(4, '已点击「保存」')

let toast = '（无）'
try {
  await page.getByText(/已记入账本/).first().waitFor({ timeout: 8000 })
  toast = '已记入账本'
} catch {
  const t = await page.locator('body').innerText()
  toast = '未出现成功提示；可见文本 = ' + t.replace(/\s+/g, ' ').slice(-260)
}
step(5, '结果提示：' + toast)

await page.waitForTimeout(1500)
const modalOpen = await amountInput.count()
step(6, '弹窗是否仍在：' + (modalOpen > 0 ? '是（提交未成功）' : '否（已关闭）'))
await page.screenshot({ path: out('result') })

console.log('\n===== 判定 =====')
console.log('POST /api/bill 状态码:', JSON.stringify(billPosts))
console.log('页面错误:', errors.length ? errors : '无')
const pass = billPosts.includes(200) && errors.length === 0 && modalOpen === 0
console.log('结论:', pass ? '✅ 保存链路打通' : '❌ 仍失败')
await browser.close()
