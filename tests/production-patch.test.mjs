import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./_ts-loader.mjs', import.meta.url)
const { productionPatch } = await import('../server/utils/production-patch.ts')
const { assertBindingAllowed, assertCodesCorrectable } = await import('../server/utils/binding-guard.ts')
globalThis.createError = input => Object.assign(new Error(input.statusMessage), input)
test('只修正明确填写字段，生产日期不隐式改有效期', () => {
  assert.deepEqual(productionPatch({ produceDate: '2026-10-04', expireDate: '', qcResult: null }), { produce_date: '2026-10-04' })
  assert.deepEqual(productionPatch({ expireDate: '2028-10-05' }), { expire_date: '2028-10-05' })
  assert.deepEqual(productionPatch({ qualityCertNo: ' 新证号 ' }), { quality_cert_no: '新证号' })
  for (const body of [{ produceDate: '2026-02-30' }, { expireDate: 2026 }, { qcResult: '2' }]) assert.throws(() => productionPatch(body))
})
test('冻结/作废拒绝修正，质检和三要素不能绕过，登记证到期不阻断', () => {
  for (const flag of [1, 2]) assert.throws(() => assertCodesCorrectable([{ abnormal_flag: flag }]))
  const batch = { product_id: 7, enterprise_id: 1, batch_no: 'B', produce_date: '2026-10-05', quality_cert_no: 'Q', qc_result: 1, registration_expire: '2020-01-01' }
  assert.doesNotThrow(() => assertBindingAllowed(batch, 7, 1))
  for (const qc of [0, null, undefined, 2]) assert.throws(() => assertBindingAllowed({ ...batch, qc_result: qc }, 7, 1))
  assert.throws(() => assertBindingAllowed(batch, 8, 1))
  assert.throws(() => assertBindingAllowed(batch, 7, 2))
  assert.throws(() => assertBindingAllowed({ ...batch, produce_date: '2026-02-30' }, 7, 1))
})
