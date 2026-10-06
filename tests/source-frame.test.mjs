// 嵌入限制和内网地址必须拒绝，不通过代理绕过厂家限制。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
const load = async path => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(fs.readFileSync(path, 'utf8'))).toString('base64'))
const { frameAllowed } = await load('server/utils/source-frame.ts')
const { fetchSourceDocument } = await load('server/utils/source-fetch.ts')
const url = 'https://manufacturer.example/trace'
const origin = 'https://www.nz315.cn'
test('HTTPS原页仅在策略允许时展示，多个策略全部生效', () => {
  assert.equal(frameAllowed(url, origin), true)
  assert.equal(frameAllowed(url, origin, 'DENY'), false)
  assert.equal(frameAllowed(url, origin, 'SAMEORIGIN'), false)
  assert.equal(frameAllowed(url, origin, '', "frame-ancestors 'self'"), false)
  assert.equal(frameAllowed(url, origin, '', "frame-ancestors 'none'"), false)
  assert.equal(frameAllowed(url, origin, '', 'frame-ancestors https://www.nz315.cn'), true)
  assert.equal(frameAllowed(url, origin, '', "frame-ancestors https://www.nz315.cn, frame-ancestors 'none'"), false)
  assert.equal(frameAllowed(url, origin, '', 'frame-ancestors https://www.nz315.cn.evil.com'), false)
  assert.equal(frameAllowed('http://manufacturer.example/trace', origin), false)
  assert.equal(frameAllowed(url, 'http://localhost:3100', '', 'frame-ancestors https:'), false)
})
test('HEAD探测仍通过逐跳公网守卫，拒绝本机和明文连接', async () => {
  await assert.rejects(fetchSourceDocument('https://127.0.0.1/', undefined, { method: 'HEAD', httpsOnly: true }), /公网地址/)
  await assert.rejects(fetchSourceDocument('http://example.com/', undefined, { method: 'HEAD', httpsOnly: true }), /安全连接/)
})
