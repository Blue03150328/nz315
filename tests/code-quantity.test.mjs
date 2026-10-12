import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatCodeQuantity } from '../shared/utils/code-quantity.ts'

test('不足100张保留精确整数，万位最多两位小数', () => {
  for (const [value, expected] of [[0, '0张'], [1, '1张'], [99, '99张'], [100, '0.01万张'], [10000, '1万张'], [80000, '8万张'], [82500, '8.25万张'], [100000, '10万张']]) {
    assert.equal(formatCodeQuantity(value), expected)
  }
})

test('换算存在舍入时明确标约，未知数量不能当作零', () => {
  for (const [value, expected] of [[101, '约0.01万张'], [10050, '约1.01万张'], [82501, '约8.25万张'], [82550, '约8.26万张'], [99999, '约10万张']]) {
    assert.equal(formatCodeQuantity(value), expected)
  }
  for (const value of [null, undefined, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(formatCodeQuantity(value), '待统计')
})
