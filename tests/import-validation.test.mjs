import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./_ts-loader.mjs', import.meta.url)
const { validateImportRows } = await import('../server/utils/import-validation.ts')
const code = '12345671001' + '0'.repeat(21)
const second = code.slice(0, -1) + '1'
const context = (existing = []) => ({ regLast6Map: new Map([['234567', 7]]), specCodeSet: new Set(['001']), existingSet: new Set(existing) })
test('空行和表头忽略，预览保留原始行号', () => {
  const r = validateImportRows(['', 'sn,农药名称', code, 'bad'], context(), 7)
  assert.equal(r.ignored, 2)
  assert.equal(r.total, 2)
  assert.deepEqual(r.accepted, [code])
  assert.equal(r.preview[1].lineNumber, 4)
  assert.equal(r.preview[1].reason, '未识别到 32 位追溯码')
})
test('文件内重复和库内重复不会被算作可入库码', () => {
  const r = validateImportRows([code, code, second], context([second]), 7)
  assert.equal(r.duplicate, 2)
  assert.equal(r.accepted.length, 1)
  assert.deepEqual(r.preview.slice(1).map(x => x.reason), ['文件内重复码', '重复码'])
})
test('其他产品码拒绝，统计数量守恒', () => {
  const r = validateImportRows([code, 'bad', second], context([second]), 8)
  assert.equal(r.preview[0].reason, '码归属与所选产品不一致')
  assert.equal(r.total, r.accepted.length + r.duplicate + r.invalid)
  assert.equal(r.accepted.length, 0)
})
test('预览限制20条，失败总数仍包含全部输入', () => {
  const r = validateImportRows(Array(30).fill('bad'), context())
  assert.equal(r.preview.length, 20)
  assert.equal(r.invalid, 30)
  assert.equal(r.reasonCount['未识别到 32 位追溯码'], 30)
})
