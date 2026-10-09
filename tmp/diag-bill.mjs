import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire('file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json')
const { chromium } = require('playwright-core')
const { token } = JSON.parse(fs.readFileSync(new URL('./session.json', import.meta.url), 'utf8'))
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://localhost:3100'

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } })
await ctx.addCookies([{ name: 'nz315_consumer', value: token, url: BASE }])
const page = await ctx.newPage()
page.on('pageerror', e => console.log('[pageerror]', e.message))

await page.goto(BASE + '/bill', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)

console.log('=== 登录态文本片段 ===')
const txt = await page.locator('body').innerText()
console.log(txt.replace(/\n{2,}/g, '\n').slice(0, 700))

console.log('\n=== 所有 button 文本 ===')
for (const b of await page.locator('button').all()) {
  const t = (await b.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
  console.log('  btn:', JSON.stringify(t), 'visible=' + await b.isVisible().catch(() => '?'))
}

console.log('\n=== 点击「记一笔」 ===')
const target = page.getByText('记一笔').first()
console.log('  「记一笔」元素数:', await page.getByText('记一笔').count())
await target.click()
await page.waitForTimeout(2000)

console.log('\n=== 点击后所有 input ===')
for (const i of await page.locator('input, textarea, select').all()) {
  console.log('  ', await i.evaluate(el => el.tagName + ' type=' + (el.type || '-') + ' ph=' + JSON.stringify(el.placeholder || '') + ' visible=' + !!(el.offsetParent)).catch(e => 'err:' + e.message))
}

console.log('\n=== 点击后 body 文本 ===')
console.log((await page.locator('body').innerText()).replace(/\n{2,}/g, '\n').slice(0, 900))

await page.screenshot({ path: 'e2e-diag.png', fullPage: false })
console.log('\n截图: tmp/e2e-diag.png')
await browser.close()
