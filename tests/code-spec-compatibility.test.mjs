import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./_ts-loader.mjs', import.meta.url)
const { knownCodeSpecKey, assertCodeSpecCompatibility } = await import('../shared/utils/code-spec-compatibility.ts')

test('相同包装的中文、英文单位及乘号别名视为等价', () => {
  const values = ['500毫升/瓶×10', '500ml/瓶✖10', ' 500 ML / 瓶 x 10 ', '0.5升/瓶*10', '0.500l/瓶×10']
  assert.equal(new Set(values.map(knownCodeSpecKey)).size, 1)
  assert.doesNotThrow(() => assertCodeSpecCompatibility(values))
  assert.equal(knownCodeSpecKey('500毫升/瓶'), knownCodeSpecKey('0.5升/瓶×1'))
})

test('质量单位等价且三位小数换算不受浮点尾差影响', () => {
  for (const [left, right] of [['500克/袋×2', '0.5kg/袋×2'], ['0.001升/瓶', '1毫升/瓶'], ['1.001升/桶', '1001ml/桶'], ['0.101千克/袋', '101g/袋'], ['999999999毫升/桶', '999999.999升/桶']]) {
    assert.notEqual(knownCodeSpecKey(left), null)
    assert.notEqual(knownCodeSpecKey(right), null)
    assert.equal(knownCodeSpecKey(left), knownCodeSpecKey(right))
    assert.doesNotThrow(() => assertCodeSpecCompatibility([left, right]))
  }
  assert.equal(knownCodeSpecKey('999999999.999升/桶'), knownCodeSpecKey('999999999.999l/桶'))
})

test('净含量变化或量纲不同不能混入同一生产任务', () => {
  for (const values of [['500毫升/瓶×10', '1升/瓶×10'], ['500毫升/瓶', '500克/瓶'], ['1片/盒', '1粒/盒']]) {
    assert.throws(() => assertCodeSpecCompatibility(values), /不同的已知包装规格/)
  }
})

test('包装种类及包装数量分别参与比较，整组总量相等仍可冲突', () => {
  for (const values of [['500ml/瓶×10', '500ml/袋×10'], ['500ml/瓶×10', '500ml/瓶×20'], ['500ml/瓶×10', '1升/瓶×5']]) {
    assert.throws(() => assertCodeSpecCompatibility(values), /不同的已知包装规格/)
  }
})

test('未知、空值和自定义名称不会被当前规格或名称变化冒充为已知包装', () => {
  const unknown = [null, undefined, '', '原规格资料未记录', '厂家小瓶装', '500毫升/瓶（旧包装）', 500, {}, '0毫升/瓶', '500毫升/瓶×0', '500毫升/瓶×1000000']
  for (const value of unknown) assert.equal(knownCodeSpecKey(value), null)
  assert.doesNotThrow(() => assertCodeSpecCompatibility(unknown))
  assert.doesNotThrow(() => assertCodeSpecCompatibility([...unknown, '500ml/瓶×10']))
  assert.doesNotThrow(() => assertCodeSpecCompatibility([]))
})

test('未知快照不能掩盖候选码与任务已有码之间的已知冲突', () => {
  const values = [null, '500ml/瓶×10', '自定义包装', '1升/瓶×10', undefined]
  const original = [...values]
  assert.throws(() => assertCodeSpecCompatibility(values), /不同的已知包装规格/)
  assert.deepEqual(values, original)
})
