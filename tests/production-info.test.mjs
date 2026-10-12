import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./_ts-loader.mjs', import.meta.url)
const { chinaDate, effectiveProduction, isExpired } = await import('../shared/utils/production-info.ts')
test('展示与判定使用单码覆盖，有效期未覆盖时回退批次', () => {
  const batch = { expire_date: '2028-10-05' }
  const info = effectiveProduction({ expire_date: '2020-01-01' }, batch)
  assert.equal(info.expireDate, '2020-01-01')
  assert.equal(isExpired(info.expireDate, '2026-10-05'), true)
  assert.equal(effectiveProduction({}, batch).expireDate, '2028-10-05')
  assert.equal(isExpired(effectiveProduction({ expire_date: '2028-10-05' }, { expire_date: '2020-01-01' }).expireDate, '2026-10-05'), false)
})
test('北京时间跨日、到期当天、空日期与非法日期', () => {
  assert.equal(chinaDate(new Date('2026-10-04T16:00:00Z')), '2026-10-05')
  assert.equal(isExpired('2026-10-05', '2026-10-05'), false)
  assert.equal(isExpired('2026-10-05', '2026-10-06'), true)
  for (const value of [null, '', '2026-02-30']) assert.equal(isExpired(value, '2026-10-05'), false)
})
test('已采集待质检保留日期和批号，未知质检不能显示不合格', () => {
  const batch = { batch_no: 'B01', produce_date: '2026-10-12', expire_date: '2027-10-12', qc_result: null }
  const info = effectiveProduction({}, batch)
  assert.equal(info.batchNo, 'B01')
  assert.equal(info.produceDate, '2026-10-12')
  assert.equal(info.expireDate, '2027-10-12')
  assert.equal(info.qcResult, '')
  assert.equal(info.qualityStatus, 'pending')
  assert.equal(effectiveProduction({ qc_result: 0 }, batch).qcResult, '不合格')
  assert.equal(effectiveProduction({ qc_result: 1 }, batch).qcResult, '合格')
  assert.equal(effectiveProduction({ batch_no: 'B02' }, batch).batchNo, 'B02')
})
