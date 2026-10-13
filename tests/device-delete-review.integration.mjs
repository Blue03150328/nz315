import fs from 'node:fs'
import assert from 'node:assert/strict'
import { parseEnv } from 'node:util'
import { createRequire } from 'node:module'
import { randomUUID, randomBytes } from 'node:crypto'
const require=createRequire(new URL('../package.json',import.meta.url)),mysql=require('mysql2/promise'),bcrypt=require('bcryptjs')
const env=parseEnv(fs.readFileSync(process.env.NZ315_TEST_ENV||'.env','utf8')),database=process.env.NZ315_TEST_DB,base=process.env.NZ315_TEST_URL||'http://127.0.0.1:38125'
assert.equal(env.DB_HOST,'127.0.0.1');assert.match(database||'',/^pda_worker_test_\d+$/);assert.equal(new URL(base).hostname,'127.0.0.1')
const db=await mysql.createConnection({host:env.DB_HOST,port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD,database,dateStrings:true})
const tag='device_review_'+Date.now(),password=randomBytes(20).toString('hex');let checks=0
async function request(id,cookie,action='delete'){const r=await fetch(base+'/api/admin/production-devices/'+id,{method:'PATCH',headers:{'Content-Type':'application/json',Cookie:cookie||''},body:JSON.stringify({action}),signal:AbortSignal.timeout(15000)});return{status:r.status,data:await r.json()}}
async function account(role,enterprise){const username=tag+'_'+role+'_'+enterprise,[r]=await db.execute('INSERT INTO user(username,password,name,role,enterprise_id,status) VALUES(?,?,?,?,?,1)',[username,await bcrypt.hash(password,4),tag,role,enterprise]);const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});assert.equal(response.status,200);return{id:r.insertId,cookie:response.headers.get('set-cookie').split(';')[0]}}
async function check(label,fn){await fn();checks++;console.log('通过：'+label)}
try{
 const [ent]=await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES(?,'2099-12-31',1)",[tag]),[foreign]=await db.execute("INSERT INTO enterprise(name,renew_expire,status) VALUES(?,'2099-12-31',1)",[tag+'_foreign'])
 const admin=await account('enterprise_admin',ent.insertId),alien=await account('enterprise_admin',foreign.insertId),viewer=await account('viewer',ent.insertId)
 const [spec]=await db.execute("INSERT INTO product_spec(enterprise_id,spec_code,spec_name,net_content,content_unit,pack_unit) VALUES(?,'001','100毫升',100,'毫升','瓶')",[ent.insertId])
 const registration='PD'+String(Date.now()%100000000).padStart(8,'0')
 const [product]=await db.execute("INSERT INTO product(enterprise_id,name,registration_no,registration_expire,reg_category,produce_type,spec_id,status) VALUES(?,?,?,'2099-12-31',1,1,?,1)",[ent.insertId,tag,registration,spec.insertId])
 async function fixture(poolState='review',runState='sealed',sessionState='completed',finalSequence=1){
  const [device]=await db.execute("INSERT INTO production_device(enterprise_id,name,line_name,status,created_by,reported_pending) VALUES(?,?,'测试线','enabled',?,0)",[ent.insertId,tag,admin.id])
  const pool=randomUUID(),run=randomUUID(),session=randomUUID()
  await db.execute('INSERT INTO worker_pool(id,request_id,device_id,enterprise_id,product_id,state,created_by) VALUES(?,?,?,?,?,?,?)',[pool,randomUUID(),device.insertId,ent.insertId,product.insertId,poolState,admin.id])
  await db.execute("INSERT INTO worker_run(id,device_id,enterprise_id,pool_id,product_id,mode,context_json,context_hash,state) VALUES(?,?,?,?,?,'production',?,REPEAT('a',64),?)",[run,device.insertId,ent.insertId,pool,product.insertId,JSON.stringify({mode:'production'}),runState])
  await db.execute("INSERT INTO worker_session(id,run_id,device_id,user_id,grant_id,identity_json,state,last_sequence,final_sequence) VALUES(?,?,?,?,?,?,?,1,?)",[session,run,device.insertId,admin.id,randomUUID(),JSON.stringify({id:admin.id}),sessionState,finalSequence])
  const code=String(device.insertId).padStart(32,'0'),[trace]=await db.execute('INSERT INTO trace_code(enterprise_id,product_id,code,status) VALUES(?,?,?,1)',[ent.insertId,product.insertId,code])
  await db.execute("INSERT INTO worker_pool_code(pool_id,code_id,active_code_id,code,state) VALUES(?,?,?,?,'reserved')",[pool,trace.insertId,trace.insertId,code])
  await db.execute("INSERT IGNORE INTO production_code_reservation(code_id,owner_kind,owner_id) VALUES(?,'worker_pool',?)",[trace.insertId,pool])
  return{id:device.insertId,pool,run,session,codeId:trace.insertId}
 }
 async function unchanged(f){const [[p]]=await db.query('SELECT state,active_key FROM worker_pool WHERE id=?',[f.pool]),[[r]]=await db.query('SELECT state,qc_state,review_state FROM worker_run WHERE id=?',[f.run]),[sessions]=await db.query('SELECT id,state,last_sequence,final_sequence FROM worker_session WHERE run_id=?',[f.run]),[codes]=await db.query('SELECT state,code_id,active_code_id,code FROM worker_pool_code WHERE pool_id=?',[f.pool]),[trace]=await db.query('SELECT code,status,batch_id,batch_no,produce_date,expire_date FROM trace_code WHERE id=?',[f.codeId]),[holds]=await db.query('SELECT * FROM production_code_reservation WHERE code_id=?',[f.codeId]);return{p,r,sessions,codes,trace,holds}}
 const complete=await fixture(),before=await unchanged(complete);assert.equal(before.holds.length,1)
 await check('未登录、只读及跨厂删除拒绝',async()=>{assert.equal((await request(complete.id,'')).status,401);assert.equal((await request(complete.id,viewer.cookie)).status,403);assert.equal((await request(complete.id,alien.cookie)).status,404)})
 await check('旧码池待审核且会话序号完整时可删除，审核码及占用历史完全保留',async()=>{
  assert.equal((await request(complete.id,admin.cookie)).status,200);assert.deepEqual(await unchanged(complete),before)
  const [[device]]=await db.query('SELECT status,deleted_at FROM production_device WHERE id=?',[complete.id]);assert.equal(device.status,'deleted');assert.ok(device.deleted_at)
  const [[audit]]=await db.query("SELECT COUNT(*) n FROM production_device_change WHERE device_id=? AND action='delete'",[complete.id]);assert.equal(audit.n,1)
 })
 await check('待审核码池的未结束会话、序号缺口及空最终序号继续拦截',async()=>{
  for(const args of [['review','sealed','active',1],['review','sealed','completed',2],['review','sealed','completed',null]]){const f=await fixture(...args);assert.equal((await request(f.id,admin.cookie)).status,409);const [[row]]=await db.query('SELECT status FROM production_device WHERE id=?',[f.id]);assert.equal(row.status,'enabled')}
 })
 await check('仍在采集、未开始预配码及没有完整会话的孤立审核码池拦截',async()=>{
  for(const args of [['review','active','completed',1],['ready','sealed','completed',1],['active','sealed','completed',1]]){const f=await fixture(...args);assert.equal((await request(f.id,admin.cookie)).status,409)}
  const f=await fixture();await db.execute('DELETE FROM worker_session WHERE id=?',[f.session]);assert.equal((await request(f.id,admin.cookie)).status,409)
 })
 await check('码池退出审核后，异常的已封存会话仍独立拦截',async()=>{const f=await fixture('released','sealed','completed',null);assert.equal((await request(f.id,admin.cookie)).status,409)})
 await check('新外部采集和设备列表共用占用判断，完成旧审核不被重新计数',async()=>{
  const f=await fixture(),external=randomUUID();await db.execute("INSERT INTO external_collection_batch(id,enterprise_id,device_id,device_name_snapshot,line_name_snapshot,worker_no) VALUES(?,?,?,?,'测试线','001')",[external,ent.insertId,f.id,tag])
  assert.equal((await request(f.id,admin.cookie)).status,409)
  const response=await fetch(base+'/api/admin/production-devices',{headers:{Cookie:admin.cookie}});assert.equal(response.status,200);const row=(await response.json()).rows.find(d=>d.id===f.id);assert.equal(row.active_sessions,1);assert.equal(row.worker_active_pools,0);assert.equal(row.external_active_batches,1)
  await db.execute("UPDATE external_collection_batch SET state='completed' WHERE id=?",[external]);assert.equal((await request(f.id,admin.cookie)).status,200)
  const [[history]]=await db.query('SELECT COUNT(*) n FROM external_collection_batch WHERE id=?',[external]);assert.equal(history.n,1)
 })
 console.log('设备删除审核误拦截隔离验收通过：'+checks+'组')
}finally{await db.end()}
