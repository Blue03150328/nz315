import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./_ts-loader.mjs', import.meta.url)
const { productionAllocationInput } = await import('../shared/utils/production-allocation-input.ts')
const { productionTaskMetadata } = await import('../shared/utils/production-task-input.ts')
test('数量必须附带明确来源，不能混用来源与清单', () => {
  for (const body of [{ quantity: 7 }, { sourceTaskId: -1, quantity: 7 }, { sourceTaskId: 1, sourceUploadBatchId: 2, quantity: 7 }, { sourceTaskId: 1, quantity: 0 }, { sourceTaskId: 1, quantity: 1.5 }, { sourceTaskId: 1, quantity: 10001 }, { sourceTaskId: 1, quantity: 7, codes: ['1'.repeat(32)] }]) assert.throws(() => productionAllocationInput(body))
  assert.equal(productionAllocationInput({ sourceTaskId: 4, quantity: 7 }).sourceTaskId, 4)
  assert.equal(productionAllocationInput({ sourceUploadBatchId: 2, quantity: 10000 }).quantity, 10000)
})
test('清单去重规范化，旧客户端未提供生产线时兼容任务名', () => {
  const a = '1'.repeat(32), b = '2'.repeat(32)
  assert.deepEqual(productionAllocationInput({ content: `${b}\n${a}\n${b}\n` }).codes, [a, b])
  const body = { productId: 1, name: '一号任务', batchNo: 'A', qualityCertNo: 'Q', produceDate: '2026-10-09', expireDate: '2027-10-09', qcResult: 1 }
  assert.equal(productionTaskMetadata(body).lineName, '一号任务')
  assert.equal(productionTaskMetadata({ ...body, lineName: '二号线' }).lineName, '二号线')
  assert.throws(() => productionTaskMetadata({ ...body, lineName: ' '.repeat(2) }))
})
