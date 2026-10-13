import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
register('./_ts-loader.mjs', import.meta.url)
register('./_trace-handler-loader.mjs', import.meta.url)
globalThis.defineEventHandler = value => value
globalThis.getQuery = event => event
globalThis.setHeader = () => {}
globalThis.getHeader = () => ''
globalThis.useRuntimeConfig = () => ({ public: { traceBaseUrl: 'https://www.nz315.cn/trace?code=' } })
const handler = (await import('../server/api/trace.get.ts')).default
const code = '12001041001000000000000000000001'
const request = { code, source: 'https://www.nz315.cn/trace?code=' + code }

function state(record, batch, preview) {
  const writes = []
  globalThis.traceTest = { fetched: 0, preview,
    query: async sql => {
      if (sql.includes('SELECT * FROM trace_code')) return record ? [record] : []
      if (sql.includes('SELECT * FROM batch')) return batch ? [batch] : []
      if (sql.includes('SELECT p.*')) return [{ name: '测试农药', registration_no: 'PD20200104', registration_expire: '2099-01-01' }]
      if (sql.includes('COUNT(*)')) return [{ c: 1 }]
      return []
    }, execute: async (...args) => { writes.push(args); return { insertId: 1 } },
  }
  return writes
}

test('生成未入库的本站码返回尚无生产记录，不抓本站、不创建码及扫码日志', async () => {
  const writes = state()
  const out = await handler(request)
  assert.equal(out.resultType, 'internal-pending')
  assert.equal(out.status, null)
  assert.match(out.reasons.join(''), /尚无生产记录/)
  assert.equal(globalThis.traceTest.fetched, 0)
  assert.deepEqual(writes, [])
})

test('生成留档但未实际采集也返回尚无生产记录', async () => {
  const writes = state({ id: 1, status: 1, abnormal_flag: 0, product_id: 2, enterprise_id: 3 })
  assert.equal((await handler(request)).resultType, 'internal-pending')
  assert.deepEqual(writes, [])
})

test('生产采集形成的记录正常返回，无需生成留档记录', async () => {
  const writes = state({ id: 1, status: 2, abnormal_flag: 0, product_id: 2, enterprise_id: 3, batch_id: 4 },
    { id: 4, batch_no: '生产批号A', produce_date: '2026-10-13', expire_date: '2099-01-01', quality_cert_no: '合格证A', qc_result: 1 })
  const out = await handler(request)
  assert.equal(out.resultType, 'genuine')
  assert.equal(out.batch.batchNo, '生产批号A')
  assert.equal(out.product.name, '测试农药')
  assert.equal(writes.length, 1)
  assert.match(writes[0][0], /INSERT INTO scan_log/)
})

test('已采集但尚待质检的工人记录展示真实生产资料', async () => {
  state({ id: 1, status: 1, abnormal_flag: 0, product_id: 2, enterprise_id: 3 }, null,
    { batchNo: '工人批号', produceDate: '2026-10-13', expireDate: '2099-01-01', qualityStatus: 'pending' })
  const out = await handler(request)
  assert.equal(out.resultType, 'genuine')
  assert.equal(out.batch.batchNo, '工人批号')
  assert.equal(out.batch.qualityStatus, 'pending')
})

test('冻结和作废仍优先返回原警示', async () => {
  for (const [flag, result] of [[1, 'frozen'], [2, 'voided']]) {
    state({ id: 1, status: 1, abnormal_flag: flag, product_id: 2, enterprise_id: 3 })
    assert.equal((await handler(request)).resultType, result)
  }
})

test('来源码与查询码不一致时不能借内部网址查其他码', async () => {
  const writes = state()
  const out = await handler({ ...request, code: '12001041001000000000000000000002' })
  assert.equal(out.resultType, 'not-found')
  assert.match(out.reasons.join(''), /不一致/)
  assert.deepEqual(writes, [])
})

test('外站网址即使码值与库中已有记录相同，也走外码查询', async () => {
  const writes = state({ id: 1, status: 2, abnormal_flag: 0, product_id: 2, enterprise_id: 3, batch_id: 4 })
  assert.equal((await handler({ ...request, source: 'https://vendor.example/trace?code=' + code })).resultType, 'external-reg')
  assert.deepEqual(writes, [])
})

test('本站无效码不抓取自己的扫码页', async () => {
  const writes = state()
  const out = await handler({ code: '123', source: 'https://www.nz315.cn/trace?code=123' })
  assert.equal(out.resultType, 'not-found')
  assert.equal(globalThis.traceTest.fetched, 0)
  assert.deepEqual(writes, [])
})

test('仅传本站来源网址也能识别未生产码', async () => {
  state()
  const out = await handler({ source: request.source })
  assert.equal(out.resultType, 'internal-pending')
  assert.equal(out.code, code)
})

test('已生产码保留有效期警示，并使用单码更正后的最终日期', async () => {
  const record = { id: 1, status: 2, abnormal_flag: 0, product_id: 2, enterprise_id: 3, batch_id: 4 }
  const batch = { batch_no: '生产批', produce_date: '2026-10-13', expire_date: '2099-01-01', qc_result: 1 }
  state({ ...record, expire_date: '2020-01-01' }, batch)
  assert.equal((await handler(request)).resultType, 'expired')
  state({ ...record, expire_date: '2099-01-01' }, { ...batch, expire_date: '2020-01-01' })
  assert.equal((await handler(request)).resultType, 'genuine')
})
