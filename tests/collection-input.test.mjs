import test from 'node:test'
import assert from 'node:assert/strict'
import { collectionCode,collectionEvents } from '../shared/utils/collection-input.ts'
import { randomUUID } from 'node:crypto'
const code='00000000000000000000000000000001',other='00000000000000000000000000000002'
test('只比对码值，忽略域名、参数名和不完整网址',()=>{
  for(const input of [code,`https://elsewhere.example/?47=${code}&other=1`,`//partial?id=${code}`,`半截网址/?i=${code}&`,`产品:${code}`,Array.from(code).map(c=>'%'+c.charCodeAt(0).toString(16)).join('')])assert.equal(collectionCode(input),code)
  assert.equal(collectionCode(`?a=${code}&b=${code}`),code)
})
test('码本身缺位、超长和多候选不截取、不猜测',()=>{
  for(const input of [code.slice(0,31),code+'1',`?a=${code}&b=${other}`,'https://partial/?i=123456','javascript:alert(1)'])assert.equal(collectionCode(input),null)
})
test('事件序号、原文一致性、ISO时间、数量上限必须校验',()=>{
  const e={eventId:randomUUID(),sequence:1,rawCode:`?i=${code}`,code,kind:'valid',capturedAt:'2026-10-10T01:00:00.123Z'}
  assert.equal(collectionEvents({events:[e]})[0].code,code)
  for(const patch of [{eventId:'bad'},{sequence:0},{sequence:1.5},{code:other},{capturedAt:'2026-02-30T01:00:00.123Z'},{kind:'ok'}])assert.throws(()=>collectionEvents({events:[{...e,...patch}]}))
  assert.throws(()=>collectionEvents({events:[e,e]}))
  assert.throws(()=>collectionEvents({events:Array(51).fill(e)}))
})
