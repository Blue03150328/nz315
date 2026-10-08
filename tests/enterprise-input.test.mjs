import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./_ts-loader.mjs', import.meta.url)
const { enterpriseCreateInput } = await import('../server/utils/enterprise-input.ts')
const valid = { name: ' 测试企业 ', creditCode: '91370000123456789x', contact: '联系人', phone: '0531-12345678', legalPerson: '法人', licenseNo: '农药生产许测字001号', qualificationExpire: '2028-02-29', renewExpire: '2026-10-07' }

test('新企业资料去空白、信用代码转大写，服务到期当天有效', () => {
  const input = enterpriseCreateInput(valid, '2026-10-07')
  assert.equal(input.name, '测试企业')
  assert.equal(input.creditCode, '91370000123456789X')
  assert.equal(input.unitCode, '')
  assert.equal(input.status, 1)
  assert.equal(enterpriseCreateInput({ ...valid, status: 0 }, '2026-10-07').status, 0)
})

test('拒绝缺失字段、溢出日期、过期服务、错误类型及超长文本', () => {
  for (const key of Object.keys(valid)) assert.throws(() => enterpriseCreateInput({ ...valid, [key]: ' ' }, '2026-10-07'))
  for (const patch of [
    { qualificationExpire: '2027-02-29' }, { renewExpire: '2026-02-30' }, { renewExpire: '2026-10-06' },
    { renewExpire: '2026-10-07T00:00:00' }, { creditCode: '91370000123456789I' }, { creditCode: '123' },
    { status: '1' }, { status: 2 }, { name: {} }, { name: '企'.repeat(256) }, { unitCode: '1'.repeat(33) },
  ]) assert.throws(() => enterpriseCreateInput({ ...valid, ...patch }, '2026-10-07'))
})
