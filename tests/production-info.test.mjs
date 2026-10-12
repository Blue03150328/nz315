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
test('已用码更正的批号优先，共享业务批次和其他任务的码保持原批号', () => {
  const shared = { batch_no: '原生产批号', produce_date: '2026-10-10' }
  assert.equal(effectiveProduction({ batch_no: '任务甲更正批号' }, shared).batchNo, '任务甲更正批号')
  assert.equal(effectiveProduction({ batch_no: '原生产批号' }, shared).batchNo, '原生产批号')
  assert.equal(effectiveProduction({ batch_no: null }, shared).batchNo, '原生产批号')
  assert.equal(effectiveProduction({}, shared).batchNo, '原生产批号')
  assert.equal(shared.batch_no, '原生产批号')
})
