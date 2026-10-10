import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parseEnv} from 'node:util'
import {randomBytes,randomUUID} from 'node:crypto'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
const env=parseEnv(fs.readFileSync('.env','utf8'))
assert.equal(env.DB_HOST,'127.0.0.1');assert.match(env.DB_NAME,/^pda_queue_test_[0-9]+$/)
const base=process.env.NZ315_TEST_BASE||'http://127.0.0.1:38122';assert.equal(new URL(base).hostname,'127.0.0.1')
const db=await mysql.createConnection({host:env.DB_HOST,user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,dateStrings:true})
const tag='__devices_'+Date.now(),password=randomBytes(16).toString('hex')
let checks=0
async function check(name,fn){await fn();console.log('通过：'+name);checks++}
async function req(path,auth='',body,method=body===undefined?'GET':'POST'){
 const headers={'Content-Type':'application/json'};if(auth.startsWith('nz315_user='))headers.cookie=auth;else if(auth)headers.authorization='Bearer '+auth
 const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)})
 return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data}
async function account(role,enterprise){const username=tag+'_'+randomBytes(3).toString('hex');const [r]=await db.execute('INSERT INTO user(username,password,name,role,enterprise_id,status) VALUES (?,?,?,?,?,1)',[username,await bcrypt.hash(password,4),tag,role,enterprise]);return {id:r.insertId,username,cookie:okLogin(await req('/api/auth/login','',{username,password}))}}
const okLogin=r=>{ok(r);return r.cookie}
const tokenOf=code=>JSON.parse(Buffer.from(code.slice(13),'base64url')).token
const event=(code,sequence=1)=>({eventId:randomUUID(),sequence,rawCode:'半截网址/?i='+code,code,kind:'valid',capturedAt:new Date().toISOString(),reason:''})
try{
 const [e]=await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES (?,'2099-12-31',1)",[tag]),[e2]=await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES (?,'2099-12-31',1)",[tag+'_other'])
 let admin=await account('enterprise_admin',e.insertId),worker=await account('code_admin',e.insertId),alien=await account('enterprise_admin',e2.insertId)
 const [spec]=await db.execute("INSERT INTO product_spec(enterprise_id,spec_code,spec_name,net_content,content_unit,pack_unit) VALUES (?,'001','规格',1,'克','袋')",[e.insertId])
 const reg='PD'+String(Date.now()).slice(-8),head='1'+reg.slice(-6)+'1001'
 const [p]=await db.execute("INSERT INTO product(enterprise_id,name,registration_no,registration_expire,reg_category,produce_type,spec_id,status) VALUES (?,?,?,'2099-12-31',1,1,?,1)",[e.insertId,tag,reg,spec.insertId])
 const codes=Array.from({length:50},(_,i)=>head+String(i+1).padStart(21,'0'))
 const [upload]=await db.execute('INSERT INTO upload_batch(enterprise_id,file_name,product_id,created_by) VALUES (?,?,?,?)',[e.insertId,tag,p.insertId,admin.id])
 await db.query('INSERT INTO trace_code(enterprise_id,product_id,upload_batch_id,code,status,abnormal_flag) VALUES '+codes.map(()=>'(?,?,?,?,1,0)').join(','),codes.flatMap(c=>[e.insertId,p.insertId,upload.insertId,c]))
 async function task(line,quantity){return ok(await req('/api/admin/production-tasks',admin.cookie,{requestId:randomUUID(),name:tag+line,lineName:line,productId:p.insertId,batchNo:tag+line,produceDate:'2026-10-10',expireDate:'2027-10-10',qcResult:1,qualityCertNo:'001',sourceUploadBatchId:upload.insertId,quantity})).id}
 const t1=await task('一号线',30),t2=await task('二号线',20),devicesPath='/api/admin/production-devices'
 let a,b,c,ac,bc,cc,instanceA=randomUUID(),instanceB=randomUUID(),secretA=randomBytes(32).toString('hex'),secretB=randomBytes(32).toString('hex'),secretC=randomBytes(32).toString('hex')
 await check('仅管理员登记，厂家归属取服务端，列表和选项企业隔离',async()=>{
  const body={name:'测试PDA-A',lineName:'一号线',enterpriseId:e2.insertId}
  assert.equal((await req(devicesPath,'',body)).status,401);assert.equal((await req(devicesPath,worker.cookie,body)).status,403)
  a=ok(await req(devicesPath,admin.cookie,body));b=ok(await req(devicesPath,admin.cookie,{name:'测试PDA-B',lineName:'一号线'}));c=ok(await req(devicesPath,admin.cookie,{name:'测试PDA-C',lineName:'二号线'}))
  assert.ok(ok(await req(devicesPath,admin.cookie)).rows.every(r=>Number(r.enterprise_id)===e.insertId));assert.equal(ok(await req(devicesPath,alien.cookie)).rows.length,0)
  assert.equal(ok(await req(devicesPath+'/options',admin.cookie)).enterprises.length,1)
 })
 const activate=(x,secret,instance)=>req('/api/device/activate','',{token:tokenOf(x.activationCode),credential:secret,instanceId:instance,model:'UROVO Android12',androidId:'test-id'})
 await check('一次性激活码与响应丢失幂等重试，不凭设备号授权',async()=>{
  ok(await activate(a,secretA,instanceA));ok(await activate(a,secretA,instanceA));assert.equal((await activate(a,secretB,instanceB)).status,409)
  assert.equal((await req('/api/device/context','',{deviceId:a.id})).status,401)
  assert.equal((await activate(b,secretB,instanceA)).status,409)
  ok(await activate(b,secretB,instanceB));ok(await activate(c,secretC,randomUUID()))
  ac=ok(await req('/api/device/context',secretA));bc=ok(await req('/api/device/context',secretB));cc=ok(await req('/api/device/context',secretC));assert.equal(ac.device.enterprise_id,e.insertId)
  assert.equal((await req('/api/admin/production-tasks',secretA)).status,401);assert.equal((await req(devicesPath,secretA)).status,401)
 })
 await check('独立设备认证不挤下线，保留后台账号单登录规则',async()=>{
  const newer=await req('/api/auth/login','',{username:admin.username,password});ok(newer)
  assert.equal((await req(devicesPath,admin.cookie)).status,401);admin.cookie=newer.cookie
  ok(await req('/api/device/context',secretA));ok(await req('/api/device/context',secretB))
 })
 const taskPath='/api/device/production-tasks/'+t1,idA=randomUUID(),idB=randomUUID(),pathA=taskPath+'/collection-sessions/'+idA,pathB=taskPath+'/collection-sessions/'+idB
 let seq=0
 await check('任务仅本企业本产线，跨线请求和跨设备会话拒绝',async()=>{
  const rows=ok(await req('/api/device/production-tasks',secretA)).rows;assert.deepEqual(rows.map(r=>r.id),[t1]);assert.equal((await req('/api/device/production-tasks/'+t2,secretA)).status,403)
  assert.equal((await req(taskPath+'/collection-sessions',secretC,{sessionId:randomUUID(),device:'假设备'})).status,403)
  ok(await req(taskPath+'/collection-sessions',secretA,{sessionId:idA,device:'伪造公司设备'}));ok(await req(taskPath+'/collection-sessions',secretB,{sessionId:idB,device:'B'}))
  assert.equal(ok(await req(pathA+'/events',secretB,{events:[event(codes[0])]})).statusCode,403)
 })
 const first=event(codes[0],++seq)
 await check('不同网址按码去重，事件收据重传和多设备竞争只绑定一次',async()=>{
  const r=ok(await req(pathA+'/events',secretA,{events:[first]}));assert.equal(r.receipts[0].state,'accepted');assert.deepEqual(ok(await req(pathA+'/events',secretA,{events:[first]})).receipts,r.receipts)
  assert.equal(ok(await req(pathB+'/events',secretB,{events:[event(codes[0])]})).receipts[0].state,'duplicate')
  const [[row]]=await db.query('SELECT used_by,device,used_line FROM production_task_code WHERE task_id=? AND code=?',[t1,codes[0]]);assert.equal(row.used_by,null);assert.match(row.device,/设备/);assert.equal(row.used_line,'一号线')
 })
 await check('未结束采集禁止删除、重新激活和调线，改设备名不破坏原会话',async()=>{
  for(const body of [{action:'delete'},{action:'activate'},{action:'edit',name:'A',lineName:'二号线'}])assert.equal((await req(devicesPath+'/'+a.id,admin.cookie,body,'PATCH')).status,409)
  ok(await req(devicesPath+'/'+a.id,admin.cookie,{action:'edit',name:'改名A',lineName:'一号线'},'PATCH'))
  assert.equal(ok(await req(taskPath+'/collection-sessions',secretA,{sessionId:idA,device:'新名称'})).sessionId,idA)
 })
 const second=event(codes[1],++seq)
 await check('停用拒绝新的绑定，启用后原事件续传；停用不丢记录',async()=>{
  ok(await req(devicesPath+'/'+a.id,admin.cookie,{action:'disable'},'PATCH'));assert.equal((await req('/api/device/context',secretA)).status,403)
  assert.equal((await req(pathA+'/events',secretA,{events:[second]})).status,403)
  const [[code]]=await db.query('SELECT status FROM trace_code WHERE code=?',[codes[1]]);assert.equal(code.status,1)
  ok(await req(devicesPath+'/'+a.id,admin.cookie,{action:'enable'},'PATCH'));assert.equal(ok(await req(pathA+'/events',secretA,{events:[second]})).receipts[0].state,'accepted')
 })
 await check('任务调线后仍能排空原快照，但不能新增其他产线采集',async()=>{
  ok(await req('/api/admin/production-tasks/'+t1,admin.cookie,{requestId:randomUUID(),lineName:'改名线'},'PATCH'))
  assert.equal(ok(await req(pathA+'/events',secretA,{events:[event(codes[2],++seq)]})).receipts[0].state,'accepted')
  assert.equal((await req(taskPath+'/collection-sessions',secretA,{sessionId:randomUUID(),device:'A'})).status,403)
  const [[detail]]=await db.query('SELECT used_line FROM production_task_code WHERE task_id=? AND code=?',[t1,codes[2]]);assert.equal(detail.used_line,'一号线')
 })
 await check('停用与批量提交并发：已确认记录完整，未确认事件启用后原样重传',async()=>{
  const events=codes.slice(3,13).map((code,i)=>event(code,seq+i+1))
  const [upload,stop]=await Promise.all([req(pathA+'/events',secretA,{events}),req(devicesPath+'/'+a.id,admin.cookie,{action:'disable'},'PATCH')]);ok(stop)
  assert.ok([200,403].includes(upload.status));if(upload.status===200)assert.ok(upload.data.receipts.every(r=>r.state==='accepted'))
  const [[before]]=await db.query('SELECT last_sequence FROM production_collection_session WHERE id=?',[idA])
  assert.equal((await req(pathA+'/events',secretA,{events:[event(codes[13],Number(before.last_sequence)+1)]})).status,403)
  const [[after]]=await db.query('SELECT last_sequence FROM production_collection_session WHERE id=?',[idA]);assert.equal(after.last_sequence,before.last_sequence)
  ok(await req(devicesPath+'/'+a.id,admin.cookie,{action:'enable'},'PATCH'))
  const retry=ok(await req(pathA+'/events',secretA,{events}));assert.equal(retry.receipts.length,events.length);assert.ok(retry.receipts.every(r=>r.state==='accepted'));seq+=events.length
  const [[count]]=await db.query("SELECT COUNT(*) AS n FROM production_task_code WHERE task_id=? AND state='used'",[t1]);assert.equal(Number(count.n),13)
 })
 await check('关闭需收齐记录，其他设备未关闭不能结束任务，审核权限仍由管理员持有',async()=>{
  assert.equal((await req(pathA+'/complete',secretA,{lastSequence:seq+1,endTask:true})).status,409)
  assert.equal(ok(await req(pathA+'/complete',secretA,{lastSequence:seq,endTask:true})).taskEnded,false)
  const result=ok(await req(pathB+'/complete',secretB,{lastSequence:1,endTask:true}));assert.equal(result.taskEnded,true);assert.equal(result.taskStatus,'pending')
  assert.deepEqual(ok(await req(pathB+'/complete',secretB,{lastSequence:1,endTask:true})),result)
  assert.equal((await req('/api/admin/production-tasks/'+t1+'/review',secretA,{decision:'approve',reason:'伪造审核'})).status,401)
 })
 await check('逻辑删除撤销凭证但保留设备历史和生产快照',async()=>{
  ok(await req(devicesPath+'/'+a.id,admin.cookie,{action:'delete'},'PATCH'));assert.equal((await req('/api/device/context',secretA)).status,401)
  assert.ok(!ok(await req(devicesPath,admin.cookie)).rows.some(r=>r.id===a.id));assert.ok(ok(await req(devicesPath+'/'+a.id+'/history',admin.cookie)).rows.some(r=>r.action==='delete'))
  const [[saved]]=await db.query('SELECT device_id,line_snapshot FROM production_collection_session WHERE id=?',[idA]);assert.equal(saved.device_id,a.id);assert.equal(saved.line_snapshot,'一号线')
  const newly=ok(await req(devicesPath,admin.cookie,{name:'删除后重新登记A',lineName:'一号线'}));ok(await activate(newly,randomBytes(32).toString('hex'),instanceA))
 })
 await check('重新激活撤销旧凭证，过期码和旧激活码拒绝，管理历史完整',async()=>{
  const fresh=ok(await req(devicesPath+'/'+c.id,admin.cookie,{action:'activate'},'PATCH'));assert.equal((await req('/api/device/context',secretC)).status,401)
  assert.equal((await activate(c,secretC,randomUUID())).status,403)
  await db.execute('UPDATE production_device_activation SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE token_hash=SHA2(?,256)',[tokenOf(fresh.activationCode)])
  assert.equal((await activate(fresh,randomBytes(32).toString('hex'),randomUUID())).status,400)
  const newer=ok(await req(devicesPath+'/'+c.id,admin.cookie,{action:'activate'},'PATCH')),secret=randomBytes(32).toString('hex')
  ok(await activate(newer,secret,randomUUID()));ok(await req('/api/device/context',secret))
  await req('/api/device/context',secret,{pending:5});assert.equal(ok(await req(devicesPath,admin.cookie)).rows.find(r=>r.id===c.id).reported_pending,5)
 })
 console.log('设备登记验收完成：'+checks+'项')
}finally{await db.end()}
