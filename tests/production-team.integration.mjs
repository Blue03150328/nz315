import fs from 'node:fs';import assert from 'node:assert/strict';import {parseEnv} from 'node:util';import {createRequire} from 'node:module';import {randomUUID,randomBytes,createHmac} from 'node:crypto';
const require=createRequire(new URL('../package.json',import.meta.url)),mysql=require('mysql2/promise'),bcrypt=require('bcryptjs'),env=parseEnv(fs.readFileSync(process.env.NZ315_TEST_ENV||'.env','utf8')),test={name:process.env.NZ315_TEST_DB};
assert.equal(env.DB_HOST,'127.0.0.1');assert.match(test.name,/^pda_worker_test_\d+$/);
const db=await mysql.createConnection({host:env.DB_HOST,port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD,database:test.name,dateStrings:true}),base=process.env.NZ315_TEST_URL||'http://127.0.0.1:38124',tag=String(Date.now()).slice(-10),password=randomBytes(12).toString('hex');let checks=0;
async function req(path,auth='',body,method=body===undefined?'GET':'POST'){const headers={'Content-Type':'application/json'};if(auth.startsWith('nz315_user='))headers.Cookie=auth;else if(auth)headers.Authorization='Bearer '+auth;const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});let data;try{data=await r.json()}catch{}return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]}}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data};async function check(name,fn){await fn();checks++;console.log('通过：'+name)}
async function account(role,ent,name){const username=role.slice(0,6)+'_'+name+'_'+tag,[r]=await db.execute('INSERT INTO user(username,password,name,role,enterprise_id,status) VALUES(?,?,?,?,?,1)',[username,await bcrypt.hash(password,4),name,role,ent]);return {id:r.insertId,username}}
const event=(code,sequence,kind='valid',rawCode=code)=>({eventId:randomUUID(),sequence,rawCode,code,kind,capturedAt:new Date().toISOString()});
try{
 const [er]=await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES (?,'2099-12-31',1)",['line-test-'+tag]),ent=er.insertId,admin=await account('enterprise_admin',ent,'manager'),one=await account('production_operator',ent,'one'),two=await account('production_operator',ent,'two');
 const login=await req('/api/auth/login','',{username:admin.username,password});ok(login);const cookie=login.cookie;
 const [sr]=await db.execute("INSERT INTO product_spec(enterprise_id,spec_code,spec_name,net_content,content_unit,pack_unit) VALUES(?,'001','100毫升',100,'毫升','瓶')",[ent]),reg='PD'+tag.slice(-8),head='1'+reg.slice(-6)+'1001';
 const [pr]=await db.execute("INSERT INTO product(enterprise_id,name,registration_no,registration_expire,reg_category,produce_type,spec_id,status) VALUES(?,?,?,'2099-12-31',1,1,?,1)",[ent,'员工产线测试产品',reg,sr.insertId]),product=pr.insertId;
 const [ur]=await db.execute('INSERT INTO upload_batch(enterprise_id,file_name,product_id,created_by) VALUES(?,?,?,?)',[ent,'line-fixture',product,admin.id]);const codes=Array.from({length:2001},(_,i)=>head+String(i+1).padStart(21,'0'));
 for(let i=0;i<codes.length;i+=500){const chunk=codes.slice(i,i+500);await db.query('INSERT INTO trace_code(enterprise_id,product_id,upload_batch_id,code,status,abnormal_flag) VALUES '+chunk.map(()=>'(?,?,?,?,1,0)').join(','),chunk.flatMap(c=>[ent,product,ur.insertId,c]))}
 async function device(name,line){const add=ok(await req('/api/admin/production-devices',cookie,{name,lineName:line})),secret=randomBytes(32).toString('hex'),activation=JSON.parse(Buffer.from(add.activationCode.slice(13),'base64url'));ok(await req('/api/device/activate','',{token:activation.token,credential:secret,instanceId:randomUUID(),model:'line-test'}));return {...add,secret}}
 const d1=await device('PDA甲','设备登记线'),d2=await device('PDA乙','设备登记线'),g1=ok(await req('/api/device/operator/login',d1.secret,{username:one.username,password})),g2=ok(await req('/api/device/operator/login',d2.secret,{username:two.username,password}));let task;
 const create={name:'二号生产线任务',lineName:'二号线',sourceUploadBatchId:ur.insertId,operatorIds:[one.id,two.id],requestId:randomUUID()};
 await check('整份入库文件创建任务，选择本厂操作员，无产品日期质检输入和分码数量',async()=>{
  const options=ok(await req('/api/admin/production-lines/options',cookie));assert.ok(options.uploads.some(r=>r.id===ur.insertId));assert.ok(options.operators.some(p=>p.id===one.id));
  task=ok(await req('/api/admin/production-lines',cookie,create));assert.equal(task.total,2001);assert.equal(ok(await req('/api/admin/production-lines',cookie,create)).id,task.id);
  const detail=ok(await req('/api/admin/production-tasks/'+task.id,cookie));assert.equal(detail.task.workflow,'line-team');assert.equal(detail.task.batch_id,null);assert.equal(detail.task.quality_cert_no,null);assert.equal(detail.task.qc_result,null);
  assert.equal((await req('/api/admin/production-lines',cookie,{...create,name:'duplicate',requestId:randomUUID()})).status,409);
 });
 const context={mode:'production',lineWorkflow:true,taskId:task.id,productId:product,batchNo:'TEAM-'+tag,produceDate:'2026-10-12',expireDate:'2027-10-12'},run1=randomUUID(),s1=randomUUID(),run2=randomUUID(),s2=randomUUID(),startedAt=new Date().toISOString();
 await check('工人任务成员权限，设备不固定员工，缓存关联人员且拒绝未安排人员',async()=>{
  const outsider=await account('production_operator',ent,'unassigned'),g3=ok(await req('/api/device/operator/login',d1.secret,{username:outsider.username,password}));
  assert.equal((await req('/api/device/worker-sessions',d1.secret,{runId:randomUUID(),sessionId:randomUUID(),context,grant:g3.grant,startedAt})).status,403);
  const cache=ok(await req('/api/device/worker-cache?workflow=line&kind=pools',d1.secret));assert.deepEqual(cache.rows.find(t=>t.task_id===task.id).memberIds,[one.id,two.id]);
  ok(await req('/api/device/worker-sessions',d1.secret,{runId:run1,sessionId:s1,context,grant:g1.grant,startedAt}));ok(await req('/api/device/worker-sessions',d2.secret,{runId:run2,sessionId:s2,context,grant:g2.grant,startedAt}));
 });
 await check('扫码事务绑定生产资料但不默认质检合格，重复/异常有审计，成员进度有开始时间',async()=>{
  const events=[event(codes[0],1),event(codes[0],2,'duplicate','other?47='+codes[0]),event(null,3,'invalid','short')];
  const result=ok(await req('/api/device/worker-sessions/'+s1+'/events',d1.secret,{events}));assert.deepEqual(result.receipts.map(r=>r.state),['saved','duplicate','exception']);assert.deepEqual(ok(await req('/api/device/worker-sessions/'+s1+'/events',d1.secret,{events})),result);
  ok(await req('/api/device/worker-sessions/'+s2+'/events',d2.secret,{events:[event(codes[1],1)]}));
  const [[code]]=await db.query('SELECT status,batch_no,qc_result,quality_cert_no FROM trace_code WHERE code=?',[codes[0]]);assert.equal(code.status,2);assert.equal(code.batch_no,context.batchNo);assert.equal(code.qc_result,null);assert.equal(code.quality_cert_no,null);
  const progress=ok(await req('/api/admin/production-tasks/'+task.id+'/worker-progress',cookie));assert.equal(Number(progress.rows.find(r=>r.user_id===one.id).duplicates),1);assert.ok(progress.rows.every(r=>r.started_at));
 });
 await check('模糊与表头筛选、员工详情和码明细模糊查询',async()=>{
  const list=ok(await req('/api/admin/production-lines?keyword='+encodeURIComponent(one.username)+'&lineName='+encodeURIComponent('二号线')+'&operatorId='+one.id+'&status=active',cookie));assert.equal(list.total,1);assert.equal(list.rows[0].id,task.id);assert.equal(list.rows[0].operators.length,2);assert.equal(list.rows[0].collected,2);
  assert.equal(list.rows[0].product_name,'员工产线测试产品');assert.equal(list.rows[0].product_spec_name,'100毫升');assert.equal(list.rows[0].registration_no,reg);
  const productSearch=ok(await req('/api/admin/production-lines?keyword='+encodeURIComponent(reg),cookie));assert.equal(productSearch.total,1);assert.equal(productSearch.rows[0].id,task.id);
  // 新工人流程尚未写入旧采集上传批次，生产资料由任务和单码查询验证。
  const library=ok(await req('/api/admin/codes/usage-batches?uploadBatchId='+ur.insertId,cookie));assert.equal(library.productionRecordsAvailable,true);assert.equal(library.total,0);
  const produced=ok(await req('/api/admin/codes?uploadBatchId='+ur.insertId+'&status=2',cookie));assert.equal(produced.total,2);for(const row of produced.rows){assert.equal(row.batch_no,context.batchNo);assert.equal(row.produce_date,context.produceDate);assert.equal(row.expire_date,context.expireDate)}
  const raw=ok(await req('/api/admin/codes?keyword='+codes[10],cookie)).rows[0];assert.equal(raw.status,1);assert.equal(raw.batch_no,null);assert.equal(raw.produce_date,null);
  const trace=ok(await req('/api/trace?code='+codes[0]));assert.equal(trace.batch.batchNo,context.batchNo);assert.equal(trace.batch.produceDate,context.produceDate);assert.equal(trace.batch.expireDate,context.expireDate);assert.equal(trace.batch.qcResult,'');assert.equal(trace.batch.qualityStatus,'pending');
  const used=ok(await req('/api/admin/production-tasks/'+task.id+'?state=used',cookie));assert.equal(used.filteredTotal,2);assert.equal(used.rows[0].batch_no,context.batchNo);assert.equal(used.rows[0].produce_date,context.produceDate);
  assert.equal(ok(await req('/api/admin/production-lines?keyword=nomatch'+tag,cookie)).total,0);
  assert.equal(ok(await req('/api/admin/production-tasks/'+task.id+'?keyword='+codes[0],cookie)).filteredTotal,1);
  assert.equal(ok(await req('/api/admin/production-tasks/'+task.id+'/worker-progress?userId='+one.id+'&state=exception',cookie)).total,1);
 });
 await check('所有工人结束前后台拒绝结束，收到完整序号与结束时间后允许结束，不审核/转领码',async()=>{
  assert.equal((await req('/api/admin/production-lines/'+task.id,cookie,{action:'complete',recordsComplete:true},'PATCH')).status,409);
  const stoppedAt=new Date().toISOString();ok(await req('/api/device/worker-sessions/'+s2+'/complete',d2.secret,{lastSequence:1,stoppedAt}));ok(await req('/api/device/worker-runs/'+run2+'/complete',d2.secret,{sessions:[{id:s2,lastSequence:1}]}));
  assert.equal((await req('/api/admin/production-lines/'+task.id,cookie,{action:'complete',recordsComplete:true},'PATCH')).status,409);
  ok(await req('/api/device/worker-sessions/'+s1+'/complete',d1.secret,{lastSequence:3,stoppedAt}));ok(await req('/api/device/worker-runs/'+run1+'/complete',d1.secret,{sessions:[{id:s1,lastSequence:3}]}));
  assert.equal((await req('/api/admin/production-lines/'+task.id,cookie,{action:'complete'},'PATCH')).status,409);
  ok(await req('/api/admin/production-lines/'+task.id,cookie,{action:'complete',recordsComplete:true},'PATCH'));
  const [[states]]=await db.query("SELECT SUM(state='used') AS used,SUM(state='reserved') AS unscanned,SUM(state IN ('pending','released')) AS reviewed FROM production_task_code WHERE task_id=?",[task.id]);assert.equal(Number(states.used),2);assert.equal(Number(states.unscanned),1999);assert.equal(Number(states.reviewed),0);
  const progress=ok(await req('/api/admin/production-tasks/'+task.id+'/worker-progress',cookie));assert.ok(progress.rows.every(r=>r.stopped_at));
  assert.equal((await req('/api/device/worker-sessions',d1.secret,{runId:randomUUID(),sessionId:randomUUID(),context,grant:g1.grant,startedAt})).status,409);
 });
 await check('完整工人上传进入码库，个人设备归属正确，重传不重复建批',async()=>{
  const listed=ok(await req('/api/admin/codes/usage-batches?uploadBatchId='+ur.insertId,cookie));
  assert.equal(listed.total,2);assert.equal(listed.rows.reduce((n,r)=>n+r.codeTotal,0),2);
  assert.deepEqual(new Set(listed.rows.map(r=>r.uploaderUsername)),new Set([one.username,two.username]));
  assert.ok(listed.rows.every(r=>r.batchNo===context.batchNo&&r.produceDate===context.produceDate&&r.deviceName));
  ok(await req('/api/device/worker-sessions/'+s1+'/complete',d1.secret,{lastSequence:3}));
  assert.equal(ok(await req('/api/admin/codes/usage-batches?uploadBatchId='+ur.insertId,cookie)).total,2);
  const exported=await req('/api/admin/codes/usage-batches/'+listed.rows[0].id+'/export?format=txt',cookie);
  assert.equal(exported.status,200);
 });
 await check('同文件不同批号逐码展示，批次回退有效，未生产码保持空资料',async()=>{
  const [[firstBatch]]=await db.query('SELECT batch_id FROM production_task WHERE id=?',[task.id]);
  const [other]=await db.execute('INSERT INTO batch(enterprise_id,product_id,batch_no,produce_date,expire_date,qc_result) VALUES(?,?,?,?,?,NULL)',[ent,product,'MIX-'+tag,'2026-10-13','2027-10-13']);
  const [file]=await db.execute("INSERT INTO upload_batch(enterprise_id,file_name,product_id,created_by,batch_no) VALUES(?,?,?,?, '过期文件快照')",[ent,'mixed-'+tag,product,admin.id]);
  const values=Array.from({length:3},(_,i)=>head+String(i+9000).padStart(21,'0'));
  await db.execute('INSERT INTO trace_code(enterprise_id,product_id,upload_batch_id,code,status,abnormal_flag,batch_id) VALUES(?,?,?,?,2,0,?)',[ent,product,file.insertId,values[0],firstBatch.batch_id]);
  await db.execute('INSERT INTO trace_code(enterprise_id,product_id,upload_batch_id,code,status,abnormal_flag,batch_id) VALUES(?,?,?,?,2,0,?)',[ent,product,file.insertId,values[1],other.insertId]);
  await db.execute('INSERT INTO trace_code(enterprise_id,product_id,upload_batch_id,code,status,abnormal_flag) VALUES(?,?,?,?,1,0)',[ent,product,file.insertId,values[2]]);
  const mixed=ok(await req('/api/admin/codes?uploadBatchId='+file.insertId+'&status=2',cookie));assert.equal(mixed.total,2);assert.deepEqual(new Set(mixed.rows.map(row=>row.batch_no)),new Set([context.batchNo,'MIX-'+tag]));
  const filtered=ok(await req('/api/admin/codes?uploadBatchId='+file.insertId+'&keyword='+encodeURIComponent('MIX-'+tag),cookie));assert.equal(filtered.total,1);assert.equal(filtered.rows[0].code,values[1]);
  const bound=ok(await req('/api/admin/codes?keyword='+values[0],cookie)).rows[0];assert.equal(bound.batch_no,context.batchNo);assert.equal(bound.produce_date,context.produceDate);assert.equal(bound.expire_date,context.expireDate);
  const unbound=ok(await req('/api/admin/codes?keyword='+values[2],cookie)).rows[0];assert.equal(unbound.batch_no,null);assert.equal(unbound.produce_date,null);assert.equal(unbound.expire_date,null);
 });
 console.log('生产线接口隔离验收通过：'+checks+'组');
}finally{await db.end()}
