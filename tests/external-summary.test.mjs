import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
const code = stripTypeScriptTypes(fs.readFileSync('shared/utils/external-summary.ts', 'utf8'))
const { summarizeExternal } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const base = () => ({
  code: '11722251100136950812284409766080',
  codeParts: { validLength: true, validCategory: true, validProductionType: true },
  registryCandidates: [{ registrationNo: 'PD20172225', expireDate: '2028-02-08', expired: false }],
  sourceSnapshot: { status: 'ok', extractionMethod: 'page', source: { pageCode: '11722251100136950812284409766080', registrationNo: 'PD20172225' }, comparisons: ['来源页单元识别码', '完整登记证号', '码内登记类别及后六位', '产品名称（不含百分比标注）', '登记证持有人', '剂型', '总有效成分含量', '全部有效成分及含量'].map(label => ({ label, status: 'match' })) },
})
const summary = value => summarizeExternal(value, '2026-09-24')
test('资料不足及无登记参考的批次、生产企业不计异常', () => {
  const value = base()
  value.sourceSnapshot.comparisons.push({ label: '毒性', status: 'insufficient' }, { label: '生产日期及批号', status: 'review' }, { label: '实际生产企业', status: 'review' })
  assert.equal(summary(value).tone, 'success')
})
test('明确过期、字段差异、成分待核实均不能显示绿色', () => {
  for (const mutate of [
    v => { v.sourceSnapshot.source.productExpiry = '2026年9月23日' },
    v => { v.registryCandidates[0].expired = true },
    v => { v.sourceSnapshot.comparisons.push({ label: '登记证持有人', status: 'mismatch' }) },
    v => { v.sourceSnapshot.comparisons.push({ label: '全部有效成分及含量', status: 'review' }) },
    v => { v.codeParts.validProductionType = false },
  ]) { const value = base(); mutate(value); assert.equal(summary(value).tone, 'warning') }
})
test('非日期、无效日期及到期当天不误报产品过期', () => {
  for (const date of ['2年', '见喷码', '2026-02-31', '2026-09-24', '2027/9/24']) {
    const value = base(); value.sourceSnapshot.source.productExpiry = date
    assert.equal(summary(value).tone, 'success', date)
  }
})
test('抓取失败、无登记匹配、无有效比对保持中性', () => {
  for (const mutate of [
    v => { v.sourceSnapshot.status = 'unavailable' },
    v => { delete v.sourceSnapshot.source },
    v => { v.registryCandidates = [] },
    v => { v.sourceSnapshot.comparisons = [{ label: '完整登记证号', status: 'insufficient' }] },
  ]) { const value = base(); mutate(value); assert.equal(summary(value).tone, 'neutral') }
})
test('多个登记候选只采用来源完整证号匹配的记录', () => {
  const value = base()
  value.registryCandidates.push({ registrationNo: 'PD00172225', expired: true })
  assert.equal(summary(value).tone, 'success')
  delete value.sourceSnapshot.source.registrationNo
  assert.equal(summary(value).tone, 'neutral')
})
test('核心资料缺失、来源对应不明及图片识别不能自动通过', () => {
  for (const mutate of [
    v => { v.sourceSnapshot.comparisons = [{ label: '完整登记证号', status: 'insufficient' }, { label: '登记证持有人', status: 'insufficient' }] },
    v => { delete v.sourceSnapshot.source.pageCode },
    v => { v.sourceSnapshot.status = 'partial' },
    v => { v.sourceSnapshot.extractionMethod = 'vision' },
    v => { delete v.sourceSnapshot.extractionMethod },
    v => { delete v.registryCandidates[0].expireDate },
    v => { v.registryCandidates.push({ ...v.registryCandidates[0] }) },
  ]) { const value = base(); mutate(value); assert.equal(summary(value).tone, 'neutral') }
})
test('核心项一致但资料缺失时提示未发现明显异常，缺失项分组列出', () => {
  const value = base()
  value.sourceSnapshot.comparisons = [
    { label: '登记证持有人', status: 'match' },
    { label: '完整登记证号', status: 'insufficient' },
    { label: '码内登记类别及后六位', status: 'insufficient' },
    { label: '剂型', status: 'insufficient' },
    { label: '总有效成分含量', status: 'insufficient' },
    { label: '全部有效成分及含量', status: 'insufficient' },
  ]
  const result = summary(value)
  assert.equal(result.tone, 'success')
  assert.equal(result.title, '未发现明显异常')
  assert.match(result.detail, /已与登记资料一致：登记证持有人/)
  assert.match(result.detail, /登记证有效期至 2028-02-08，当前未到期/)
  assert.match(result.detail, /请与包装标签自行核对：完整登记证号、产品名称（不含百分比标注）、剂型、总有效成分含量、全部有效成分及含量。/)
  assert.match(result.detail, /来源页未提供、无法自动核验：来源页单元识别码、码内登记类别及后六位。/)
})
test('关键项全部一致仍是信息比对通过', () => {
  const result = summary(base())
  assert.equal(result.tone, 'success')
  assert.equal(result.title, '信息比对通过')
})
test('来源码不一致与来源明确查无此码优先显示异常', () => {
  for (const issue of ['code-mismatch', 'source-not-found']) {
    const value = base(); value.sourceSnapshot = { status: 'unavailable', issue, comparisons: [] }
    assert.equal(summary(value).tone, 'warning')
  }
  const value = base(); value.sourceSnapshot.source.pageCode = '0'.repeat(32)
  assert.equal(summary(value).tone, 'warning')
})
test('登记证到期当天仍有效，次日提示结合生产日期核实', () => {
  const value = base(); value.registryCandidates[0].expireDate = '2026-09-24'
  assert.equal(summary(value).tone, 'success')
  const result = summarizeExternal(value, '2026-09-25')
  assert.equal(result.tone, 'warning')
  assert.match(result.detail, /结合产品生产日期核实/)
})
