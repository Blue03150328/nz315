import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./_ts-loader.mjs', import.meta.url)
const { externalRawCode, externalCollectionId, externalSequence, externalStartInput, externalEventInput, externalMetadataInput, externalCsvRow } = await import('../shared/utils/external-collection-input.ts')
const id = '12345678-1234-1234-1234-123456789abc'

test('完整网址、前导零、空格、大小写和参数顺序原样保留', () => {
  for (const code of ['https://EXAMPLE.invalid/t?code=000123&key=a%2Fb', ' https://example.invalid/t?x=1&code=000123 ', '000123', '中文标签😀']) assert.equal(externalRawCode(code), code)
})
test('逐行导出不接受空文、换行、零字符和超过8192字节', () => {
  for (const code of ['', '  ', 'a\rb', 'a\nb', 'a\0b', '中'.repeat(2731), '\ud800']) assert.throws(() => externalRawCode(code))
  assert.equal(externalRawCode('a'.repeat(8192)).length, 8192)
})
test('CSV双引号与逗号按一列引用，原文不加入单引号', () => {
  assert.equal(externalCsvRow('https://x.invalid/?id=001,"abc"'), '"https://x.invalid/?id=001,""abc"""\r\n')
  assert.equal(externalCsvRow('=001'), '"=001"\r\n')
  assert.equal(externalCsvRow('000123', '2026-10-14', '001,"甲"'), '"000123","2026-10-14","001,""甲"""\r\n')
  assert.equal(externalCsvRow('000123', null, undefined), '"000123","",""\r\n')
})
test('采集UUID、工号和序号边界明确', () => {
  assert.equal(externalCollectionId(id.toUpperCase()), id)
  assert.equal(externalSequence(0, true), 0)
  assert.equal(externalStartInput({ batchId: id, workerNo: ' 001 ' }).workerNo, '001')
  for (const value of ['1', -1, 0.5, 10000001]) assert.throws(() => externalSequence(value))
  assert.throws(() => externalStartInput({ batchId: id, workerNo: '' }))
})
test('事件采集时间无效不确认，原文业务错误可产生拒绝收据', () => {
  const event = { eventId: id, sequence: 1, rawCode: 'a\nb', capturedAt: '2026-10-12T01:02:03.000Z' }
  assert.equal(externalEventInput(event).rawCode, event.rawCode)
  assert.equal(externalEventInput({ ...event, rawCode: 'a'.repeat(8193) }).rawCode.length, 8193)
  assert.throws(() => externalEventInput({ ...event, rawCode: 'a'.repeat(65537) }), /超过65536/)
  assert.throws(() => externalEventInput({ ...event, capturedAt: '2026-02-30T01:02:03Z' }))
  assert.throws(() => externalEventInput({ ...event, capturedAt: '2026-10-12' }))
})
test('生产资料支持产品选择或独立手输，数量默认与覆盖分开', () => {
  const manual = { productId: null, productName: '手填产品', batchNo: '001', produceDate: '2026-10-12', productionQuantity: null }
  assert.deepEqual(externalMetadataInput(manual), manual)
  assert.equal(externalMetadataInput({ ...manual, productId: 2, productName: '', productionQuantity: 9800 }).productionQuantity, 9800)
  for (const body of [{ ...manual, produceDate: '2026-02-30' }, { ...manual, productName: '' }, { ...manual, productionQuantity: 0 }, { ...manual, productionQuantity: 1.5 }, { ...manual, productId: '2' }]) assert.throws(() => externalMetadataInput(body))
})
