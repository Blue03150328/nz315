import {test} from 'node:test'
import assert from 'node:assert/strict'
import {register} from 'node:module'
register('../_ts-loader.mjs',import.meta.url)
const {stockLineEvent}=await import('../../server/utils/stock-line-production.ts')
const {productionLabelOf}=await import('../../shared/utils/internal-trace-url.ts')
const {headOf}=await import('../../server/utils/code-head.ts')
globalThis.useRuntimeConfig=()=>({public:{traceBaseUrl:'https://www.nz315.cn/trace?code='}})
globalThis.createError=({statusCode,statusMessage})=>Object.assign(new Error(statusMessage),{statusCode})
const product={id:1,enterprise_id:1,status:1,registration_no:'PD123456',reg_category:1,produce_type:1,spec_code:'001'}
const context={unifiedScan:true,stockWorkflow:true,batchNo:'B',produceDate:'2026-10-17',expireDate:'2027-10-17'}
const batch={id:1,product_id:1,batch_no:'B',produce_date:context.produceDate,expire_date:context.expireDate,qc_result:null}
const run={id:'run',task_id:1,batch_id:1,product_id:1,enterprise_id:1,context_json:context}
const grant={manualReview:true,us:1,uv:0,user_version:0,ur:'production_operator',ue:1}
// 使用可控SQL替身执行真实服务器决策函数，本脚本不属于HTTP或真实数据库集成测试。
function fixture(){
 const external=new Set(),writes=[]
 return {external,writes,
  async query(sql,args){
   if(sql.startsWith('SELECT * FROM production_task '))return [[{id:1,status:'active'}]]
   if(sql.startsWith('SELECT * FROM batch '))return [[batch]]
   if(sql.startsWith('SELECT p.*'))return [[product]]
   if(sql.startsWith('SELECT id,source_kind'))return [[{id:'session',source_kind:'worker'}]]
   if(sql.startsWith('SELECT id FROM external_trace_code'))return [[]]
   if(sql.startsWith('SELECT * FROM trace_code '))return [[]]
   throw Error('Unexpected SQL '+sql)
  },
  async execute(sql,args){
   writes.push({sql,args})
   if(sql.startsWith('INSERT IGNORE INTO external_trace_code')){const old=external.has(args[3]);external.add(args[3]);return [{affectedRows:old?0:1}]}
   throw Error('Unexpected write '+sql)
  }
 }
}
const scan=(conn,rawCode,kind='valid')=>stockLineEvent(conn,{},run,{id:'session',user_id:1},{rawCode,kind,sequence:1,capturedAt:'2026-10-17T00:00:00.000Z'},true,grant,()=>{throw Error('Unexpected bind')})
test('外站非产品链接可按当前选定产品接受，未核对外站产品身份',async()=>{
 const c=fixture();for(const raw of ['https://ads.example/campaign?id=1','https://wrong-brand.example/product/2'])assert.equal((await scan(c,raw)).result,'saved')
 assert.equal(c.external.size,2)
})
test('外码完整原文重复才去重，不同网址写法分别计数',async()=>{
 const c=fixture(),raw='https://vendor.example/trace?id=0001';assert.equal((await scan(c,raw)).result,'saved');assert.equal((await scan(c,raw)).result,'duplicate')
 for(const variant of [' '+raw+' ','https://VENDOR.example/trace?id=0001',raw+'&utm_source=scan'])assert.equal((await scan(c,variant)).result,'saved')
 assert.equal(c.external.size,4)
})
test('管理员核对漏传原文导致完整内码在统一扫码分支被拒绝',async()=>{
 const c=fixture(),code=headOf(product)+'000000000000000000001'
 assert.equal(productionLabelOf(code).classification,'internal')
 const result=await stockLineEvent(c,{},run,{user_id:1},{code,kind:'valid'},true,grant,()=>{throw Error('Must not reach bind')})
 assert.equal(result.result,'exception');assert.match(result.reason,/来源无法识别/);assert.equal(c.writes.length,0)
})
test('原内码异常后本机重扫标重复，服务器仍不接收入库',async()=>{
 const c=fixture(),raw=headOf(product)+'000000000000000000001';const result=await scan(c,raw,'duplicate')
 assert.equal(result.result,'exception');assert.match(result.reason,/本机判定为异常/);assert.equal(c.writes.length,0)
})
test('同证号同规格的产品码头无法区分商标',()=>{
 assert.equal(headOf({...product,trademark:'A'}),headOf({...product,id:2,trademark:'B'}))
})
test('本站坏链接及带回车换行的标签不进入有效外码分支',async()=>{
 const c=fixture();for(const raw of ['https://nz315.cn/trace?code=123','https://nz315.cn/other?id=1','https://vendor.example/trace?id=1\r\n'])assert.equal((await scan(c,raw)).result,'exception')
 assert.equal(c.external.size,0)
})
