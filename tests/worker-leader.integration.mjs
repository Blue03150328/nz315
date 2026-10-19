import fs from 'node:fs'
import assert from 'node:assert/strict'
import { parseEnv } from 'node:util'
import { randomUUID, randomBytes, createHmac } from 'node:crypto'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'

const env=parseEnv(fs.readFileSync(process.env.NZ315_TEST_ENV||'.env','utf8'))
const database=process.env.NZ315_TEST_DB,base=process.env.NZ315_TEST_URL||'http://127.0.0.1:38129'
assert.equal(env.DB_HOST,'127.0.0.1');assert.match(database||'',/^pda_worker_test_\d+$/);assert.equal(new URL(base).hostname,'127.0.0.1')
const db=await mysql.createConnection({host:env.DB_HOST,port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD,database,dateStrings:true})
const tag=randomBytes(4).toString('hex'),password=randomBytes(10).toString('hex');let checks=0
async function req(path,auth,body,method=body===undefined?'GET':'POST'){
 const headers={'Content-Type':'application/json'};if(auth?.startsWith('nz315_user='))headers.Cookie=auth;else if(auth)headers.Authorization='Bearer '+auth
 const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),text=await response.text();let data;try{data=JSON.parse(text)}catch{data=text}
 return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]}
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data}
async function check(name,fn){await fn();checks++;console.log('通过：'+name)}
async function user(role,enterprise){const username=role.slice(0,4)+tag+randomBytes(2).toString('hex'),[r]=await db.execute('INSERT INTO user(username,password,name,role,enterprise_id,status,session_epoch) VALUES(?,?,?,?,?,1,1)',[username,await bcrypt.hash(password,4),role+tag,role,enterprise]);return {id:r.insertId,username,role}}
function cookie(u){const payload=u.id+'.'+(Date.now()+3600000)+'.1';return 'nz315_user='+Buffer.from(payload).toString('base64url')+'.'+createHmac('sha256',env.SESSION_SECRET).update(payload).digest('base64url')}
try{
 const [a]=await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES(?,'2099-12-31',1)",['线长验收甲'+tag]),[b]=await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES(?,'2099-12-31',1)",['线长验收乙'+tag])
 const admin=await user('enterprise_admin',a.insertId),otherAdmin=await user('enterprise_admin',b.insertId),worker=await user('production_operator',a.insertId),second=await user('production_operator',a.insertId),foreign=await user('production_operator',b.insertId)
 const ac=(await req('/api/auth/login','',{username:admin.username,password})).cookie,bc=(await req('/api/auth/login','',{username:otherAdmin.username,password})).cookie
 let leader
 await check('现有用户管理可新增线长，厂家无法提升为总部管理员',async()=>{
  const username='lead'+tag;leader={id:ok(await req('/api/admin/users',ac,{username,password,name:'验收线长',role:'line_leader'})).id,username}
  assert.equal((await req('/api/admin/users',ac,{username:'root'+tag,password,role:'platform_admin'})).status,403)
 })
 async function device(backend,name){const d=ok(await req('/api/admin/production-devices',backend,{name})),activation=JSON.parse(Buffer.from(d.activationCode.slice(13),'base64url')),secret=randomBytes(32).toString('hex');ok(await req('/api/device/activate','',{token:activation.token,credential:secret,instanceId:randomUUID(),model:'isolated-leader'}));return secret}
 await db.execute('UPDATE user SET session_epoch=1 WHERE id=?',[leader.id]);
 const d1=await device(ac,'验收甲设备'),d2=await device(ac,'验收乙设备'),foreignDevice=await device(bc,'其他厂设备')
 const login=(d,u)=>req('/api/device/operator/login',d,{username:u.username,password}).then(ok)
 const w=await login(d1,worker),w2=await login(d2,second),l=await login(d1,leader),f=await login(foreignDevice,foreign)
 await check('普工与线长仅能登录APP，正确签名的后台会话也被拒绝',async()=>{
  assert.equal(w.identity.role,'production_operator');assert.equal(l.identity.role,'line_leader')
  for(const u of [worker,leader]){assert.equal((await req('/api/auth/login','',{username:u.username,password})).status,403);assert.equal((await req('/api/admin/users',cookie(u))).status,403)}
  assert.equal((await req('/api/device/operator/login',foreignDevice,{username:leader.username,password})).status,401)
 })
 async function open(d,grant,context={mode:'external',name:'原始网址采集'}){const sessionId=randomUUID(),runId=randomUUID();ok(await req('/api/device/worker-sessions',d,{sessionId,runId,grant:grant.grant,startedAt:new Date().toISOString(),context}));return {sessionId,runId}}
 const s1=await open(d1,w),s2=await open(d2,w2),sf=await open(foreignDevice,f)
 const events=[1,2].map((sequence)=>({eventId:randomUUID(),sequence,rawCode:'https://vendor.example/raw?complete=0001',code:null,kind:sequence===1?'valid':'duplicate',capturedAt:new Date().toISOString()}))
 const ack=ok(await req('/api/device/worker-sessions/'+s1.sessionId+'/events',d1,{events}))
 await check('响应丢失重传仍为原收据，人数与跨设备归属保持原员工',async()=>{
  assert.deepEqual(ok(await req('/api/device/worker-sessions/'+s1.sessionId+'/events',d1,{events})),ack)
  const [rows]=await db.query('SELECT s.user_id,COUNT(e.id) n FROM worker_session s JOIN worker_event e ON e.session_id=s.id WHERE s.id=? GROUP BY s.id',[s1.sessionId]);assert.equal(rows[0].user_id,worker.id);assert.equal(rows[0].n,2)
 })
 await check('普工不能越权读取全厂、详情或导出；线长凭证不能移到另一设备',async()=>{
  for(const path of ['', '/detail','/download'])assert.equal((await req('/api/device/leader-records'+path,d1,{grant:w.grant,sessionId:s1.sessionId})).status,403)
  assert.equal((await req('/api/device/leader-records',d2,{grant:l.grant})).status,401)
 })
 await check('线长看到本厂所有生产线和设备的员工会话，不暴露其他厂数据',async()=>{
  const list=ok(await req('/api/device/leader-records',d1,{grant:l.grant}));assert.equal(list.total,2);assert.deepEqual(new Set(list.rows.map(r=>r.identity.id)),new Set([worker.id,second.id]));assert.ok(!list.rows.some(r=>r.id===sf.sessionId))
  assert.equal((await req('/api/device/leader-records/detail',d1,{grant:l.grant,sessionId:sf.sessionId})).status,404)
  assert.equal((await req('/api/device/leader-records/download',d1,{grant:l.grant,sessionId:sf.sessionId})).status,404)
 })
 const actions=['start','pause','resume','end'].map((kind,i)=>({eventId:randomUUID(),sequence:i+1,kind,capturedAt:new Date().toISOString()}))
 await check('暂停日志独立于扫码计数，顺序缺口和错误重试均拒绝',async()=>{
  const path='/api/device/worker-sessions/'+s1.sessionId+'/actions'
  assert.equal((await req(path,d1,{actions:[actions[1]]})).status,409)
  const a=ok(await req(path,d1,{actions:actions.slice(0,2)}));assert.deepEqual(ok(await req(path,d1,{actions:actions.slice(0,2)})),a)
  assert.equal((await req(path,d1,{actions:[{...actions[0],kind:'end'}]})).status,409)
  assert.equal((await req(path,d2,{actions:[actions[0]]})).status,404)
  const detail=ok(await req('/api/device/leader-records/detail',d1,{grant:l.grant,sessionId:s1.sessionId}));assert.equal(detail.record.summary.total,2);assert.equal(detail.actions.length,2);assert.equal(detail.events[0].rawCode,events[0].rawCode)
 })
 await check('操作尚未上传完整不能完成，会话上传完成后保持真实结束时间',async()=>{
  const path='/api/device/worker-sessions/'+s1.sessionId
  assert.equal((await req(path+'/complete',d1,{lastSequence:2,lastActionSequence:4})).status,409)
  ok(await req(path+'/actions',d1,{actions:actions.slice(2)}));const stoppedAt=new Date().toISOString();ok(await req(path+'/complete',d1,{lastSequence:2,lastActionSequence:4,stoppedAt}));ok(await req(path+'/complete',d1,{lastSequence:2,lastActionSequence:4,stoppedAt}))
  const detail=ok(await req('/api/device/leader-records/detail',d1,{grant:l.grant,sessionId:s1.sessionId,result:'duplicate'}));assert.equal(detail.total,1);assert.equal(detail.record.stoppedAt,stoppedAt);assert.ok(detail.record.uploadedAt);assert.equal(detail.actions.length,4)
 })
 await check('线长导出保留员工和完整原文，导出日志另记实际下载人',async()=>{
  const out=ok(await req('/api/device/leader-records/download',d1,{grant:l.grant,sessionId:s1.sessionId}));assert.match(out.text,/https:\/\/vendor.example\/raw\?complete=0001/);assert.equal(out.record.identity.id,worker.id)
  const [rows]=await db.query("SELECT actor_id,detail FROM worker_audit WHERE run_id=? AND action='leader_export'",[s1.runId]);assert.equal(rows.at(-1).actor_id,leader.id);assert.equal((typeof rows.at(-1).detail==='string'?JSON.parse(rows.at(-1).detail):rows.at(-1).detail).captureUserId,worker.id)
 })
 await check('线长可生产；云端产品快照包含商标规格，签名TXT保留操作日志且重导入不重复生产',async()=>{
  const [spec]=await db.execute("INSERT INTO product_spec(enterprise_id,spec_code,spec_name) VALUES(?,'001','200毫升')",[a.insertId]);
  const [product]=await db.execute("INSERT INTO product(enterprise_id,name,trademark,content,dosage,registration_no,registration_expire,reg_category,produce_type,spec_id,status) VALUES(?,'完整产品','固定商标','10%','水剂',?,'2099-12-31',1,1,?,1)",[a.insertId,'PD'+String(Date.now()).slice(-6),spec.insertId]);
  const context={mode:'production',lineWorkflow:true,stockWorkflow:true,unifiedScan:true,autoLine:true,taskId:0,lineName:'线长生产验收线'+tag,productId:product.insertId,batchNo:'LEADER-'+tag,produceDate:'2026-10-16',expireDate:'2028-10-16'};
  const production=await open(d1,l,context),path='/api/device/worker-sessions/'+production.sessionId;
  const ops=['start','end'].map((kind,i)=>({eventId:randomUUID(),sequence:i+1,kind,capturedAt:new Date().toISOString()}));ok(await req(path+'/actions',d1,{actions:ops}));ok(await req(path+'/complete',d1,{lastSequence:0,lastActionSequence:2,stoppedAt:new Date().toISOString()}));ok(await req('/api/device/worker-runs/'+production.runId+'/complete',d1,{sessions:[{id:production.sessionId,lastSequence:0}]}));
  const detail=ok(await req('/api/device/leader-records/detail',d1,{grant:l.grant,sessionId:production.sessionId}));assert.equal(detail.record.context.productName,'完整产品');assert.equal(detail.record.context.trademark,'固定商标');assert.equal(detail.record.context.specName,'200毫升');assert.equal(detail.record.identity.id,leader.id);
  const exported=ok(await req('/api/device/leader-records/download',d1,{grant:l.grant,sessionId:production.sessionId}));const payload=JSON.parse(JSON.parse(exported.text.trim().split('\n')[1]).payload);assert.equal(payload.actions.length,2);assert.equal(payload.grantId,l.grantId);
  assert.equal(ok(await req('/api/admin/production-records/import',ac,{content:exported.text,preview:true})).sessions,1);ok(await req('/api/admin/production-records/import',ac,{content:exported.text}));const [counts]=await db.query('SELECT COUNT(*) n FROM worker_action WHERE session_id=?',[production.sessionId]);assert.equal(counts[0].n,2);
 })
 await check('修改权限不能提升后台权限；线长降为普工后旧授权立刻失去云端查询权',async()=>{
  assert.equal((await req('/api/admin/users/'+worker.id,ac,{role:'platform_admin'},'PATCH')).status,403)
  ok(await req('/api/admin/users/'+leader.id,ac,{name:'原线长',role:'production_operator'},'PATCH'));assert.equal((await req('/api/device/leader-records',d1,{grant:l.grant})).status,401)
  const next=await login(d1,leader);assert.equal(next.identity.role,'production_operator');assert.equal((await req('/api/device/leader-records',d1,{grant:next.grant})).status,403)
 })
 console.log('线长/普工隔离验收通过 '+checks+' 组；仅写入 '+database)
} finally {await db.end()}

