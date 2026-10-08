import test from 'node:test'
import assert from 'node:assert/strict'
import { PRODUCT_HEADERS, sourceDate, selectLatest, checkFreshness, syncDue, normalizeSnapshot,
  rowsFromSheet } from '../scripts/alpha-sync/core.mjs'

const product = (sku = '100') => ({ ...Object.fromEntries(PRODUCT_HEADERS.map(header => [header, ''])),
  '商品ID': '10', '商品名称': '测试商品', 'SKU ID': sku, '销售价': '0.00', '规格值': '100克' })
const listing = { '店铺ID': '20', '店铺名称': '测试店铺', '商品ID': '10', '商品名称': '测试商品' }

test('按采集日期选择最新阿尔法文件，不把其它平台或临时文件混入', () => {
  assert.equal(selectLatest(['抢农资产品价格表_2026-10-08.xlsx',
    '阿尔法农资全平台产品价格表_2026-10-05.xlsx', '阿尔法农资全平台产品价格表_2026-10-07.xlsx',
    '~$阿尔法农资全平台产品价格表_2026-10-08.xlsx']), '阿尔法农资全平台产品价格表_2026-10-07.xlsx')
})

test('非法日期和最新候选损坏命名不能默默回退旧文件', () => {
  assert.throws(() => sourceDate('阿尔法农资全平台产品价格表_2026-02-30.xlsx'), /日期/)
  assert.throws(() => selectLatest(['阿尔法农资全平台产品价格表_2026-10-07.xlsx',
    '阿尔法农资全平台产品价格表_错误.xlsx']), /日期/)
})

test('按北京时间判断新鲜度，拒绝未来与过旧采集', () => {
  const now = new Date('2026-10-07T16:30:00Z')
  assert.doesNotThrow(() => checkFreshness('2026-10-04', now))
  assert.throws(() => checkFreshness('2026-10-03', now), /最近/)
  assert.throws(() => checkFreshness('2026-10-09', now), /最近/)
})

test('15天边界、首次同步和失败未推进的周期', () => {
  const completed = new Date('2026-10-08T01:00:00Z')
  assert.equal(syncDue(null, completed), true)
  assert.equal(syncDue(completed, new Date('2026-10-23T00:59:59Z')), false)
  assert.equal(syncDue(completed, new Date('2026-10-23T01:00:00Z')), true)
})

test('空价格保存为空，零价格保存为零，保留全部30个来源字段', () => {
  const { products } = normalizeSnapshot([product()], [listing])
  assert.equal(products[0][7], null)
  assert.equal(products[0][10], '0.00')
  assert.equal(Object.keys(JSON.parse(products[0][14])).length, 30)
})

test('重复SKU、空SKU、非数字标识必须整份拒绝', () => {
  assert.throws(() => normalizeSnapshot([product(), product()], [listing]), /重复/)
  assert.throws(() => normalizeSnapshot([product('')], [listing]), /为空/)
  assert.throws(() => normalizeSnapshot([product('1e9')], [listing]), /数字标识/)
})

test('非法金额与超过数据库精度的金额不能悄悄转成零或四舍五入', () => {
  for (const value of ['-1', '价格待定', '1.12345', '123456789012345.00']) {
    assert.throws(() => normalizeSnapshot([{ ...product(), '销售价': value }], [listing]), /非负价格/)
  }
})

test('任意表为空、重复店铺商品关系、过长名称拒绝写库', () => {
  assert.throws(() => normalizeSnapshot([], [listing]), /为空/)
  assert.throws(() => normalizeSnapshot([product()], []), /为空/)
  assert.throws(() => normalizeSnapshot([product()], [listing, listing]), /重复/)
  assert.throws(() => normalizeSnapshot([{ ...product(), '商品名称': '字'.repeat(501) }], [listing]), /过长/)
})

test('按表头名称映射，表头重排不误读，缺列和重复列拒绝', () => {
  const reader = { utils: { sheet_to_json: sheet => sheet.map(row => [...row]) } }
  assert.deepEqual(rowsFromSheet(reader, [['SKU ID', '商品ID'], ['100', '10']], ['商品ID', 'SKU ID'], '测试'),
    [{ 'SKU ID': '100', '商品ID': '10' }])
  assert.throws(() => rowsFromSheet(reader, [['SKU ID'], ['100']], ['商品ID', 'SKU ID'], '测试'), /表头/)
  assert.throws(() => rowsFromSheet(reader, [['SKU ID', 'SKU ID'], ['100', '200']], ['SKU ID'], '测试'), /表头/)
})
