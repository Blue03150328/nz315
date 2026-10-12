import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./_ts-loader.mjs', import.meta.url)
globalThis.createError = input => Object.assign(new Error(input.statusMessage), input)
const { availableSpecCodes, SPEC_CODES, formatSpecification, parseSpecification } = await import('../shared/utils/specification.ts')
const { parseSpecCode, parseSpecInput } = await import('../server/utils/spec-input.ts')
const body = { specName: '500毫升/瓶×10', netContent: 500, contentUnit: '毫升', packUnit: '瓶', packQuantity: 10 }

test('空闲码池包含001和999，排除已占用码，优先使用编号空洞', () => {
  assert.equal(SPEC_CODES.length, 999)
  const free = availableSpecCodes(['001', '003', '999'])
  assert.equal(free[0], '002')
  assert.equal(free.at(-1), '998')
  assert.equal(free.length, 996)
  assert.deepEqual(availableSpecCodes(SPEC_CODES), [])
})

test('只有001～999三位字符串可以手动选号', () => {
  for (const code of ['001', '010', '999']) assert.equal(parseSpecCode(code), code)
  for (const code of ['000', '1000', '1', '01', ' 001', null, 1, true, ['001']]) assert.throws(() => parseSpecCode(code), /三位规格码/)
  assert.equal(parseSpecCode(undefined), undefined)
})

test('中文和英文单位及乘号别名归为同一成组规格，避免别名重复导入', () => {
  const expected = { name: '500毫升/瓶×10', net: 500, unit: '毫升', pack: '瓶', quantity: 10 }
  for (const value of ['500毫升/瓶×10', '500ml/瓶✖10', ' 500 ML / 瓶 x 10 ', '500毫升/瓶*10']) assert.deepEqual(parseSpecification(value), expected)
  assert.equal(parseSpecification('0.5kg/袋×20').name, '0.5千克/袋×20')
})

test('旧单件规格保持名称及数量1，省略编辑数量时保留原数量', () => {
  assert.equal(parseSpecification('200毫升/瓶').quantity, 1)
  assert.equal(formatSpecification(200, '毫升', '瓶', 1), '200毫升/瓶')
  const { packQuantity: ignored, ...legacy } = body
  assert.equal(parseSpecInput(legacy).packQuantity, 1)
  assert.equal(parseSpecInput(legacy, 10).packQuantity, 10)
})

test('数量不接受空值、负数、小数、超限或非标类型', () => {
  for (const value of [null, '', 0, -1, 1.5, 1000000, Infinity, true, [1], {}]) assert.throws(() => parseSpecInput({ ...body, packQuantity: value }), /数量须为/)
  for (const value of ['500ml/瓶×0', '500ml/瓶×-1', '500ml/瓶×1.5', '500ml/瓶×1000000']) assert.equal(parseSpecification(value), null)
  assert.equal(parseSpecInput({ ...body, packQuantity: '10' }).packQuantity, 10)
})

test('净含量精度及数据库容量在写入前检查，错误单位拒绝', () => {
  for (const value of [0, -1, '', 0.0001, 1000000000, true, [500]]) assert.throws(() => parseSpecInput({ ...body, netContent: value }), /净含量须为/)
  assert.equal(parseSpecification('0ml/瓶×10'), null)
  assert.equal(parseSpecification('1000000000ml/瓶'), null)
  assert.throws(() => parseSpecInput({ ...body, contentUnit: '错误单位' }), /含量单位/)
  assert.throws(() => parseSpecInput({ ...body, specName: '长'.repeat(101) }), /不能超过100字/)
})
