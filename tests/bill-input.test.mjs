import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./_ts-loader.mjs', import.meta.url)
globalThis.createError = input => Object.assign(new Error(input.statusMessage), input)
const { parseBillBody } = await import('../server/utils/bill-input.ts')
test('产品名称空值拒绝，合法名称去空格后保持必填契约', () => {
  for (const productName of [null, undefined, '', '  ']) {
    assert.throws(() => parseBillBody({ productName }, '2026-10-06', true), /请填写产品名称/)
  }
  assert.deepEqual(parseBillBody({ productName: ' 测试产品 ' }, '2026-10-06', true), { productName: '测试产品' })
  assert.deepEqual(parseBillBody({ dosage: null }, '2026-10-06', true), { dosage: null })
})
