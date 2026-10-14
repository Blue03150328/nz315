import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./_ts-loader.mjs', import.meta.url)
const { formatProductName, productWithSpec } = await import('../shared/utils/product-name.ts')
const spec = { net_content: 500, content_unit: '毫升', pack_unit: '瓶', pack_quantity: 10 }

test('单剂和双成分均按商标、总含量、完整登记名称、剂型、规格命名', () => {
  assert.equal(formatProductName({ name: '吡虫啉', content: '25%', dosage: '悬浮剂', trademark: '绿丰', spec }), '（绿丰）25%吡虫啉悬浮剂 500毫升×10瓶')
  assert.equal(formatProductName({ name: '甲·乙', content: '30%', dosage: '悬浮剂', trademark: '（绿丰）', spec }), '（绿丰）30%甲·乙悬浮剂 500毫升×10瓶')
})
test('已带含量及剂型不重复，缺字段不造资料，下拉规格不重复', () => {
  assert.equal(formatProductName({ name: '30%甲·乙悬浮剂', content: '30%', dosage: '悬浮剂', spec }), '30%甲·乙悬浮剂 500毫升×10瓶')
  assert.equal(formatProductName({ name: '甲·乙' }), '甲·乙')
  assert.equal(formatProductName({ name: '', trademark: '绿丰', spec }), '')
  assert.equal(productWithSpec({ name: '甲·乙 500毫升×10瓶', spec_name: '500毫升×10瓶' }), '甲·乙 500毫升×10瓶')
  assert.equal(productWithSpec({ name: '甲·乙 500毫升×10瓶', spec_name: '500毫升/瓶×10' }), '甲·乙 500毫升×10瓶')
})
