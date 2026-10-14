import fs from 'node:fs'
import assert from 'node:assert/strict'
import {parseEnv} from 'node:util'
import {randomUUID,randomBytes,createHmac} from 'node:crypto'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
const env=parseEnv(fs.readFileSync(process.env.NZ315_TEST_ENV||'.env','utf8'))
assert.equal(env.DB_HOST,'127.0.0.1');assert.match(process.env.NZ315_TEST_DB||'',/^pda_worker_test_\d+$/)
const base=process.env.NZ315_TEST_URL||'http://127.0.0.1:38128';assert.equal(new URL(base).hostname,'127.0.0.1')
const db=await mysql.createConnection({host:env.DB_HOST,port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD,database:process.env.NZ315_TEST_DB,dateStrings:true})
const tag=randomBytes(5).toString('hex'),password=randomBytes(15).toString('hex');let checks=0
async function req(path,auth,body,method=body===undefined?'GET':'POST'){
 const headers={'Content-Type':'application/json'};if(auth?.startsWith('nz315_user='))headers.Cookie=auth;else if(auth)headers.Authorization='Bearer '+auth
 const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text};return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]}
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data}
async function check(name,fn){await fn();console.log('通过：'+name);checks++}
async function user(role,ent){const username=role.slice(0,6)+tag+randomBytes(2).toString('hex'),[r]=await db.execute('INSERT INTO user(username,password,name,role,enterprise_id,status) VALUES(?,?,?,?,?,1)',[username,await bcrypt.hash(password,4),'统一采集验收',role,ent]);return {id:r.insertId,username}}
try{
 const [ent]=await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES(?,'2099-12-31',1)",['统一生产隔离'+tag]),admin=await user('enterprise_admin',ent.insertId),worker=await user('production_operator',ent.insertId),viewer=await user('viewer',ent.insertId)
 const cookie=(await req('/api/auth/login','',{username:admin.username,password})).cookie,viewerCookie=(await req('/api/auth/login','',{username:viewer.username,password})).cookie
 const [spec]=await db.execute("INSERT INTO product_spec(enterprise_id,spec_code,spec_name) VALUES(?,'001','200毫升')",[ent.insertId])
 const reg='PD'+String(Date.now()).slice(-8),[product]=await db.execute("INSERT INTO product(enterprise_id,name,registration_no,registration_expire,reg_category,produce_type,spec_id,status) VALUES(?,?,?,'2099-12-31',1,1,?,1)",[ent.insertId,'统一标签产品'+tag,reg,spec.insertId])
 const head='1'+reg.slice(-6)+'1001',code=head+'000000000000000000001'
 async function device(){const add=ok(await req('/api/admin/production-devices',cookie,{name:'混合终端'+randomBytes(2).toString('hex'),lineName:'共用线'})),activate=JSON.parse(Buffer.from(add.activationCode.slice(13),'base64url')),secret=randomBytes(32).toString('hex');ok(await req('/api/device/activate','',{token:activate.token,credential:secret,instanceId:randomUUID(),model:'isolated'}));return {secret,grant:ok(await req('/api/device/operator/login',secret,{username:worker.username,password}))}}
 const a=await device(),b=await device(),context={mode:'production',lineWorkflow:true,stockWorkflow:true,unifiedScan:true,autoLine:true,taskId:0,lineName:'共用线',productId:product.insertId,batchNo:'UNIFIED-'+tag,produceDate:'2026-10-14',expireDate:'2027-10-14'}
 async function open(d,c=context){const r={runId:randomUUID(),sessionId:randomUUID(),startedAt:new Date().toISOString(),grant:d.grant.grant,context:c};return {...r,...ok(await req('/api/device/worker-sessions',d.secret,r))}}
 const left=await open(a),right=await open(b);assert.equal(left.context.taskId,right.context.taskId);const task=left.context.taskId
 const event=(rawCode,sequence,kind='valid',codeValue=null)=>({eventId:randomUUID(),rawCode,code:codeValue,sequence,kind,capturedAt:new Date().toISOString()})
 const foreign='https://label.example/view?site=nz315.cn&code='+code
 const incoming=[event('https://nz315.cn/trace?code='+code,1,'valid',code),event(foreign,2),event('https://nz315.cn/other?code='+code,3),event('https://nz315.cn/trace?code=123',4),event('无法识别的内容',5)]
 let initial
 await check('两个设备同线登记同一任务；混合扫码先分来源再校验',async()=>{
  initial=ok(await req('/api/device/worker-sessions/'+left.sessionId+'/events',a.secret,{events:incoming}));assert.deepEqual(initial.receipts.map(r=>r.state),['saved','saved','exception','exception','exception']);assert.deepEqual(initial.receipts.map(r=>r.classification),['internal','external','unparsed','unparsed','unparsed'])
  const [[internal]]=await db.query('SELECT * FROM trace_code WHERE code=?',[code]);assert.equal(internal.batch_no,context.batchNo)
  const [[external]]=await db.query('SELECT * FROM external_collection_batch WHERE id=?',[left.sessionId]);assert.equal(external.product_id,product.insertId);assert.equal(external.product_name_snapshot,'统一标签产品'+tag);assert.equal(external.line_name_snapshot,'共用线');assert.equal(external.batch_no,context.batchNo);assert.equal(external.produce_date,context.produceDate)
 })
 await check('原UUID重播收据不变，外码的32位参数不会投影进入内部码库',async()=>{
  assert.deepEqual(ok(await req('/api/device/worker-sessions/'+left.sessionId+'/events',a.secret,{events:incoming})),initial)
  const [[count]]=await db.query('SELECT COUNT(*) AS n FROM trace_code WHERE enterprise_id=?',[ent.insertId]);assert.equal(count.n,1)
  const [[eventRow]]=await db.query('SELECT code,raw_code FROM worker_event WHERE id=?',[incoming[1].eventId]);assert.equal(eventRow.code,null);assert.equal(eventRow.raw_code,foreign)
 })
 await check('另一设备重复外码只返回重复，内外码总数无双计',async()=>{
  const ack=ok(await req('/api/device/worker-sessions/'+right.sessionId+'/events',b.secret,{events:[event(foreign,1)]}));assert.equal(ack.receipts[0].state,'duplicate')
  const list=ok(await req('/api/admin/production-lines',cookie));const row=list.rows.find(r=>r.id===task);assert.equal(row.internal_count,1);assert.equal(row.external_count,1);assert.equal(row.collected,2)
  const detail=ok(await req('/api/admin/production-tasks/'+task+'/worker-progress',cookie));assert.equal(detail.sessions.reduce((n,s)=>n+s.cloud_valid,0),2);assert.equal(detail.sessions.reduce((n,s)=>n+s.internal_count,0),1);assert.equal(detail.sessions.reduce((n,s)=>n+s.external_count,0),1)
 })
 const concurrent='https://label.example/unique?id='+tag
 const races=[event(concurrent,6),event(concurrent,2)]
 await check('跨设备并发外码唯一键裁定，仅一次入库',async()=>{
  const ack=await Promise.all([req('/api/device/worker-sessions/'+left.sessionId+'/events',a.secret,{events:[races[0]]}),req('/api/device/worker-sessions/'+right.sessionId+'/events',b.secret,{events:[races[1]]})]);assert.deepEqual(ack.map(ok).map(r=>r.receipts[0].state).sort(),['duplicate','saved'])
  const [[total]]=await db.query('SELECT COUNT(*) AS n FROM external_trace_code WHERE enterprise_id=? AND raw_code=?',[ent.insertId,concurrent]);assert.equal(total.n,1)
 })
 await check('收据写入失败时外码、批次计数和会话序号整体回滚',async()=>{
  const bad=event('https://label.example/rollback?id='+tag,7),trigger='unified_rollback_'+tag
  await db.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON worker_event FOR EACH ROW BEGIN IF NEW.id='${bad.eventId}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated rollback'; END IF; END`)
  try{assert.equal((await req('/api/device/worker-sessions/'+left.sessionId+'/events',a.secret,{events:[bad]})).status,500)}finally{await db.query('DROP TRIGGER '+trigger)}
  const [[total]]=await db.query('SELECT COUNT(*) AS n FROM external_trace_code WHERE raw_code=?',[bad.rawCode]);assert.equal(total.n,0)
  const [[session]]=await db.query('SELECT last_sequence FROM worker_session WHERE id=?',[left.sessionId]);assert.equal(session.last_sequence,6)
  assert.equal(ok(await req('/api/device/worker-sessions/'+left.sessionId+'/events',a.secret,{events:[bad]})).receipts[0].state,'saved')
 })
 await check('任务外码明细按企业鉴权，异常不混入有效码列表',async()=>{
  const list=ok(await req('/api/admin/production-tasks/'+task+'/external-codes',cookie));assert.equal(list.filteredTotal,3);assert.ok(list.rows.every(r=>r.batch_no===context.batchNo))
  assert.equal((await req('/api/admin/production-tasks/'+task+'/external-codes','')).status,401)
  assert.equal((await req('/api/admin/external-collections/'+left.sessionId,viewerCookie,{productName:'改写',productId:null,batchNo:'x',produceDate:'2026-10-14',productionQuantity:null},'PATCH')).status,403)
 })
 await check('完整结束序号收齐才自动完工，外码批次随同会话结束',async()=>{
  assert.equal((await req('/api/device/worker-sessions/'+left.sessionId+'/complete',a.secret,{lastSequence:8})).status,409)
  for(const [s,d,n] of [[left,a,7],[right,b,2]]){ok(await req('/api/device/worker-sessions/'+s.sessionId+'/complete',d.secret,{lastSequence:n}));const result=ok(await req('/api/device/worker-runs/'+s.runId+'/complete',d.secret,{sessions:[{id:s.sessionId,lastSequence:n}]}));assert.equal(result.taskEnded,s===right)}
  const [[batch]]=await db.query('SELECT state FROM external_collection_batch WHERE id=?',[left.sessionId]);assert.equal(batch.state,'completed')
  const library=ok(await req('/api/admin/codes/usage-batches?productId='+product.insertId,cookie));assert.equal(library.rows.reduce((n,r)=>n+r.codeTotal,0),1)
 })
 await check('内外库导出各自实际码，外码直接携带生产资料',async()=>{
  const rows=ok(await req('/api/admin/external-collections?keyword='+context.batchNo,cookie));assert.ok(rows.rows.every(r=>r.product_id===product.insertId&&r.batch_no===context.batchNo))
  const exported=await req('/api/admin/external-collections/'+left.sessionId+'/export?format=txt',cookie);ok(exported);assert.ok(exported.data.includes(foreign));assert.ok(!exported.data.includes('\r\n'+code+'\r\n'))
 })
 await check('离线签名TXT重导幂等；历史事件原文、身份和收据保持',async()=>{
  const before=JSON.stringify((await db.query('SELECT * FROM worker_event WHERE session_id=? ORDER BY sequence_no',[left.sessionId]))[0])
  const events=ok(await req('/api/admin/production-tasks/'+task+'/worker-progress?userId='+worker.id,cookie)).events.filter(e=>e.session_id===left.sessionId)
  // 单个会话完整清单来自服务器保存的原事件，签名字段保持原生产协议。
  const finalEvents=events.sort((a,b)=>a.sequence_no-b.sequence_no).map(e=>({eventId:e.id,sequence:e.sequence_no,rawCode:e.raw_code,code:e.code,kind:e.kind,capturedAt:new Date(e.captured_at.replace(' ','T')+'Z').toISOString()}))
  const data={grantId:a.grant.grantId,sessionId:left.sessionId,startedAt:left.startedAt,finalSequence:7,events:finalEvents,run:{id:left.runId,context:left.context,sealed:true,sessions:[{id:left.sessionId,lastSequence:7}]}}
  const payload=JSON.stringify(data),content='NZ315-PRODUCTION-RECORDS/1\n'+JSON.stringify({payload,signature:createHmac('sha256',a.grant.exportKey).update(payload).digest('hex')})+'\n'
  ok(await req('/api/admin/production-records/import',cookie,{content,fileName:'unified-offline.txt'}));assert.equal(JSON.stringify((await db.query('SELECT * FROM worker_event WHERE session_id=? ORDER BY sequence_no',[left.sessionId]))[0]),before)
 })
 await check('仅外码有效采集也启动生产状态，重复与异常不冒充已开工',async()=>{
  const next=await open(a,{...context,batchNo:'EXTERNAL-ONLY-'+tag}),nextTask=next.context.taskId
  assert.notEqual(nextTask,task)
  ok(await req('/api/device/worker-sessions/'+next.sessionId+'/events',a.secret,{events:[event(foreign,1)]}))
  let rows=ok(await req('/api/admin/production-lines',cookie)).rows,row=rows.find(r=>r.id===nextTask);assert.equal(row.display_status,'not_started');assert.equal(row.collected,0)
  ok(await req('/api/device/worker-sessions/'+next.sessionId+'/events',a.secret,{events:[event('https://label.example/external-only?id='+tag,2)]}))
  rows=ok(await req('/api/admin/production-lines',cookie)).rows;row=rows.find(r=>r.id===nextTask);assert.equal(row.display_status,'active');assert.equal(row.internal_count,0);assert.equal(row.external_count,1);assert.equal(row.collected,1)
  assert.ok(ok(await req('/api/admin/production-lines?status=active',cookie)).rows.some(r=>r.id===nextTask))
  ok(await req('/api/device/worker-sessions/'+next.sessionId+'/complete',a.secret,{lastSequence:2}));ok(await req('/api/device/worker-runs/'+next.runId+'/complete',a.secret,{sessions:[{id:next.sessionId,lastSequence:2}]}))
 })
 fs.mkdirSync('.tools',{recursive:true});fs.writeFileSync('.tools/ui-private.json',JSON.stringify({cookie,username:admin.username,password,product:product.insertId,task}))
 console.log('统一生产：'+checks+'组真实隔离SQL/HTTP通过')
}finally{await db.end()}
