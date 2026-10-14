import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

// 执行实际扫码实现，以可控的相机/帧队列复现异步识别跨越多个显示帧。
const source = readFileSync(new URL('../app/composables/useQrScanner.ts', import.meta.url), 'utf8')
const code = transformSync(source.replace("import('@zxing/library/esm/index.js')", 'loadZxing()'), {
  loader: 'ts', format: 'cjs', define: { 'import.meta.client': 'true' },
}).code
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup() {
  let now = 1000, nextId = 0, stoppedTracks = 0, detected = 0
  const frames = new Map(), requests = [], hits = []
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(0) }) }) }
  const stream = { getTracks: () => [{ stop: () => { stoppedTracks++ } }] }
  const video = { videoWidth: 1280, videoHeight: 720, srcObject: null }
  const context = {
    module: { exports: {} }, ref: value => ({ value }),
    window: { isSecureContext: true, BarcodeDetector: class {
      detect() { detected++; const request = deferred(); requests.push(request); return request.promise }
    } },
    navigator: { userAgent: 'MicroMessenger', mediaDevices: { getUserMedia: async () => stream } },
    document: { createElement: () => canvas },
    Date: { now: () => now }, setTimeout,
    requestAnimationFrame: cb => { frames.set(++nextId, cb); return nextId },
    cancelAnimationFrame: id => frames.delete(id),
    loadZxing: async () => { throw new Error('模拟首次解码分包加载失败') },
  }
  vm.runInNewContext(code, context)
  const scanner = context.module.exports.useQrScanner()
  scanner.mount(video)
  scanner.onResult((value, raw) => hits.push({ value, raw }))
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
  const tick = async () => {
    now += 200
    const batch = [...frames.values()]; frames.clear()
    for (const cb of batch) Promise.resolve(cb()).catch(() => {})
    await flush()
  }
  return { scanner, requests, hits, tick, flush, frames, context,
    detected: () => detected, stoppedTracks: () => stoppedTracks }
}

test('异步识别超过一显示帧时仍持续扫描，且不会并发解码', async () => {
  const h = setup()
  await h.scanner.start()
  await h.tick()
  await h.tick()
  await h.tick()
  assert.equal(h.detected(), 1)
  assert.equal(h.frames.size, 1, '等待解码时必须保留下一帧，否则相机仍开着却不再识别')
  h.requests[0].reject(new Error('模拟原生识别失败'))
  await h.flush()
  await h.tick()
  assert.equal(h.detected(), 2, '原生失败和分包失败后仍能继续识别')
  h.requests[1].resolve([{ rawValue: '12345678901234567890123456789012' }])
  await h.flush()
  assert.equal(h.hits.length, 1)
  assert.equal(h.scanner.phase.value, 'success')
  assert.equal(h.frames.size, 0)
  assert.equal(h.stoppedTracks(), 1)
})

test('离开扫码页后，迟到的识别结果不能触发查询', async () => {
  const h = setup()
  await h.scanner.start()
  await h.tick()
  h.scanner.stop()
  h.requests[0].resolve([{ rawValue: '12345678901234567890123456789012' }])
  await h.flush()
  assert.equal(h.hits.length, 0)
  assert.equal(h.scanner.phase.value, 'idle')
  assert.equal(h.frames.size, 0)
})

test('停止后重开相机，上一轮结果不能结束新一轮扫描', async () => {
  const h = setup()
  await h.scanner.start()
  await h.tick()
  h.scanner.stop()
  await h.scanner.start()
  h.requests[0].resolve([{ rawValue: '12345678901234567890123456789012' }])
  await h.flush()
  assert.equal(h.hits.length, 0)
  assert.equal(h.scanner.phase.value, 'scanning')
  await h.tick()
  assert.equal(h.detected(), 2)
  h.scanner.stop()
})

test('请求相机期间离开页面，迟到的相机授权必须释放', async () => {
  const h = setup(), request = deferred()
  h.context.navigator.mediaDevices.getUserMedia = () => request.promise
  const starting = h.scanner.start()
  h.scanner.stop()
  request.resolve({ getTracks: () => [{ stop: () => h.context.released = true }] })
  await starting
  assert.equal(h.context.released, true)
  assert.equal(h.scanner.phase.value, 'idle')
  assert.equal(h.frames.size, 0)
})

test('完整厂家网址仍通过原文回调查询，识别成功只回调一次', async () => {
  const h = setup(), rawHits = []
  h.scanner.onRawResult(raw => rawHits.push(raw))
  await h.scanner.start()
  await h.tick()
  h.requests[0].resolve([{ rawValue: 'https://example.com/query?sn=123' }])
  await h.flush()
  await h.tick()
  assert.deepEqual(rawHits, ['https://example.com/query?sn=123'])
  assert.equal(h.scanner.phase.value, 'success')
  assert.equal(h.frames.size, 0)
})
