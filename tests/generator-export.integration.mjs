// 浏览器使用虚构接口响应；验证实际生产构建的下载与交互，不连接业务库。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import XLSX from 'xlsx'

if (process.env.NZ315_GENERATOR_EXPORT_TEST !== '1') { console.log('默认跳过；设置 NZ315_GENERATOR_EXPORT_TEST=1 运行浏览器隔离测试'); process.exit(0) }
const output = path.resolve(process.env.NZ315_GENERATOR_EXPORT_BUILD || '.tmp/generator-files-output')
const downloads = path.resolve('.tmp/generator-files-downloads')
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
      const quantity = route.request().postDataJSON().quantity
      requestedQuantities.push(quantity)
      body = { allCodes: codes.slice(0, quantity), product: { name: product.name, specName: product.spec_name, enterpriseId: product.enterprise_id, registrationNo: product.registration_no, specCode: product.spec_code }, companyName: '虚构测试企业', quantity, duplicates: 0, elapsedMs: 50, preview: codes.slice(0, 10).map(code => ({ code, segments: [{ value: code[0], label: '类别' }, { value: code.slice(1, 7), label: '登记证' }, { value: code[7], label: '生产类型' }, { value: code.slice(8, 11), label: '规格' }, { value: code.slice(11), label: '自定义段' }] })) }
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
  async function settings(count, perFile) {
    await page.locator('#generate-file-count').fill(String(count))
    await page.locator('#generate-file-count').press('Tab')
    await page.locator('#generate-codes-per-file').fill(String(perFile))
    await page.locator('#generate-codes-per-file').press('Tab')
  }
  async function generate(count, perFile) {
    await settings(count, perFile)
    await page.getByRole('button', { name: '生成追溯码', exact: true }).click()
    await page.getByText('共 ' + count * perFile + ' 条', { exact: false }).first().waitFor()
    await page.getByText('尚未导出', { exact: true }).waitFor()
    assert.equal(requestedQuantities.at(-1), count * perFile)
  }
  async function download(format) {
    const waiting = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出 ' + format, exact: true }).click()
    const item = await waiting
    const target = path.join(downloads, item.suggestedFilename())
    await item.saveAs(target)
    await page.getByText('尚未导出', { exact: true }).waitFor({ state: 'hidden' })
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

  assert.equal(await page.locator('#generate-file-count').inputValue(), '1')
  assert.equal(await page.locator('#generate-codes-per-file').inputValue(), '100')
  for (const [count, perFile] of [[0, 400], [20, 0.5], [1001, 1], [20, 25001], [1, '']]) {
    await settings(count, perFile)
    assert.ok(await page.getByRole('button', { name: '生成追溯码', exact: true }).isDisabled())
  }
  assert.equal(requestedQuantities.length, 0)
  ok('默认单文件100条；非法数量和总量超限在生成前拦截，未请求接口')

  await generate(20, 400)
  ok('生成前填写20份×400条，接口恰好请求8000条')
  for (const format of ['TXT', 'urls.txt', 'CSV']) {
    readZip(await download(format), format, codes.slice(0, 8000))
    assert.equal(await page.getByRole('dialog').count(), 0)
    ok(format + '直接下载20份×400条，无分文件弹窗、无重无漏')
  }

  await settings(2, 5)
  readZip(await download('TXT'), 'TXT', codes.slice(0, 8000))
  assert.equal(requestedQuantities.length, 1)
  ok('修改下一批表单后，当前批重下仍保持生成时的20份×400条')

  await generate(2, 5)
  const twoFiles = XLSX.CFB.read(fs.readFileSync(await download('TXT')), { type: 'buffer' }).FileIndex.filter(file => file.type === 2 && file.size > 0 && !file.name.includes('Sh33tJ5'))
  assert.equal(twoFiles.length, 2)
  const twoCodes = twoFiles.flatMap(file => Buffer.from(file.content).toString('utf8').replace(/^\uFEFF/, '').split('\n'))
  assert.deepEqual(twoCodes, codes.slice(0, 10))
  ok('重新生成应用2份×5条的新设置，重置本批导出状态')

  await generate(1, 7)
  await page.evaluate(() => { window.__originalCreateObjectURL = URL.createObjectURL; URL.createObjectURL = () => { throw new Error('隔离下载失败') } })
  await page.getByRole('button', { name: '导出 TXT', exact: true }).click()
  await page.getByText('隔离下载失败', { exact: true }).waitFor()
  assert.ok(await page.getByText('尚未导出', { exact: true }).isVisible())
  await page.evaluate(() => { URL.createObjectURL = window.__originalCreateObjectURL })
  const single = await download('TXT')
  assert.ok(!single.endsWith('.zip'))
  assert.deepEqual(fs.readFileSync(single, 'utf8').replace(/^\uFEFF/, '').split('\n'), codes.slice(0, 7))
  ok('下载失败保留防丢失提醒；重试单文件7条成功')

  await page.setViewportSize({ width: 390, height: 844 })
  await settings(20, 400)
  for (const id of ['#generate-file-count', '#generate-codes-per-file']) {
    const bounds = await page.locator(id).boundingBox()
    assert.ok(bounds.width > 0 && bounds.x >= 0 && bounds.x + bounds.width <= 390)
  }
  ok('390px小屏生成前两个数量输入框可用且不溢出')

  await page.setViewportSize({ width: 1280, height: 900 })
  await settings(1000, 500)
  await page.getByRole('button', { name: '生成追溯码', exact: true }).click()
  await page.getByRole('heading', { name: '确认生成大数量追溯码' }).waitFor()
  assert.match(await page.getByRole('dialog').innerText(), /500,000/)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(requestedQuantities.length, 3)
  ok('大数量确认按乘积50万条显示，取消不生成')

  await page.getByRole('button', { name: '重置', exact: true }).click()
  assert.equal(await page.locator('#generate-file-count').inputValue(), '1')
  assert.equal(await page.locator('#generate-codes-per-file').inputValue(), '100')
  assert.equal(await page.getByRole('button', { name: '导出 TXT', exact: true }).count(), 0)
  ok('重置恢复默认文件设置并清空结果')
  assert.deepEqual(errors, [])
  ok('页面无未处理异常')
  console.log(`浏览器隔离验收通过：${checks}组`)
} finally {
  await browser?.close()
  server.kill()
}
