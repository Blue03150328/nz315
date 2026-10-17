import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import XLSX from 'xlsx'
register('./_ts-loader.mjs', import.meta.url)
globalThis.createError = input => Object.assign(new Error(input.statusMessage), input)
const { productExportValues, PRODUCT_EXPORT_HEADERS } = await import('../shared/utils/product-export.ts')
const { productFilters } = await import('../server/utils/product-filter.ts')
const product = { produce_type: 1, registration_no: 'PD20991234', trademark: '甲牌', spec_code: '001' }

test('产品导出七列与已确认的产品商标字段对应，原药固定三列且不合并', () => {
  assert.deepEqual(PRODUCT_EXPORT_HEADERS, ['生产类型', '登记证号', '产标名', '规格代码', '原药登记证号1', '原药登记证号2', '原药登记证号3'])
  assert.deepEqual(productExportValues(product, ['原药甲', '原药乙', '原药丙']), ['持有人生产', 'PD20991234', '甲牌', '001', '原药甲', '原药乙', '原药丙'])
  assert.deepEqual(productExportValues(product, ['原药甲']).slice(4), ['原药甲', '', ''])
  assert.deepEqual(productExportValues(product, []).slice(4), ['', '', ''])
})
test('生产类型三种明确映射，历史空字段与未知值不伪造', () => {
  for (const [type, name] of [[1, '持有人生产'], [2, '委托加工'], [3, '委托分装'], [null, ''], [9, '9']]) assert.equal(productExportValues({ ...product, produce_type: type }, [])[0], name)
  assert.deepEqual(productExportValues({}, []), ['', '', '', '', '', '', ''])
})
test('Excel代码前导零与重复原药顺序保留，文本不被写成公式', () => {
  const values = productExportValues({ ...product, trademark: '=1+1' }, ['PD甲', 'PD甲', 'PD乙'])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([PRODUCT_EXPORT_HEADERS, values]), '产品导出')
  const saved = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' }).Sheets['产品导出']
  assert.equal(saved.D2.v, '001'); assert.equal(saved.D2.t, 's')
  assert.equal(saved.C2.v, '=1+1'); assert.equal(saved.C2.f, undefined)
  assert.deepEqual(XLSX.utils.sheet_to_json(saved, { header: 1 })[1].slice(4), ['PD甲', 'PD甲', 'PD乙'])
})
test('普通企业伪造enterpriseId仍按自己范围筛选，总部企业参数严格校验', () => {
  const own = productFilters({ role: 'enterprise_admin', enterprise_id: 7 }, { enterpriseId: 9 })
  assert.deepEqual(own.params, [7]); assert.match(own.whereSql, /p.enterprise_id = \?/)
  assert.deepEqual(productFilters({ role: 'platform_admin' }, { enterpriseId: 9 }).params, [9])
  for (const id of ['错误', 0, -1, 1.5]) assert.throws(() => productFilters({ role: 'platform_admin' }, { enterpriseId: id }), /企业筛选无效/)
})
test('产品关键词、类别、状态、规格与ID均参数化，导出页码不缩小范围', () => {
  const filters = productFilters({ role: 'viewer', enterprise_id: 7 }, { keyword: "' OR 1=1 --", category: '杀虫剂', status: '0', specId: 8, productId: 9, page: 100, pageSize: 1 })
  assert.ok(!filters.whereSql.includes('OR 1=1 --'))
  assert.deepEqual(filters.params, [7, ...Array(5).fill("%' OR 1=1 --%"), '杀虫剂', 0, 8, 9])
  assert.ok(!filters.whereSql.includes('LIMIT'))
  assert.throws(() => productFilters({ role: 'viewer', enterprise_id: 7 }, { productId: '错误' }), /产品编号无效/)
})
