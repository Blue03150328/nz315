// 精测：页尾免责声明 / 追溯码折叠块 与底部固定导航（top=827, bottom=896）的关系
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'

const require = createRequire('file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json')
const { chromium } = require('playwright-core')

const CASES = [
  { key: 'A', url: 'http://localhost:3100/trace?code=12419711000000000000000000000000' },
  { key: 'C', url: 'http://localhost:3100/trace?code=11110331000000000000000000000000' },
]

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
})
const out = {}
for (const c of CASES) {
  const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.goto(c.url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  const rect = async (sel) => {
    const l = page.locator(sel).first()
    if (!(await l.count())) return null
    const b = await l.boundingBox()
    return b ? { top: Math.round(b.y), bottom: Math.round(b.y + b.height) } : null
  }
  const snap = async () => ({
    scrollY: await page.evaluate(() => Math.round(window.scrollY)),
    navTop: 827,
    disclaimer: await rect('p:has-text("登记资料一致不能证明产品真伪")'),
    codeDetails: await rect('details:has(summary:has-text("查看本次追溯码"))'),
    actionRow: await rect('div:has(> button:has-text("记一笔账"))'),
  })

  out[c.key] = { atTop: await snap() }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(700)
  out[c.key].atBottom = await snap()
  await page.screenshot({ path: `E:/二维码管理/tmp/external-${c.key}-tail.png`, fullPage: false })
  await ctx.close()
}
writeFileSync('E:/二维码管理/tmp/_tail.json', JSON.stringify(out, null, 2), 'utf8')
await browser.close()
console.log('ok')
