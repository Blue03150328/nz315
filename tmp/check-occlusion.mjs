// 遮挡检查：底部固定导航是否压住行动区 / 免责声明（2026-10-10）
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

  // 找出所有「钉在屏幕底部的固定层」
  const fixedLayers = await page.evaluate(() => {
    const vh = window.innerHeight
    const res = []
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el)
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue
      const r = el.getBoundingClientRect()
      if (r.height < 30 || r.height > 120 || r.width < 200) continue
      if (r.bottom < vh - 4) continue
      res.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 60), top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 40) })
    }
    return res
  })

  const measure = async () => page.evaluate(() => {
    const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) } }
    const btns = [...document.querySelectorAll('button')]
    const find = (t) => { const b = btns.find(x => (x.innerText || '').includes(t)); if (!b) return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) } }
    return {
      scrollY: Math.round(window.scrollY),
      maxScroll: Math.round(document.documentElement.scrollHeight - window.innerHeight),
      bill: find('记一笔账'),
      report: find('举报投诉'),
      rescan: find('重新扫码'),
      disclaimer: pick('p:last-of-type'),
    }
  })

  out[c.key] = { fixedLayers, atTop: await measure() }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(700)
  out[c.key].atBottom = await measure()
  await page.screenshot({ path: `E:/二维码管理/tmp/external-${c.key}-bottom2.png` })
  await ctx.close()
}
writeFileSync('E:/二维码管理/tmp/_occlusion.json', JSON.stringify(out, null, 2), 'utf8')
await browser.close()
console.log('ok')
