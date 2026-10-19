import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import XLSX from 'xlsx'
register('./_ts-loader.mjs', import.meta.url)
globalThis.createError = input => Object.assign(new Error(input.statusMessage), input)
const { readSpecImport, parseSpecImportRow } = await import('../server/utils/spec-import.ts')
const { specExportValues, specDetailValues, SPEC_IMPORT_HEADERS, SPEC_EXPORT_HEADERS, SPEC_DETAIL_HEADERS } = await import('../shared/utils/spec-transfer.ts')
const excel = rows => {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), '规格')
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
}
test('新模板独立数量列生成成组规格，不会退回默认单件', () => {
  const r = readSpecImport(excel([SPEC_IMPORT_HEADERS, ['', 500, '毫升', '瓶', 10], ['', 200, 'g', '袋', 20]]))
  assert.equal(r.errors.length, 0)
  assert.equal(r.okRows[0].name, '500毫升×10瓶'); assert.equal(r.okRows[0].quantity, 10)
  assert.equal(r.okRows[1].name, '200克×20袋')
})
test('旧单列、无表头单列及规格加数量两列兼容，标准别名查重', () => {
  for (const rows of [[['规格'], ['500ml/瓶×10']], [['500ml/瓶×10']], [['数量', '规格'], [10, '500ml/瓶']]]) {
    const r = readSpecImport(excel(rows)); assert.equal(r.okRows[0].name, '500毫升×10瓶'); assert.equal(r.okRows[0].quantity, 10)
  }
  const r = readSpecImport(excel([['规格'], ['500ml/瓶×10'], ['500毫升×10瓶'], ['300ml/瓶']]))
  assert.equal(r.okRows.length, 2); assert.equal(r.errors[0].row, 3); assert.match(r.errors[0].reason, /第2行/)
})
test('数量空白默认1，零负小数超限和错误值按原行号拒绝', () => {
  assert.equal(parseSpecImportRow({ 净含量: '500', 含量单位: '毫升', 包装单位: '瓶', 数量: '' }).quantity, 1)
  const r = readSpecImport(excel([SPEC_IMPORT_HEADERS, ...[0, -1, 1.5, 1000000, '错误'].map(q => ['', 500, '毫升', '瓶', q]), ['', 100, 'ml', '瓶', 2]]))
  assert.equal(r.errors.length, 5); assert.deepEqual(r.errors.map(e => e.row), [2, 3, 4, 5, 6]); assert.equal(r.okRows[0].row, 7)
})
test('净含量和数量取实际数值，不受千分位或显示四舍五入影响', () => {
  const wb = XLSX.read(excel([SPEC_IMPORT_HEADERS, ['', 1000, '毫升', '瓶', 1.5]]), { type: 'buffer' })
  wb.Sheets['规格'].B2.z = '#,##0'; wb.Sheets['规格'].E2.z = '0'
  const r = readSpecImport(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
  assert.equal(r.okRows.length, 0); assert.match(r.errors[0].reason, /数量/)
  wb.Sheets['规格'].E2.v = 10
  assert.equal(readSpecImport(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })).okRows[0].net, 1000)
})
test('名称内数量或净含量与字段冲突拒绝，不悄悄覆盖；自定义名称可保留', () => {
  for (const values of [{ 规格名称: '500ml/瓶×10', 数量: '20' }, { 规格名称: '500毫升×10瓶', 净含量: '200', 含量单位: '毫升', 包装单位: '瓶', 数量: '10' }]) assert.throws(() => parseSpecImportRow(values), /不一致/)
  assert.equal(parseSpecImportRow({ 规格名称: '大包装', 净含量: '500', 含量单位: '毫升', 包装单位: '瓶', 数量: '10' }).name, '大包装')
})
test('不全结构、非法单位、超长名称拒绝；错误行不阻断后续正确行', () => {
  const r = readSpecImport(excel([SPEC_IMPORT_HEADERS, ['', 500, '毫升', '', 10], ['', 500, '未知', '瓶', 10], ['甲'.repeat(101), 500, '毫升', '瓶', 10], ['', 500, '毫升', '瓶', 10]]))
  assert.equal(r.errors.length, 3); assert.equal(r.okRows.length, 1)
})
test('导出明细保留原数量、规格码前导零和状态，明细字段可回读新增', () => {
  const values = specDetailValues({ spec_name: '自定义包装', net_content: '500.000', content_unit: '毫升', pack_unit: '瓶', pack_quantity: 10, spec_code: '007', status: 0, enterprise_name: '甲企业' })
  assert.equal(values[4], 10); assert.equal(values[5], '007'); assert.equal(values[6], '停用')
  const r = readSpecImport(excel([SPEC_DETAIL_HEADERS, values]))
  assert.equal(r.okRows[0].quantity, 10); assert.equal(r.okRows[0].status, 0); assert.equal(r.okRows[0].name, '自定义包装')
  assert.equal(specDetailValues({ net_content: null, pack_quantity: null, spec_code: '001', status: 1 })[4], 1)
})

test('截图单列20毫升/瓶x20及130克/瓶x40直接导入，大小写乘号空格归为相同规格', () => {
  const r = readSpecImport(excel([['规格'], ['20毫升/瓶x20'], ['130克/瓶x40']]))
  assert.equal(r.errors.length, 0)
  assert.deepEqual(r.okRows.map(row => [row.net, row.unit, row.pack, row.quantity]), [[20, '毫升', '瓶', 20], [130, '克', '瓶', 40]])
  for (const raw of ['20毫升/瓶x20', ' 20 ML / 瓶 X 20 ', '20毫升/瓶×20', '20毫升/瓶✖20', '20毫升/瓶*20']) assert.equal(readSpecImport(excel([['规格'], [raw]])).okRows[0].name, '20毫升×20瓶')
})

test('导出统一为500克×20瓶标准格式，数量由实际字段生成且不修改原记录', () => {
  const row = { spec_name: '历史单件名称', net_content: '20.000', content_unit: '毫升', pack_unit: '瓶', pack_quantity: 20 }
  const original = { ...row }
  assert.deepEqual(specExportValues(row), ['20毫升×20瓶'])
  assert.deepEqual(row, original)
  assert.deepEqual(specExportValues({ net_content: 500, content_unit: '克', pack_unit: '瓶', pack_quantity: 20 }), ['500克×20瓶'])
  assert.deepEqual(specExportValues({ net_content: 130, content_unit: '克', pack_unit: '瓶', pack_quantity: 40 }), ['130克×40瓶'])
  assert.deepEqual(specExportValues({ spec_name: '500毫升/瓶x10' }), ['500毫升×10瓶'])
  assert.deepEqual(specExportValues({ spec_name: '500毫升×10瓶', pack_quantity: 1 }), ['500毫升×1瓶'])
  assert.deepEqual(specExportValues({ spec_name: '不完整自定义规格' }), [''])
  const r = readSpecImport(excel([SPEC_EXPORT_HEADERS, specExportValues(row)]))
  assert.equal(r.okRows[0].quantity, 20)
})
test('未知重复或缺失表头拒绝，公式与5001行不被静默截断', () => {
  for (const rows of [[['规格', '规格名称']], [['规格', '错误字段']], [['规格', ''], ['500ml/瓶', '丢失']], [['数量'], [10]], [SPEC_IMPORT_HEADERS]]) assert.throws(() => readSpecImport(excel(rows)), { statusCode: 400 })
  assert.throws(() => readSpecImport(excel([['规格'], ...Array.from({ length: 5001 }, () => ['500ml/瓶'])])), /5000/)
  const wb = XLSX.read(excel([['规格'], ['500ml/瓶']]), { type: 'buffer' }); wb.Sheets['规格'].A2.f = '1+1'
  assert.throws(() => readSpecImport(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })), /包含公式/)
})
