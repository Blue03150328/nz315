// 浏览器使用虚构接口响应；验证实际生产构建的下载与交互，不连接业务库。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import XLSX from 'xlsx'

if (process.env.NZ315_GENERATOR_EXPORT_TEST !== '1') { console.log('默认跳过；设置 NZ315_GENERATOR_EXPORT_TEST=1 运行浏览器隔离测试'); process.exit(0) }
const output = path.resolve(process.env.NZ315_GENERATOR_EXPORT_BUILD || '.tmp/generator-export-output')
const downloads = path.resolve('.tmp/generator-export-downloads')
fs.mkdirSync(downloads, { recursive: true })
const base = 'http://127.0.0.1:38423'
const user = { id: 999999, username: 'export-test', name: '隔离测试', role: 'enterprise_admin', enterpriseId: 999999 }
const product = { id: 999999, name: '虚构导出测试药', registration_no: 'PD20991234', spec_name: '400克×20瓶', spec_code: '001', produce_type: 1, enterprise_id: 999999 }
const codes = Array.from({ length: 10000 }, (_, index) => '11234561001' + String(index).padStart(21, '0'))
const server = spawn(process.execPath, [path.join(output, 'server/index.mjs')], {
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: '38423', HOST: '127.0.0.1', NUXT_DB_HOST: '127.0.0.1', NUXT_DB_PORT: '9', NUXT_DB_NAME: 'generator_export_no_database', NUXT_DB_USER: 'disabled', NUXT_DB_PASSWORD: 'disabled', NUXT_SESSION_SECRET: 'isolated-generator-browser-test-20261023' },
})
// 后台重试插件只能访问关闭的本机端口，保留有限日志供失败诊断。
let logs = ''
server.stdout.on('data', data => { logs = (logs + data).slice(-4000) })
server.stderr.on('data', data => { logs = (logs + data).slice(-4000) })
let browser
let checks = 0
function ok(name) { console.log('通过：' + name); checks++ }
try {
  let ready = false
  for (let i = 0; i < 100; i++) {
    assert.equal(server.exitCode, null, logs)
    if (logs.includes('Listening on')) {
      try { await fetch(base + '/login'); ready = true; break } catch { /* 等待本轮服务器就绪 */ }
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(ready, logs)
  const playwrightPath = process.env.NZ315_TEST_PLAYWRIGHT || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')
  const { chromium } = await import(pathToFileURL(playwrightPath))
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 900 } })
  const errors = []
  const requestedQuantities = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname
    let body = {}
    if (pathname === '/api/auth/me' || pathname === '/api/auth/login') body = { user, sessionInvalidated: false }
    else if (pathname === '/api/admin/products') body = { rows: [product], total: 1, page: 1, pageSize: 50 }
    else if (pathname === '/api/admin/codes/generate') {
      requestedQuantities.push(route.request().postDataJSON().quantity)
      body = { allCodes: codes, product: { name: product.name, specName: product.spec_name, enterpriseId: product.enterprise_id, registrationNo: product.registration_no, specCode: product.spec_code }, companyName: '虚构测试企业', quantity: codes.length, duplicates: 0, elapsedMs: 50, preview: codes.slice(0, 10).map(code => ({ code, segments: [{ value: code[0], label: '类别' }, { value: code.slice(1, 7), label: '登记证' }, { value: code[7], label: '生产类型' }, { value: code.slice(8, 11), label: '规格' }, { value: code.slice(11), label: '自定义段' }] })) }
    }
    await route.fulfill({ json: body })
  })
  await page.goto(base + '/login?redirect=/admin/generator')
  await page.getByPlaceholder('请输入企业分配的账号').fill('isolated-test')
  await page.getByPlaceholder('请输入密码').fill('isolated-test')
  await page.getByRole('button', { name: '登 录', exact: true }).click()
  await page.getByRole('heading', { name: '追溯码生成', exact: true }).waitFor()
  await page.locator('[aria-label="生成产品"]').click()
  await page.getByRole('option').filter({ hasText: product.name }).click()
  // 下拉关闭的焦点恢复动画结束后再输入，避免测试键盘操作被焦点切换打断。
  await page.waitForTimeout(150)
  await page.locator('input[type=number]').first().fill('')
  await page.locator('input[type=number]').first().pressSequentially('10000')
  await page.locator('input[type=number]').first().press('Tab')
  assert.equal(await page.locator('input[type=number]').first().inputValue(), '10000')
  await page.getByRole('button', { name: '生成追溯码', exact: true }).click()
  await page.getByText('共 10000 条', { exact: false }).waitFor()
  assert.equal(requestedQuantities.at(-1), 10000)
  ok('虚构接口生成10000条，真实页面渲染')

  async function open(format) {
    await page.getByRole('button', { name: '导出 ' + format, exact: true }).click()
    await page.locator('#export-file-count').waitFor()
  }
  async function settings(count, perFile) {
    await page.locator('#export-file-count').fill(String(count))
    await page.locator('#export-file-count').press('Tab')
    await page.locator('#export-codes-per-file').fill(String(perFile))
    await page.locator('#export-codes-per-file').press('Tab')
  }
  async function download() {
    const waiting = page.waitForEvent('download')
    await page.getByRole('button', { name: /^(打包下载 ZIP|下载文件)$/ }).click()
    const item = await waiting
    const target = path.join(downloads, item.suggestedFilename())
    await item.saveAs(target)
    await page.locator('#export-file-count').waitFor({ state: 'hidden' })
    return target
  }
  function readZip(target, format, expected) {
    const archive = XLSX.CFB.read(fs.readFileSync(target), { type: 'buffer' })
    const entries = archive.FileIndex.filter(file => file.type === 2 && file.size > 0 && !file.name.includes('Sh33tJ5'))
    assert.equal(entries.length, 20)
    const exported = []
    for (const entry of entries) {
      const text = Buffer.from(entry.content).toString('utf8').replace(/^\uFEFF/, '')
      if (format === 'CSV') {
        const book = XLSX.read(text, { type: 'string', raw: true })
        const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 })
        assert.equal(rows.length, 401)
        assert.equal(rows[0][0], 'sn')
        exported.push(...rows.slice(1).map(row => row[0]))
      } else {
        const lines = text.split('\n')
        assert.equal(lines.length, 400)
        if (format === 'urls.txt') assert.ok(lines.every(line => /^https:\/\/.*\/trace\?code=/.test(line)))
        exported.push(...lines.map(line => line.split('code=').at(-1)))
      }
    }
    assert.equal(new Set(exported).size, expected.length)
    assert.deepEqual([...exported].sort(), [...expected].sort())
  }

  await open('TXT')
  assert.equal(await page.locator('#export-file-count').inputValue(), '1')
  assert.equal(await page.locator('#export-codes-per-file').inputValue(), '10000')
  await settings(20, 600)
  await page.getByRole('alert').filter({ hasText: '当前可导出' }).waitFor()
  assert.ok(await page.getByRole('button', { name: '打包下载 ZIP', exact: true }).isDisabled())
  await settings(0, 400)
  assert.ok(await page.getByRole('button', { name: '下载文件', exact: true }).isDisabled())
  await settings(20, 0.5)
  assert.ok(await page.getByRole('button', { name: '打包下载 ZIP', exact: true }).isDisabled())
  ok('默认单文件全量；超量、零和小数输入均拦截')
  await settings(20, 400)
  readZip(await download(), 'TXT', codes.slice(0, 8000))
  await page.getByText('尚未全部导出', { exact: true }).waitFor()
  assert.match(await page.locator('body').innerText(), /已导出 8,000 条，剩余 2,000 条/)
  ok('TXT实际下载20份×400条，8000条无重无漏，余码仍提示未保存')

  await open('TXT')
  assert.equal(await page.locator('#export-codes-per-file').inputValue(), '2000')
  assert.match(await page.getByRole('dialog').innerText(), /第 8,001 条开始/)
  const remainderFile = await download()
  assert.match(path.basename(remainderFile), /8001-10000_2000条/)
  const remainder = fs.readFileSync(remainderFile, 'utf8').replace(/^\uFEFF/, '').split('\n')
  assert.deepEqual(remainder, codes.slice(8000))
  assert.equal(await page.getByText('尚未全部导出', { exact: true }).count(), 0)
  ok('再次导出自动从8001条开始，最后2000条保存后解除提醒')

  for (const format of ['urls.txt', 'CSV']) {
    await open(format)
    assert.match(await page.getByRole('dialog').innerText(), /再次导出将从第 1 条开始/)
    await settings(20, 400)
    readZip(await download(), format, codes.slice(0, 8000))
    ok(format + '实际下载20份×400条，保留网址或CSV表头且内容正确')
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await open('TXT')
  const bounds = await page.getByRole('dialog').boundingBox()
  assert.ok(bounds.width <= 390 && bounds.x >= 0)
  await settings(20, 400)
  assert.ok(await page.getByRole('button', { name: '打包下载 ZIP', exact: true }).isEnabled())
  await page.screenshot({ path: path.join(downloads, '分文件导出-小屏.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '取消', exact: true }).click()
  ok('390px小屏设置与取消可操作')

  // 模拟浏览器拒绝创建下载对象，必须保留本批的待导出状态。
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: '生成追溯码', exact: true }).click()
  await page.getByText('尚未导出', { exact: true }).waitFor()
  assert.equal(requestedQuantities.at(-1), 10000)
  await open('TXT')
  await page.evaluate(() => { window.__originalCreateObjectURL = URL.createObjectURL; URL.createObjectURL = () => { throw new Error('隔离下载失败') } })
  await page.getByRole('button', { name: '下载文件', exact: true }).click()
  await page.getByText('隔离下载失败', { exact: true }).waitFor()
  assert.ok(await page.locator('#export-file-count').isVisible())
  await page.evaluate(() => { URL.createObjectURL = window.__originalCreateObjectURL })
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.ok(await page.getByText('尚未导出', { exact: true }).isVisible())
  await open('TXT')
  assert.equal(await page.locator('#export-codes-per-file').inputValue(), '10000')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  ok('重新生成重置导出进度，下载失败不推进范围或解除防丢失提醒')
  assert.deepEqual(errors, [])
  ok('页面无未处理异常')
  console.log(`浏览器隔离验收通过：${checks}组`)
} finally {
  await browser?.close()
  server.kill()
}
