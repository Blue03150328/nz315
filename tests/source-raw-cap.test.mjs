// node --test tests/source-raw-cap.test.mjs；纯函数、不访问外站、不碰数据库。
// 覆盖 `external_source_snapshot` 存储放大收口的三条策略（原文上限 + 两级缓存 TTL）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

const load = async p => {
  const code = stripTypeScriptTypes(fs.readFileSync(p, 'utf8'))
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
}
const { capRawDocument, RAW_DOCUMENT_MAX_BYTES, SUCCESS_CACHE_MINUTES, FAILURE_CACHE_MINUTES } =
  await load('server/utils/source-raw-cap.ts')

test('策略常量：原文上限 64KB；失败缓存 TTL 必须显著短于成功（否则瞬时故障会卡住十分钟）', () => {
  assert.equal(RAW_DOCUMENT_MAX_BYTES, 64 * 1024)
  assert.equal(SUCCESS_CACHE_MINUTES, 10)   // 维持线 B 上线时的口径
  assert.ok(FAILURE_CACHE_MINUTES > 0, '失败也必须进缓存，否则每次重试都重新抓取 + 重新落行')
  assert.ok(FAILURE_CACHE_MINUTES < SUCCESS_CACHE_MINUTES, '失败 TTL 必须更短')
})

test('没超上限时原样返回；空值统一给空串（调用方据此落 NULL）', () => {
  assert.equal(capRawDocument('<html>小页面</html>'), '<html>小页面</html>')
  assert.equal(capRawDocument(''), '')
  assert.equal(capRawDocument(null), '')
  assert.equal(capRawDocument(undefined), '')
})

test('正好等于上限时不得截断（边界不许差一个字节）', () => {
  const exact = 'a'.repeat(RAW_DOCUMENT_MAX_BYTES)
  const out = capRawDocument(exact)
  assert.equal(out, exact)
  assert.equal(Buffer.byteLength(out, 'utf8'), RAW_DOCUMENT_MAX_BYTES)
  assert.equal(capRawDocument(exact + 'b').length, RAW_DOCUMENT_MAX_BYTES, '多一个字节才该截')
})

test('超限时按字节截断，结果不超过上限', () => {
  const big = 'a'.repeat(RAW_DOCUMENT_MAX_BYTES * 3)
  const out = capRawDocument(big)
  assert.equal(Buffer.byteLength(out, 'utf8'), RAW_DOCUMENT_MAX_BYTES)
})

test('🔴 不得把多字节字符切成半个：中文（3 字节）与 emoji（4 字节）都要落在字符边界上', () => {
  // 中文「中」= E4 B8 AD ⇒ 边界在 0/3/6/9…；maxBytes=10 会落在第 4 个字的第 2 个字节上
  const cn = capRawDocument('中'.repeat(20), 10)
  assert.equal(Buffer.byteLength(cn, 'utf8'), 9, '应回退到 9 字节（3 个字）')
  assert.equal(cn, '中中中')
  assert.ok(!cn.includes('\uFFFD'), '回退失败会产生替换字符（半个字）')

  // emoji「😀」= F0 9F 98 80 ⇒ 边界在 0/4/8…；maxBytes=10 落在第 3 个字的第 3 个字节上
  const emoji = capRawDocument('😀'.repeat(10), 10)
  assert.equal(Buffer.byteLength(emoji, 'utf8'), 8, '应回退到 8 字节（2 个字）')
  assert.equal(emoji, '😀😀')
  assert.ok(!emoji.includes('\uFFFD'))
})

test('真实形态：截断后仍是合法 UTF-8，且能原样再编码回去（落库不会变乱码）', () => {
  const html = '<html><body>' + '<div class="label">登记证持有人</div><div class="value">某某农业科技有限公司</div>'.repeat(4000) + '</body></html>'
  assert.ok(Buffer.byteLength(html, 'utf8') > RAW_DOCUMENT_MAX_BYTES, '构造的样本必须真的超限，否则这条测试是空转')
  const out = capRawDocument(html)
  assert.ok(Buffer.byteLength(out, 'utf8') <= RAW_DOCUMENT_MAX_BYTES)
  assert.ok(out.startsWith('<html><body>'), '从头上截，不要动开头')
  assert.ok(!out.includes('\uFFFD'))
  assert.equal(Buffer.from(out, 'utf8').toString('utf8'), out, '往返编码必须一致')
})
