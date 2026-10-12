// 只允许隔离本机测试库；不会操作nz315或远程业务库。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseEnv } from 'node:util'
import { randomUUID,randomBytes } from 'node:crypto'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
const env=parseEnv(fs.readFileSync('.env','utf8'))
assert.equal(env.DB_HOST,'127.0.0.1');assert.match(env.DB_NAME,/^pda_queue_test_[0-9]+$/)
const base=process.env.NZ315_TEST_BASE || 'http://127.0.0.1:38121'
assert.equal(new URL(base).hostname,'127.0.0.1')
const db=await mysql.createConnection({host:env.DB_HOST,user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,dateStrings:true})
const tag='__collection_'+Date.now(),password=randomBytes(16).toString('hex')
let checks=0
async function check(name,fn){await fn();console.log('通过：'+name);checks++}
async function req(path,cookie,body,method=body===undefined?'GET':'POST'){
  const r=await fetch(base+path,{method,headers:{cookie:cookie || '','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)})
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data}
async function account(role,enterprise){const username=tag+'_'+role+randomBytes(2).toString('hex');const [r]=await db.execute('INSERT INTO user(username,password,name,role,enterprise_id,status) VALUES (?,?,?,?,?,1)',[username,await bcrypt.hash(password,4),tag,role,enterprise]);const login=await req('/api/auth/login','',{username,password});ok(login);return {cookie:login.cookie,id:r.insertId}}
try{
 const [e]=await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES (?,'2099-12-31',1)",[tag])
 const [s]=await db.execute("INSERT INTO product_spec(enterprise_id,spec_code,spec_name,net_content,content_unit,pack_unit) VALUES (?,'001','测试规格',1,'克','袋')",[e.insertId])
 const reg='PD'+String(Date.now()).slice(-8)
 const [p]=await db.execute("INSERT INTO product(enterprise_id,name,registration_no,registration_expire,reg_category,produce_type,spec_id,status) VALUES (?,?,?,'2099-12-31',1,1,?,1)",[e.insertId,tag,reg,s.insertId])
 const admin=await account('enterprise_admin',e.insertId),worker=await account('code_admin',e.insertId),viewer=await account('viewer',e.insertId),alienWorker=await account('code_admin',e.insertId)
 const [e2]=await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES (?,'2099-12-31',1)",[tag+'_other']),other=await account('enterprise_admin',e2.insertId)
 const [u]=await db.execute('INSERT INTO upload_batch(enterprise_id,file_name,product_id,created_by) VALUES (?,?,?,?)',[e.insertId,tag,p.insertId,admin.id])
 const head='1'+reg.slice(-6)+'1'+'001',codes=Array.from({length:2000},(_,i)=>head+String(i+1).padStart(21,'0'))
 for(let i=0;i<2000;i+=500){const chunk=codes.slice(i,i+500);await db.query('INSERT INTO trace_code(enterprise_id,product_id,upload_batch_id,code,status,abnormal_flag) VALUES '+chunk.map(()=>'(?,?,?,?,1,0)').join(','),chunk.flatMap(code=>[e.insertId,p.insertId,u.insertId,code]))}
 const task=ok(await req('/api/admin/production-tasks',worker.cookie,{requestId:randomUUID(),name:tag,lineName:'一号线',productId:p.insertId,batchNo:tag+'_A',produceDate:'2026-10-10',expireDate:'2027-10-10',qcResult:1,qualityCertNo:'A-001',sourceUploadBatchId:u.insertId,quantity:2000})).id
 const path='/api/admin/production-tasks/'+task,sid=randomUUID(),sessionPath=path+'/collection-sessions/'+sid
 let sequence=0
 const event=(code,kind='valid',raw='https://other.example/?47='+code)=>({eventId:randomUUID(),sequence:++sequence,rawCode:raw,code,kind,capturedAt:new Date().toISOString(),reason:kind==='duplicate'?'本机重复剔除':kind==='invalid'?'无法提取完整码':''})
 await check('会话鉴权、企业隔离、启动幂等与固定领用清单',async()=>{
   const body={sessionId:sid,device:'Android12测试机'}
   assert.equal((await req(path+'/collection-sessions','',body)).status,401)
   assert.equal((await req(path+'/collection-sessions',viewer.cookie,body)).status,403)
   assert.equal((await req(path+'/collection-sessions',other.cookie,body)).status,404)
   const start=ok(await req(path+'/collection-sessions',worker.cookie,body));assert.equal(start.codes.length,2000);assert.equal(start.context.lineName,'一号线')
   assert.equal(ok(await req(path+'/collection-sessions',worker.cookie,body)).sessionId,sid)
 })
 await check('设备会话阻止提前结束和修改生产资料，允许改名称与生产线',async()=>{
   assert.equal((await req(path+'/end',admin.cookie,{})).status,409)
   assert.equal((await req(path,worker.cookie,{requestId:randomUUID(),produceDate:'2026-10-11'},'PATCH')).status,409)
   ok(await req(path,worker.cookie,{requestId:randomUUID(),lineName:'二号线',name:tag+'改名'},'PATCH'))
 })
 const first=event(codes[0])
 await check('忽略其他网址参数，响应丢失重传同事件只绑定一次',async()=>{
   const a=ok(await req(sessionPath+'/events',worker.cookie,{events:[first]}));assert.equal(a.receipts[0].state,'accepted')
   const replay=ok(await req(sessionPath+'/events',worker.cookie,{events:[first]}));assert.deepEqual(replay.receipts,a.receipts)
   assert.equal(ok(await req(path,admin.cookie)).task.used_count,1)
   const [[bound]]=await db.query('SELECT used_line FROM production_task_code WHERE task_id=? AND code=?',[task,codes[0]]);assert.equal(bound.used_line,'一号线','设备原生产线快照不能随任务改名被覆盖')
   assert.equal(ok(await req(sessionPath+'/events',alienWorker.cookie,{events:[first]})).statusCode,403)
 })
 const second=event(codes[1]),trigger='collector_fault_'+Date.now()
 await check('绑定已执行但审计插入失败，码与序号一起回滚',async()=>{
   await db.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON production_collection_event FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test audit failure'`)
   try{const fail=ok(await req(sessionPath+'/events',worker.cookie,{events:[second]}));assert.equal(fail.ok,false);assert.equal(fail.receipts.length,0);const [[code]]=await db.query('SELECT status,batch_id FROM trace_code WHERE code=?',[codes[1]]);assert.equal(code.status,1);assert.equal(code.batch_id,null)}finally{await db.query('DROP TRIGGER '+trigger)}
   assert.equal(ok(await req(sessionPath+'/events',worker.cookie,{events:[second]})).receipts[0].state,'accepted')
 })
 await check('批量生产1500码；重复与错误留痕，不计入生产数量',async()=>{
   for(let i=2;i<1500;i+=50){const events=codes.slice(i,Math.min(1500,i+50)).map(c=>event(c));const r=ok(await req(sessionPath+'/events',worker.cookie,{events}));assert.equal(r.receipts.length,events.length);assert.ok(r.receipts.every(r=>r.state==='accepted'))}
   const bad='00000000000000000000000000000001'
   const events=[event(codes[0],'duplicate'),event(bad),event(null,'invalid','https://partial/?i=123456')]
   const results=ok(await req(sessionPath+'/events',worker.cookie,{events}));assert.deepEqual(results.receipts.map(r=>r.state),['duplicate','rejected','rejected'])
   const detail=ok(await req(path,admin.cookie));assert.equal(detail.task.used_count,1500);assert.equal(detail.task.reserved_count,500)
   const anomalies=ok(await req(path+'/collection-events',admin.cookie));assert.equal(anomalies.total,3);assert.equal(anomalies.sessions[0].accepted_count,1500);assert.equal(anomalies.sessions[0].duplicate_count,1);assert.equal(anomalies.sessions[0].rejected_count,2)
 })
 await check('多设备竞争同一码只绑定一次，其他设备不能提前结束',async()=>{
   const otherId=randomUUID(),otherPath=path+'/collection-sessions/'+otherId
   ok(await req(path+'/collection-sessions',admin.cookie,{sessionId:otherId,device:'第二台设备'}))
   const otherEvent={...first,eventId:randomUUID(),sequence:1}
   const result=ok(await req(otherPath+'/events',admin.cookie,{events:[otherEvent]}));assert.equal(result.receipts[0].state,'duplicate')
   const done=ok(await req(otherPath+'/complete',admin.cookie,{lastSequence:1,endTask:true}));assert.equal(done.taskEnded,false);assert.equal(done.otherDevices,1)
 })
 await check('序号缺口、变更事件重试、未收齐结束均拒绝且保留原绑定',async()=>{
   const gap={...first,eventId:randomUUID(),sequence:sequence+2};assert.equal(ok(await req(sessionPath+'/events',worker.cookie,{events:[gap]})).ok,false)
   assert.equal(ok(await req(sessionPath+'/events',worker.cookie,{events:[{...first,rawCode:'?i='+codes[1],code:codes[1]}]})).ok,false)
   assert.equal((await req(sessionPath+'/complete',worker.cookie,{lastSequence:sequence+1,endTask:true})).status,409)
 })
 await check('全部收据齐全后结束，500余码待审核；结束重试返回同一收据',async()=>{
   const body={lastSequence:sequence,endTask:true},a=ok(await req(sessionPath+'/complete',worker.cookie,body));assert.equal(a.taskEnded,true);assert.equal(a.taskStatus,'pending');assert.deepEqual(ok(await req(sessionPath+'/complete',worker.cookie,body)),a)
   assert.equal(ok(await req(path,admin.cookie)).task.pending_count,500)
   const late={...first,eventId:randomUUID(),sequence:sequence+1};assert.equal(ok(await req(sessionPath+'/events',worker.cookie,{events:[late]})).ok,false)
 })
 await check('审核退回继续锁定，批准后第二批领用500码，第一批资料保持不变',async()=>{
   ok(await req(path+'/review',admin.cookie,{decision:'reject',reason:'核对包装'}));assert.equal(ok(await req(path,admin.cookie)).task.available_count,0)
   ok(await req(path+'/review',admin.cookie,{decision:'approve',reason:'确认500未用包装'}));assert.equal(ok(await req(path,admin.cookie)).task.available_count,500)
   const t2=ok(await req('/api/admin/production-tasks',admin.cookie,{requestId:randomUUID(),name:tag+'_B',lineName:'三号线',productId:p.insertId,batchNo:tag+'_B',produceDate:'2026-10-11',expireDate:'2027-10-11',qcResult:1,qualityCertNo:'B-001',sourceTaskId:task,quantity:500})).id
   const id2=randomUUID(),bpath='/api/admin/production-tasks/'+t2+'/collection-sessions'
   ok(await req(bpath,admin.cookie,{sessionId:id2,device:'第二批设备'}))
   const events=codes.slice(1500).map((code,i)=>({...first,eventId:randomUUID(),sequence:i+1,rawCode:'半截域名/?i='+code+'&',code}))
   for(let i=0;i<events.length;i+=50)assert.ok(ok(await req(bpath+'/'+id2+'/events',admin.cookie,{events:events.slice(i,i+50)})).receipts.every(r=>r.state==='accepted'))
   assert.equal(ok(await req(bpath+'/'+id2+'/complete',admin.cookie,{lastSequence:500,endTask:true})).taskStatus,'approved')
   const [rows]=await db.query('SELECT batch_no,produce_date,COUNT(*) AS n FROM trace_code WHERE product_id=? GROUP BY batch_no,produce_date',[p.insertId]);assert.deepEqual(rows.map(r=>[r.produce_date,Number(r.n)]).sort(),[['2026-10-10',1500],['2026-10-11',500]])
   const history=ok(await req(path,admin.cookie));assert.equal(history.task.used_count,1500);assert.equal(history.task.available_count,0);assert.equal(history.task.transferred_used_count,500)
 })
 console.log(`设备采集验收完成：${checks}项，2000/1500/500及第二批500码全部通过`)
}finally{await db.end()}
