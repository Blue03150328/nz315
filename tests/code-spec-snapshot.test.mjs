import { test } from 'node:test'
import assert from 'node:assert/strict'
import { issueCodeSpecSnapshot, verifyCodeSpecSnapshot } from '../server/utils/code-spec-snapshot.ts'

const codes = ['12419711001000000000000000000001', '12419711001000000000000000000002']
const secret = '仅用于规格快照单测的独立密钥'

test('生成时包装快照保持原值，不随当前产品资料变化', () => {
  const token = issueCodeSpecSnapshot(1, codes, '500毫升/瓶×10', secret)
  assert.deepEqual(verifyCodeSpecSnapshot(token, 1, codes, secret), { specName: '500毫升/瓶×10' })
  assert.deepEqual(verifyCodeSpecSnapshot(issueCodeSpecSnapshot(1, codes, null, secret), 1, codes, secret), { specName: null })
})

test('快照不能跨产品或替换生成的码使用', () => {
  const token = issueCodeSpecSnapshot(1, codes, '500毫升/瓶', secret)
  assert.equal(verifyCodeSpecSnapshot(token, 2, codes, secret), null)
  assert.equal(verifyCodeSpecSnapshot(token, 1, codes.slice(0, 1), secret), null)
  assert.equal(verifyCodeSpecSnapshot(token, 1, [...codes].reverse(), secret), null)
  assert.equal(verifyCodeSpecSnapshot(token, 1, [codes[0], '12419711001000000000000000000003'], secret), null)
})

test('拒绝伪造包装名称、错误签名和不完整快照', () => {
  const token = issueCodeSpecSnapshot(1, codes, '500毫升/瓶', secret)
  const [payload, signature] = token.split('.')
  const forged = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  forged.specName = '1升/瓶'
  assert.equal(verifyCodeSpecSnapshot(Buffer.from(JSON.stringify(forged)).toString('base64url') + '.' + signature, 1, codes, secret), null)
  assert.equal(verifyCodeSpecSnapshot(token, 1, codes, '另一把密钥'), null)
  for (const bad of [undefined, '', 'bad', token + '.extra', 'x'.repeat(2049)]) assert.equal(verifyCodeSpecSnapshot(bad, 1, codes, secret), null)
})
