import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { register } from 'node:module'
import XLSX from 'xlsx'
import { createError } from 'h3'
register('./_ts-loader.mjs', import.meta.url)
globalThis.createError = createError
const { readProductImport, prepareImportedProduct, normalizeProductSpecCode, productImportToday } = await import('../server/utils/product-import-input.ts')
const { fillProductTemplate } = await import('../server/utils/product-template.ts')
const { PRODUCT_IMPORT_HEADERS: headers } = await import('../shared/utils/product-import.ts')
const { PRODUCT_EXPORT_HEADERS } = await import('../shared/utils/product-export.ts')
const { parseProductOriginals } = await import('../server/utils/product-originals.ts')
const registry = { product_name: '甲·乙·丙', category: '杀虫剂', content: '30%', dosage: '悬浮剂', toxicity: '低毒', company: '登记企业', expire_date: '2099-12-31', ingredient_main: '甲', ingredient_all: ['甲', '乙', '丙'] }
const spec = { net_content: 500, content_unit: '毫升', pack_unit: '瓶', pack_quantity: 20 }
const original = ingredient => ({ dosage: '原药', ingredient_main: ingredient, ingredient_all: [ingredient], company: '原药企业' + ingredient, expire_date: '2099-12-31' })
const originals = new Map([['PD1', original('甲')], ['PD2', original('乙')], ['PD3', original('丙')]])
const valid = { 生产类型: '持有人生产', 登记证号: 'pd20991234', 产标名: '测试牌', 规格代码: '001', 原药登记证号1: 'pd1' }
const prepare = (values = valid, reg = registry, map = originals) => prepareImportedProduct(values, reg, spec, map, '2026-10-17')
const encode = (rows, mutate, bookType = 'xlsx') => {
  const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(book, sheet, '产品导入')
  mutate?.(book, sheet)
  return XLSX.write(book, { type: 'buffer', bookType })
}
const row = values => headers.map(h => values[h] ?? '')

test('导出保留七列并附备注，重导入忽略备注，旧商标别名和任意列序兼容', () => {
  assert.deepEqual(headers, ['生产类型', '登记证号', '产标名', '规格代码', '原药登记证号1', '原药登记证号2', '原药登记证号3'])
  assert.deepEqual(headers, PRODUCT_EXPORT_HEADERS.slice(0, 7))
  const exported = readProductImport(encode([PRODUCT_EXPORT_HEADERS, [...row(valid), '农药名称 · 500克×20瓶'], ['', '', '', '', '', '', '', '仅备注']]))
  assert.equal(exported.length, 1)
  assert.deepEqual(exported[0].values, Object.fromEntries(headers.map(h => [h, valid[h] ?? ''])))
  for (const alias of ['产标名', '产品商标', '商标']) {
    const columns = ['规格代码', alias, '登记证号', '原药登记证号1', '生产类型']
    const rows = readProductImport(encode([columns, [], ['001', '甲牌', 'PD1', 'PD2', '委托加工']]))
    assert.equal(rows[0].row, 3); assert.equal(rows[0].values['产标名'], '甲牌')
  }
})

test('七列表头可删可选列，但必填列必须存在；旧22列、重复别名和第四原药拒绝', () => {
  const minimal = ['生产类型', '登记证号', '规格代码', '原药登记证号1']
  assert.equal(readProductImport(encode([minimal, ['1', 'PD1', '001', 'PD2']])).length, 1)
  for (const columns of [[], ['产品名称'], [...minimal, '原药登记证号4'], [...minimal, '产标名', '产品商标'], [...minimal, '未知列'], ['登记证号', '规格', '原药1生产企业']]) assert.throws(() => readProductImport(encode([columns, []])), { statusCode: 400 })
})

test('无表头数据、公式含空结果、公式表头和只有表头的文件整批拒绝', () => {
  assert.throws(() => readProductImport(encode([headers])), /没有产品数据/)
  assert.throws(() => readProductImport(encode([[...headers.slice(0, 6), ''], [...row(valid).slice(0, 6), '丢失数据']])), /缺少表头/)
  assert.throws(() => readProductImport(encode([headers, row(valid)], (_, s) => { s.D2.f = '1+1' })), /包含公式/)
  assert.throws(() => readProductImport(encode([headers, []], (_, s) => { s.A2 = { t: 's', v: '', f: 'IF(1=1,"","1")' }; s['!ref'] = 'A1:G2' })), /包含公式/)
  assert.throws(() => readProductImport(encode([headers, row(valid)], (_, s) => { s.A1.f = '1+1' })), /表头包含公式/)
})

test('xlsx及xls保留证号前导零，数值代码读取实际值而非显示取整', () => {
  for (const format of ['xlsx', 'xls']) {
    const parsed = readProductImport(encode([headers, row(valid)], undefined, format))
    assert.equal(parsed[0].values['规格代码'], '001')
  }
  const rows = readProductImport(encode([headers, row({ ...valid, 规格代码: 1.5 })], (_, s) => { s.D2.z = '0' }))
  assert.equal(rows[0].values['规格代码'], '1.5')
  assert.throws(() => normalizeProductSpecCode(rows[0].values['规格代码']))
  for (const value of ['1', 1, '01', '001']) assert.equal(normalizeProductSpecCode(value), '001')
  for (const value of ['', '000', 0, 1000, -1, '1.0', '1e0', '500克×20瓶']) assert.throws(() => normalizeProductSpecCode(value))
})

test('单次1000行边界，不静默截断1001行；其他工作表不参与导入', () => {
  const thousand = Array.from({ length: 1000 }, () => row(valid))
  assert.equal(readProductImport(encode([headers, ...thousand])).length, 1000)
  assert.throws(() => readProductImport(encode([headers, ...thousand, row(valid)])), /最多导入1000行/)
  assert.equal(readProductImport(encode([headers, row(valid)], book => { XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['无效数据']]), '其他') })).length, 1)
})

test('产品与三原药精确补齐名称、企业及成分，原药2空而3有值保留实际填写顺序', () => {
  const p = prepare({ ...valid, 原药登记证号2: 'pd2', 原药登记证号3: 'PD3' })
  assert.equal(p.name, '（测试牌）30%甲·乙·丙悬浮剂 500毫升×20瓶')
  assert.equal(p.registrationNo, 'PD20991234'); assert.equal(p.holderName, '登记企业')
  assert.deepEqual(p.originals.map(o => [o.regNo, o.company, o.ingredient]), [['PD1', '原药企业甲', '甲'], ['PD2', '原药企业乙', '乙'], ['PD3', '原药企业丙', '丙']])
  assert.deepEqual(p.warnings, [])
  assert.deepEqual(prepare({ ...valid, 原药登记证号3: 'PD3' }).originals.map(o => o.regNo), ['PD1', 'PD3'])
  assert.equal(prepare({ ...valid, 产标名: '' }).trademark, '')
})

test('生产类型必填，三种文字与数字均映射，产品资料不能由旧列覆盖', () => {
  for (const [input, expected] of [['持有人生产', 1], ['委托加工', 2], ['委托分装', 3], ['1', 1], ['2', 2], ['3', 3]]) assert.equal(prepare({ ...valid, 生产类型: input }).produceType, expected)
  for (const value of ['', '其他', 'constructor', '4']) assert.throws(() => prepare({ ...valid, 生产类型: value }))
  assert.equal(prepare({ ...valid, 产品名称: '伪造资料' }).name.startsWith('伪造资料'), false)
})

test('产品与原药证号未收录、原药非原药母药及缺少登记企业时拒绝', () => {
  assert.throws(() => prepare(valid, null), /未被登记资料库收录/)
  assert.throws(() => prepare({ ...valid, 原药登记证号1: 'PD未知' }), /未被登记资料库收录/)
  assert.throws(() => prepare(valid, registry, new Map([['PD1', { ...original('甲'), dosage: '悬浮剂' }]])), /不是原药或母药/)
  assert.throws(() => prepare(valid, registry, new Map([['PD1', { ...original('甲'), company: '' }]])), /请填写/)
  assert.equal(prepare(valid, registry, new Map([['PD1', { ...original('甲'), dosage: '母药' }]])).originals.length, 1)
})

test('过期按北京时间日界判断，截止当天可用，错误有效期拒绝', () => {
  assert.equal(productImportToday(new Date('2026-10-16T16:00:00Z')), '2026-10-17')
  assert.equal(productImportToday(new Date('2026-10-16T15:59:59Z')), '2026-10-16')
  assert.equal(prepare(valid, { ...registry, expire_date: '2026-10-17' }).registrationExpire, '2026-10-17')
  for (const value of ['2026-10-16', '2026-02-30', '坏日期']) assert.throws(() => prepare(valid, { ...registry, expire_date: value }), /过期|有效期无效/)
  assert.throws(() => prepare(valid, registry, new Map([['PD1', { ...original('甲'), expire_date: '2026-10-16' }]])), /原药登记证.*已过期/)
})

test('重复原药大小写归一后拒绝，缺原药1及超长字段拒绝，接口上限保持三种', () => {
  assert.throws(() => prepare({ ...valid, 原药登记证号2: 'PD1' }), /不能重复/)
  assert.throws(() => prepare({ ...valid, 原药登记证号1: '', 原药登记证号2: 'PD2' }), /请填写原药登记证号1/)
  assert.throws(() => prepare({ ...valid, 产标名: '甲'.repeat(101) }), /不能超过100字/)
  assert.throws(() => parseProductOriginals(Array.from({ length: 4 }, () => ({ regNo: 'PD1', company: '甲' }))), /最多填写3种/)
})

test('原药成分错配拒绝；缺复配成分来源、缺有效期或主产品成分给明确核对提示', () => {
  assert.throws(() => prepare(valid, registry, new Map([['PD1', original('丁')]])), /与产品不匹配/)
  assert.throws(() => prepare(valid, registry, new Map([['PD1', { ...original('甲'), ingredient_main: '', ingredient_all: [] }]])), /缺少有效成分/)
  assert.match(prepare().warnings.join(''), /乙、丙/)
  assert.match(prepare(valid, { ...registry, expire_date: null }).warnings.join(''), /未提供有效期/)
  assert.match(prepare(valid, { ...registry, ingredient_main: '', ingredient_all: [] }).warnings.join(''), /缺少有效成分/)
})

test('动态厂家模板保留其他工作表、格式、下拉与冻结行，规格对照精确隔离并转义文本', () => {
  const template = fs.readFileSync('server/assets/product-import-template.xlsx')
  const filled = fillProductTemplate(template, [{ spec_code: '001', spec_name: '500克×20瓶' }, { spec_code: '002', spec_name: '<自定义>&包装' }], '厂家<甲>&有限公司')
  const before = XLSX.read(template, { type: 'buffer', bookFiles: true })
  const after = XLSX.read(filled, { type: 'buffer', bookFiles: true })
  assert.deepEqual(after.SheetNames, ['产品导入', '填写说明', '规格对照'])
  assert.deepEqual(XLSX.utils.sheet_to_json(after.Sheets['产品导入'], { header: 1 })[0], headers)
  const refs = XLSX.utils.sheet_to_json(after.Sheets['规格对照'], { header: 1 })
  assert.deepEqual(refs[1], ['001', '500克×20瓶', '厂家<甲>&有限公司', '启用'])
  assert.equal(refs[2][1], '<自定义>&包装')
  const content = (book, name) => Buffer.from(book.files[name].content).toString('utf8')
  for (const name of ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/styles.xml', 'xl/workbook.xml']) assert.equal(content(after, name), content(before, name))
  assert.match(content(after, 'xl/worksheets/sheet1.xml'), /dataValidation/)
  assert.match(content(after, 'xl/worksheets/sheet1.xml'), /pane/)
  assert.equal(after.Sheets['产品导入'].A2?.v || '', '')
  const empty = XLSX.read(fillProductTemplate(template, [], '空企业'), { type: 'buffer' })
  assert.match(empty.Sheets['规格对照'].B2.v, /暂无启用规格/)
})
