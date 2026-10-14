import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./_ts-loader.mjs', import.meta.url)
globalThis.createError = input => Object.assign(new Error(input.statusMessage), input)
const { usageBatchFilter } = await import('../server/utils/usage-batch-list.ts')
const { usageSelection } = await import('../server/utils/usage-batch-bulk.ts')
const user = { role: 'enterprise_admin', enterprise_id: 7 }
test('全选筛选不能覆盖账号企业边界，产线和设备分别匹配并转义通配符', () => {
  const result = usageBatchFilter(user, { enterpriseId: 8, lineName: '线_1', deviceName: '扫描仪%', productId: 3 })
  assert.match(result.sql, /ub.enterprise_id=\?/)
  assert.match(result.sql, /s.line_snapshot/)
  assert.match(result.sql, /u.device_name_snapshot/)
  assert.deepEqual(result.params, [7, 3, '%线!_1%', '%扫描仪!%%'])
  assert.deepEqual(result.filters, { productId: 3, lineName: '线_1', deviceName: '扫描仪%' })
})
test('全选支持排除行，手选去重，非法批次及日期拒绝', () => {
  assert.deepEqual(usageSelection({ ids: [3, 1, 3] }), { all: false, ids: [1, 3] })
  assert.deepEqual(usageSelection({ all: true, filters: {}, excludeIds: [3, 3] }).excludeIds, [3])
  for (const input of [{}, { ids: [] }, { ids: ['1'] }, { ids: [0] }, { all: true }, { all: true, filters: {}, ids: [1] }, { all: true, filters: {}, excludeIds: ['1'] }]) assert.throws(() => usageSelection(input))
  for (const input of [{ productId: -1 }, { dateFrom: '2026-02-30' }, { dateFrom: '2026-10-15', dateTo: '2026-10-14' }]) assert.throws(() => usageBatchFilter(user, input))
})
