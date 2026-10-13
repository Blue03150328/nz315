import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./_ts-loader.mjs', import.meta.url)
const { internalTraceCodeOf, traceUrlClassification, isTraceWebsiteUrl } = await import('../shared/utils/internal-trace-url.ts')
const code = '12001041001000000000000000000001'

test('内部网址无需入库，支持主域名、裸域名与参数顺序', () => {
  for (const url of [`https://www.nz315.cn/trace?code=${code}`, `https://nz315.cn/trace?from=scan&code=${code}`, `HTTP://WWW.NZ315.CN:80/trace?code=${code}`, `https://www.nz315.cn:443/trace?code=${code}`]) {
    assert.equal(internalTraceCodeOf(url), code)
    assert.equal(traceUrlClassification(url), 'internal')
  }
})

test('相似域名、其他路径和端口不能因包含本站字符串成为内部码', () => {
  for (const url of [`https://www.nz315.cn.evil.example/trace?code=${code}`, `https://evil.example/trace?code=${code}&site=www.nz315.cn`, `https://www.nz315.cn/other?code=${code}`, `https://www.nz315.cn:3100/trace?code=${code}`]) {
    assert.equal(internalTraceCodeOf(url), null)
    assert.equal(traceUrlClassification(url), 'external')
  }
})

test('缺位、长码、重复参数、凭据和片段均不能认作有效内部扫码链接', () => {
  for (const url of [`https://www.nz315.cn/trace?code=123`, `https://www.nz315.cn/trace?code=${code}0`, `https://www.nz315.cn/trace?code=${code}&code=${code}`, `https://user@www.nz315.cn/trace?code=${code}`, `https://@www.nz315.cn/trace?code=${code}`, `https://www.nz315.cn/trace?code=${code}#extra`, `https://www.nz315.cn/trace?code=${code}#`, `https://www.nz315.cn/other/../trace?code=${code}`, `https://www.nz315.cn/other/%2e%2e/trace?code=${code}`, `https://www.nz315.cn\\trace?code=${code}`, `https://www.nz315.cn/trace?code=${code}&bad=%zz`]) assert.equal(internalTraceCodeOf(url), null)
  assert.equal(traceUrlClassification(code), 'unparsed')
  assert.equal(internalTraceCodeOf(`javascript:alert('${code}')`), null)
})

test('本站无效码和其他页面不作为外站抓取，相似域名仍是外站', () => {
  assert.equal(isTraceWebsiteUrl('https://www.nz315.cn/trace?code=123'), true)
  assert.equal(isTraceWebsiteUrl('https://nz315.cn/other'), true)
  assert.equal(isTraceWebsiteUrl('https://www.nz315.cn.evil.example/trace?code=' + code), false)
  assert.equal(isTraceWebsiteUrl('http://127.0.0.1:3100/other', 'http://127.0.0.1:3100/trace?code='), true)
})

test('部署配置的入口精确匹配，不能靠任意本地网址代替', () => {
  const base = 'http://127.0.0.1:3100/trace?code='
  assert.equal(internalTraceCodeOf(base + code, base), code)
  assert.equal(internalTraceCodeOf(base + code), null)
  assert.equal(internalTraceCodeOf('http://127.0.0.1:3101/trace?code=' + code, base), null)
  assert.equal(internalTraceCodeOf('http://localhost:3100/trace?code=' + code, base), null)
})
