// 外码页瘦身 —— 真浏览器结构断言 + 截图（2026-10-09）
// 用法：node tmp/verify-external.mjs
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'

const require = createRequire('file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json')
const { chromium } = require('playwright-core')

const BASE = 'http://localhost:3100/trace?code=12419711000000000000000000000000'
const CASES = [
  { key: 'A-无来源网址', url: BASE, shot: 'E:/二维码管理/tmp/external-A.png' },
  { key: 'B-带来源网址', url: BASE + '&source=' + encodeURIComponent('https://example.com/'), shot: 'E:/二维码管理/tmp/external-B.png' },
  // C 用「登记证已过期」的码（PD20111033 → 11110331 + 24 个 0）触发异常 tone，验证举报升主 CTA
  { key: 'C-异常tone(登记证过期)', url: 'http://localhost:3100/trace?code=11110331000000000000000000000000', shot: 'E:/二维码管理/tmp/external-C.png' },
]

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const report = {}

for (const c of CASES) {
  const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()) })

  await page.goto(c.url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  const visibleText = async (sel) => page.locator(sel).evaluateAll(els => els
    .filter(el => el.offsetParent !== null || el.tagName === 'SUMMARY')
    .map(el => (el.textContent || '').trim()))

  const r = {
    url: c.url,
    errors,
    iframeCount: await page.locator('iframe').count(),
    h1: await visibleText('h1'),
    h2: await visibleText('h2'),
    // 首屏可见的登记资料字段标签
    visibleDtLabels: await page.locator('dl dt').evaluateAll(els => els
      .filter(el => el.offsetParent !== null).map(el => (el.textContent || '').trim())),
    detailsCount: await page.locator('details').count(),
    detailsOpenFlags: await page.locator('details').evaluateAll(els => els.map(el => el.open)),
    detailsSummaries: await page.locator('details > summary').evaluateAll(els => els.map(el => (el.textContent || '').trim())),
    // 关键元素可见性
    ingredientVisible: await page.locator('dt', { hasText: '有效成分及含量' }).first().isVisible().catch(() => null),
    externalBtnVisible: await page.locator('a:has-text("打开厂家原页查看"), button:has-text("打开厂家原页查看")').first().isVisible().catch(() => null),
    externalHref: await page.locator('a:has-text("打开厂家原页查看")').first().getAttribute('href').catch(() => null),
    rescanVisible: await page.locator('button:has-text("重新扫码"), a:has-text("重新扫码")').first().isVisible().catch(() => null),
    billVisible: await page.locator('button:has-text("记一笔账")').first().isVisible().catch(() => null),
    reportVisible: await page.locator('button:has-text("举报投诉")').first().isVisible().catch(() => null),
    disclaimer: await page.locator('p', { hasText: '登记资料一致不能证明产品真伪' }).count(),
    bodyLen: (await page.locator('body').innerText()).length,
  }

  await page.screenshot({ path: c.shot, fullPage: true })

  // 展开「完整登记资料」→ 断言内容可见（折叠交互真实可用）
  const fa = page.locator('details > summary', { hasText: '展开完整登记资料' }).first()
  if (await fa.count()) {
    await fa.click()
    await page.waitForTimeout(400)
    r.afterExpand_ingredientVisible = await page.locator('dt', { hasText: '有效成分及含量' }).first().isVisible()
    r.afterExpand_contentVisible = await page.locator('dt', { hasText: '总有效成分含量' }).first().isVisible()
    r.afterExpand_formulationVisible = await page.locator('dt', { hasText: '剂型' }).first().isVisible()
    await page.screenshot({ path: c.shot.replace('.png', '-expanded.png'), fullPage: true })
  }

  // 厂家声明原文折叠块（仅当有来源页数据时渲染）
  const fs2 = page.locator('details > summary', { hasText: '查看厂家声明原文' })
  r.declarationDetailsCount = await fs2.count()

  report[c.key] = r
  await ctx.close()
}

writeFileSync('E:/二维码管理/tmp/_browser-report.json', JSON.stringify(report, null, 2), 'utf8')
await browser.close()
console.log(JSON.stringify(report, null, 2))
