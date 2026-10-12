import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatCodeQuantity } from '../shared/utils/code-quantity.ts'

// 2026-10-12 去子批次改造：数量不再折算「万」，一律精确显示（千分位 + 「张」）。
test('数量一律精确显示，千分位分组并以「张」结尾', () => {
  for (const [value, expected] of [[0, '0张'], [1, '1张'], [99, '99张'], [100, '100张'], [999, '999张'], [1000, '1,000张'], [12352, '12,352张'], [100000, '100,000张'], [500000, '500,000张'], [9999999, '9,999,999张']]) {
    assert.equal(formatCodeQuantity(value), expected)
  }
})

test('未知数量不能当作零', () => {
  for (const value of [null, undefined, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(formatCodeQuantity(value), '待统计')
})
