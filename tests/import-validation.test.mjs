import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./_ts-loader.mjs', import.meta.url)
const { validateImportRows } = await import('../server/utils/import-validation.ts')
const { csvCell } = await import('../shared/utils/import-csv.ts')
const code = '12345671001' + '0'.repeat(21)
const second = code.slice(0, -1) + '1'
const context = (existing = []) => ({ regLast6Map: new Map([['234567', 7]]), specCodeSet: new Set(['001']), existingSet: new Set(existing) })
test('空行和表头忽略，失败明细保留原始行号', () => {
  const r = validateImportRows(['', 'sn,农药名称', code, 'bad'], context(), 7)
  assert.equal(r.ignored, 2)
  assert.equal(r.total, 2)
  assert.deepEqual(r.accepted, [code])
  assert.equal(r.rejected[0].lineNumber, 4)
  assert.equal(r.rejected[0].reasonCode, 'INVALID_CODE')
})
test('文件内重复和库内重复不会被算作可入库码', () => {
  const r = validateImportRows([code, code, second], context([second]), 7)
  assert.equal(r.duplicate, 2)
  assert.equal(r.accepted.length, 1)
  assert.deepEqual(r.rejected.map(x => x.reasonCode), ['DUPLICATE_FILE', 'DUPLICATE_DATABASE'])
})
test('其他产品码拒绝，统计数量守恒', () => {
  const r = validateImportRows([code, 'bad', second], context([second]), 8)
  assert.equal(r.rejected[0].reasonCode, 'PRODUCT_MISMATCH')
  assert.equal(r.total, r.accepted.length + r.duplicate + r.invalid)
  assert.equal(r.accepted.length, 0)
})
test('预览只有20条，完整失败明细不丢失', () => {
  const r = validateImportRows(Array(30).fill('bad'), context())
  assert.equal(r.preview.length, 20)
  assert.equal(r.rejected.length, 30)
  assert.equal(r.rejected[29].lineNumber, 30)
})
test('CSV 防公式执行、转义引号及长码文本输出', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"')
  assert.equal(csvCell('a"b'), '"a""b"')
  assert.equal(csvCell(code), '"\'' + code + '"')
})
