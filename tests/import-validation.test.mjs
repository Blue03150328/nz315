import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./_ts-loader.mjs', import.meta.url)
const { validateImportRows } = await import('../server/utils/import-validation.ts')
const code = '12345671001' + '0'.repeat(21)
const second = code.slice(0, -1) + '1'
const context = (existing = []) => ({ products: [{ id: 7, head: code.slice(0, 11) }], existingSet: new Set(existing) })
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
test('登记类别、生产类型和规格严格匹配产品，自定义尾部不受生成器限制', () => {
  for (const [start, end, value] of [[0, 1, '2'], [7, 8, '3'], [8, 11, '002']]) {
    const wrong = code.slice(0, start) + value + code.slice(end)
    assert.equal(validateImportRows([wrong], context(), 7).invalid, 1)
    assert.equal(validateImportRows([wrong], context()).invalid, 1)
  }
  assert.equal(validateImportRows([code.slice(0, 11) + '9'.repeat(21)], context(), 7).accepted.length, 1)
})
test('后六位相同的不同登记类别能准确归属，完整头歧义拒绝', () => {
  const ctx = context()
  ctx.products.push({ id: 8, head: '2' + code.slice(1, 11) })
  assert.deepEqual(validateImportRows(['2' + code.slice(1)], ctx).productGroups, { 8: 1 })
  ctx.products.push({ id: 9, head: code.slice(0, 11) })
  assert.equal(validateImportRows([code], ctx).invalid, 1)
})
