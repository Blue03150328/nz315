import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
const code = stripTypeScriptTypes(fs.readFileSync('shared/utils/external-summary.ts', 'utf8'))
const { summarizeExternal } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const base = () => ({
  codeParts: { validLength: true, validCategory: true, validProductionType: true },
  registryCandidates: [{ registrationNo: 'PD20172225', expired: false }],
  sourceSnapshot: { status: 'ok', source: { registrationNo: 'PD20172225' }, comparisons: [{ label: '完整登记证号', status: 'match' }] },
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
