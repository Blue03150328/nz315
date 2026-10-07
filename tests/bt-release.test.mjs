// 发布结构守卫在本机验证，不连接数据库，不执行生产步骤。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectedColumns, permittedMissing } from '../deploy/bt-release-20261006.mjs'
import { expectedColumns as latestColumns, permittedMissing as latestMissing, validateLiveMarker } from '../deploy/bt-release-20261007.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const expected = expectedColumns(root)
const found = new Set(expected.map(c => c.join('.')))

test('最新上线脚本保留17表212列及两列迁移边界', () => {
  assert.deepEqual(latestColumns(root), expected)
  assert.deepEqual(latestMissing(expected, found), [])
  const missing = new Set(found)
  missing.delete('farm_bill.store_name')
  assert.deepEqual(latestMissing(expected, missing), ['farm_bill.store_name'])
  missing.delete('user.session_epoch')
  assert.throws(() => latestMissing(expected, missing), /未覆盖/)
})

test('源码标记必须存在且与现役公网构建一致，未知或过时版本不能发布', () => {
  const build = { id: 'build-current', timestamp: 1791273745911 }
  assert.doesNotThrow(() => validateLiveMarker({ source: '201b65a', build }, build))
  for (const marker of [null, {}, { source: '未知', build }, { source: '201b65a', build: { ...build, id: 'old-build' } }, { source: '201b65a', build: { ...build, timestamp: 1 } }]) {
    assert.throws(() => validateLiveMarker(marker, build), /标记|指纹/)
  }
})

test('现有源码全部17表和212列被发布检查覆盖', () => {
  assert.equal(new Set(expected.map(c => c[0])).size, 17)
  assert.equal(expected.length, 212)
  assert.deepEqual(permittedMissing(expected, found), [])
})
test('仅允许补充记账剂型与门店两列', () => {
  const actual = new Set(found)
  actual.delete('farm_bill.dosage')
  actual.delete('farm_bill.store_name')
  assert.deepEqual(permittedMissing(expected, actual), ['farm_bill.dosage', 'farm_bill.store_name'])
})
test('其他缺列和旧结构拒绝自动迁移', () => {
  for (const column of ['user.session_epoch', 'trace_code.expire_date', 'trace_code.qc_result', 'product_original.ingredient']) {
    const actual = new Set(found)
    actual.delete(column)
    assert.throws(() => permittedMissing(expected, actual), /未覆盖/)
  }
})
test('缺表与解析不完整拒绝发布', () => {
  assert.throws(() => permittedMissing(expected, new Set([...found].filter(c => !c.startsWith('external_source_snapshot.')))), /未覆盖/)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nz315-release-check-'))
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'))
    fs.writeFileSync(path.join(tmp, 'scripts/db-init.mjs'), 'const DDL = []')
    assert.throws(() => expectedColumns(tmp), /解析不完整/)
  } finally {
    fs.unlinkSync(path.join(tmp, 'scripts/db-init.mjs'))
    fs.rmdirSync(path.join(tmp, 'scripts'))
    fs.rmdirSync(tmp)
  }
})
