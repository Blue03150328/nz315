import {lockMonitoredTask,completeMonitoredTask} from './production-monitor'
import { lineCache, openLineSession, lineEvent, offlineExportKey } from './line-production'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import type { AuthUser } from './auth'
import type { PoolConnection } from 'mysql2/promise'
import { verifyPassword } from './auth'
import { query, execute } from './db'
import { transaction } from './production-task'
import { deviceManager } from './production-devices'
import { lockProductionDevice } from './production-device-auth'
import { headOf } from './code-head'
import { collectionId, collectionCode } from '../../shared/utils/collection-input'
import { workerContext, workerEvents } from '../../shared/utils/worker-input'
import { ensureWorkerExternalBatch, projectWorkerExternalEvent } from './worker-external-management'
import { projectWorkerCodeUsage } from '#scripts/worker-code-usage.mjs'
import { traceUrlClassification } from '../../shared/utils/internal-trace-url'
const fail=(message:string,statusCode=409):never=>{throw createError({statusCode,statusMessage:message})}
const hash=(x:any)=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex')
const json=(x:any)=>typeof x==='string'?JSON.parse(x):x
const contextOfRun=(r:any)=>json(r.effective_context||r.context_json)
const batchKey=(value:string)=>value.normalize('NFKC').toLowerCase()
const attempts=new Map<string,{count:number,until:number}>()
const scope=(u:AuthUser,r:any)=>{if(!r||(u.role!=='platform_admin'&&Number(r.enterprise_id)!==Number(u.enterprise_id)))fail('记录不属于本企业',404)}
async function audit(conn:any,u:AuthUser,action:string,runId:string|null,detail:any){await conn.execute('INSERT INTO worker_audit(enterprise_id,actor_id,device_id,run_id,action,detail) VALUES(?,?,?,?,?,?)',[u.enterprise_id,u.id||null,u.device_id||null,runId,action,JSON.stringify(detail)])}
export async function workerLogin(device:AuthUser,body:any){
 const username=String(body.username||'').trim(),key=device.device_id+':'+username,rec=attempts.get(key)
 if(rec&&rec.until>Date.now()&&rec.count>=5)fail('登录失败次数过多，请15分钟后重试',429)
 const [user]=await query<any[]>('SELECT * FROM user WHERE username=?',[username])
 if(!user||user.role!=='production_operator'||Number(user.enterprise_id)!==Number(device.enterprise_id)||Number(user.status)!==1||!await verifyPassword(String(body.password||''),user.password)){
  const old=rec&&rec.until>Date.now()?rec:{count:0,until:Date.now()+900000};old.count++;attempts.set(key,old);fail('工号或密码错误，或账号不属于本厂生产操作员',401)
 }
 return transaction(async conn=>{
  await lockProductionDevice(conn,device)
  const [[locked]]=await conn.query<any[]>('SELECT * FROM user WHERE id=? FOR UPDATE',[user.id])
  if(locked.password!==user.password||Number(locked.status)!==1||locked.role!=='production_operator'||Number(locked.enterprise_id)!==Number(device.enterprise_id))fail('账号资料已变更，请重新登录',401)
  const token=randomBytes(32).toString('hex'),id=randomUUID(),issuedAt=Date.now(),expiresAt=issuedAt+72*3600000
  const identity={id:Number(user.id),name:user.name||user.username,username:user.username,enterpriseId:Number(user.enterprise_id),enterpriseName:device.enterprise_name,deviceId:device.device_id,deviceName:device.name,lineName:device.device_line,role:'production_operator'}
  await conn.execute('INSERT INTO worker_grant(id,device_id,user_id,enterprise_id,token_hash,user_version,identity_json,issued_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',[id,device.device_id,user.id,user.enterprise_id,hash(token),user.session_epoch,JSON.stringify(identity),issuedAt,expiresAt])
  await conn.execute('UPDATE user SET last_login_at=NOW() WHERE id=?',[user.id])
  await audit(conn,{...device,id:user.id},'operator_login',null,{grantId:id});attempts.delete(key)
  return {ok:true,grant:token,grantId:id,exportKey:offlineExportKey(id),issuedAt,expiresAt,serverTime:issuedAt,identity,device:{id:device.device_id,name:device.name,lineName:device.device_line,enterpriseName:device.enterprise_name}}
 })
}
async function grantOf(device:AuthUser,token:string,historical=false){
 if(!/^[a-f0-9]{64}$/.test(token||''))fail('请工人登录',401)
 const [g]=await query<any[]>('SELECT g.*,u.status AS user_status,u.role AS user_role,u.session_epoch AS current_version,u.enterprise_id AS current_enterprise FROM worker_grant g JOIN user u ON u.id=g.user_id WHERE token_hash=? AND device_id=?',[hash(token),device.device_id])
 if(!g||Number(g.enterprise_id)!==Number(device.enterprise_id))fail('工人授权与设备不一致',401)
 g.changed=Number(g.user_status)!==1||g.user_role!=='production_operator'||Number(g.current_version)!==Number(g.user_version)||Number(g.current_enterprise)!==Number(g.enterprise_id)
 if(!historical&&(g.changed||Number(g.expires_at)<Date.now()))fail('工人授权失效，请重新登录',401)
 return g
}
export async function workerCheck(device:AuthUser,token:string){const g=await grantOf(device,token),expiresAt=Date.now()+72*3600000;await execute('UPDATE worker_grant SET expires_at=? WHERE id=?',[expiresAt,g.id]);return {ok:true,identity:json(g.identity_json),expiresAt,serverTime:Date.now()}}
export async function workerDownloadUser(device:AuthUser,token:string):Promise<AuthUser>{const g=await grantOf(device,token);return {...device,id:Number(g.user_id),role:'production_operator'}}
export async function workerTracePreview(codeId:number){
 let row:any
 try { [row]=await query<any[]>("SELECT r.context_json,r.effective_context,r.qc_state FROM worker_pool_code p JOIN worker_run r ON r.pool_id=p.pool_id WHERE p.code_id=? AND p.state='captured' ORDER BY r.created_at DESC LIMIT 1",[codeId]) }
 catch(error:any){if(error.code==='ER_NO_SUCH_TABLE'&&/\bworker_(pool_code|run)\b/.test(String(error.message)))return undefined;throw error}
 if(!row)return undefined;const c=contextOfRun(row)
 return {batchNo:c.batchNo,produceDate:c.produceDate,expireDate:c.expireDate,qcResult:row.qc_state==='failed'?'不合格':'',qualityCertNo:'',qualityStatus:row.qc_state==='failed'?'failed' as const:'pending' as const}
}
export async function workerCache(device:AuthUser,params:any){
 let snapshot:any
 if(params.id){[snapshot]=await query<any[]>('SELECT * FROM worker_cache WHERE id=? AND device_id=? AND expires_at>?',[String(params.id),device.device_id,Date.now()]);if(!snapshot)fail('缓存快照已过期，请重新下载',410)}
 else {
  const products=await query<any[]>('SELECT p.id,p.name,p.trademark,p.content,p.dosage,p.registration_no,p.reg_category,p.produce_type,p.shelf_life,p.spec_id,s.spec_name,s.spec_code FROM product p LEFT JOIN product_spec s ON s.id=p.spec_id WHERE p.enterprise_id=? AND p.status=1 ORDER BY p.id',[device.enterprise_id])
  for(const product of products)product.code_head=headOf(product)
  const pools=await query<any[]>("SELECT id,product_id,state FROM worker_pool WHERE device_id=? AND state IN ('ready','active') ORDER BY created_at",[device.device_id])
  const codes=await query<any[]>("SELECT c.pool_id,c.code,c.state,p.product_id FROM worker_pool_code c JOIN worker_pool p ON p.id=c.pool_id WHERE p.device_id=? AND p.state IN ('ready','active') ORDER BY p.id,c.code_id",[device.device_id])
  if(params.workflow==='line'){const line=await lineCache(device);pools.splice(0,pools.length,...line.pools);codes.splice(0,codes.length,...line.codes)}
  const lines=await query<any[]>("SELECT DISTINCT line_name FROM production_task WHERE enterprise_id=? AND workflow='line-team' AND line_name<>'' AND status<>'deleted' UNION SELECT line_name FROM production_line_runtime WHERE enterprise_id=? ORDER BY line_name",[device.enterprise_id,device.enterprise_id]);
  if(params.workflow==='line'&&params.monitor==='1')for(const line of lines)if(!pools.some(p=>p.line_name===line.line_name&&p.autoLine))pools.push({id:'auto:'+line.line_name,line_name:line.line_name,task_name:line.line_name,task_id:0,autoLine:true});
  snapshot={id:randomUUID(),created_at:Date.now(),expires_at:Date.now()+72*3600000,data_json:{products,pools,codes,stockVersion:params.workflow==='line'?(params.monitor==='1'?3:2):0}}
  await execute('INSERT INTO worker_cache(id,device_id,created_at,expires_at,data_json) VALUES(?,?,?,?,?)',[snapshot.id,device.device_id,snapshot.created_at,snapshot.expires_at,JSON.stringify(snapshot.data_json)])
 }
 const data=json(snapshot.data_json),kind=['products','pools','codes'].includes(params.kind)?params.kind:'products',offset=Math.max(0,Number(params.offset)||0),limit=kind==='codes'?1000:200,rows=data[kind].slice(offset,offset+limit)
 return {ok:true,id:snapshot.id,createdAt:Number(snapshot.created_at),expiresAt:Number(snapshot.expires_at),serverTime:Date.now(),stockVersion:Number(data.stockVersion||0),traceBaseUrl:String(useRuntimeConfig().public.traceBaseUrl),kind,rows,total:data[kind].length,next:offset+rows.length<data[kind].length?offset+rows.length:null,hash:hash(data)}
}
export async function assignWorkerPool(user:AuthUser,body:any){
 deviceManager(user);const deviceId=Number(body.deviceId),productId=Number(body.productId),quantity=Number(body.quantity),requestId=collectionId(body.requestId)
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>100000)fail('分配数量须为1至100000',400)
 return transaction(async conn=>{
  const [[device]]=await conn.query<any[]>('SELECT * FROM production_device WHERE id=? FOR UPDATE',[deviceId]);scope(user,device)
  if(device.status!=='enabled'||device.deleted_at)fail('设备未启用')
  const [[product]]=await conn.query<any[]>('SELECT p.*,s.spec_code FROM product p JOIN product_spec s ON s.id=p.spec_id WHERE p.id=? FOR UPDATE',[productId]);scope(user,product)
  if(Number(product.enterprise_id)!==Number(device.enterprise_id)||Number(product.status)!==1)fail('产品不属于设备所在厂家或已停用')
  const [[prior]]=await conn.query<any[]>('SELECT * FROM worker_pool WHERE request_id=?',[requestId]);if(prior){if(prior.device_id!==deviceId||prior.product_id!==productId)fail('提交标识不能重复用于其他分配');return {ok:true,id:prior.id,duplicate:true}}
  const [[active]]=await conn.query<any[]>("SELECT id FROM worker_pool WHERE active_key=?",[deviceId+':'+productId]);if(active)fail('该设备该产品已有预配码，须结束并审核后才能重新分配')
  let extra='';const args:any[]=[productId,device.enterprise_id]
  if(body.sourceUploadBatchId){extra=' AND c.upload_batch_id=?';args.push(Number(body.sourceUploadBatchId))}
  const [codes]=await conn.query<any[]>(`SELECT c.* FROM trace_code c LEFT JOIN production_code_reservation r ON r.code_id=c.id WHERE c.product_id=? AND c.enterprise_id=? AND c.status=1 AND c.abnormal_flag=0 AND c.batch_id IS NULL AND c.bound_at IS NULL AND c.produce_date IS NULL AND c.expire_date IS NULL AND c.quality_cert_no IS NULL AND c.batch_no IS NULL AND c.qc_result IS NULL AND r.code_id IS NULL${extra} ORDER BY c.id LIMIT ? FOR UPDATE`,[...args,quantity])
  if(codes.length!==quantity||codes.some(c=>!String(c.code).startsWith(headOf(product))))fail('可分配的正确产品码不足，请核对来源和规格')
  const id=randomUUID();await conn.execute('INSERT INTO worker_pool(id,request_id,device_id,enterprise_id,product_id,active_key,created_by) VALUES(?,?,?,?,?,?,?)',[id,requestId,deviceId,device.enterprise_id,productId,deviceId+':'+productId,user.id])
  for(let i=0;i<codes.length;i+=500){const chunk=codes.slice(i,i+500);await conn.query('INSERT INTO worker_pool_code(pool_id,code_id,active_code_id,code) VALUES '+chunk.map(()=>'(?,?,?,?)').join(','),chunk.flatMap(c=>[id,c.id,c.id,c.code]))}
  await audit(conn,{...user,enterprise_id:device.enterprise_id},'allocate',null,{poolId:id,deviceId,productId,quantity});return {ok:true,id,total:quantity}
 })
}
export async function openWorkerSession(device:AuthUser,body:any,verifiedGrant?:any){
 const runId=collectionId(body.runId),sessionId=collectionId(body.sessionId),context=workerContext(body.context),g=verifiedGrant||await grantOf(device,String(body.grant),true)
 const started=Date.parse(String(body.startedAt||''));if(!Number.isFinite(started)||started<Number(g.issued_at)-60000||started>Number(g.expires_at)||started>Date.now()+60000)fail('本次采集不在工人授权有效期内',403)
 return transaction(async conn=>{
  await lockProductionDevice(conn,device)
  if('lineWorkflow' in context&&context.lineWorkflow)return openLineSession(conn,device,body,context,g)
  if(context.mode==='production')await conn.query('SELECT id FROM product WHERE id=? FOR UPDATE',[context.productId])
  const [[prior]]=await conn.query<any[]>('SELECT * FROM worker_run WHERE id=? FOR UPDATE',[runId])
  if(prior){if(prior.device_id!==device.device_id||prior.context_hash!==hash(context))fail('批次标识或生产资料冲突');if(prior.state!=='active')fail('整批已经结束，不能新增工人会话')}
  else {
   let contextConflict=false,productSnapshot:any=null
   if(context.mode==='production'){
    const [[pool]]=await conn.query<any[]>('SELECT * FROM worker_pool WHERE id=? FOR UPDATE',[context.poolId]);if(!pool||pool.device_id!==device.device_id||pool.product_id!==context.productId||pool.state!=='ready')fail('预配码池不属于设备、产品，或仍待审核')
    const [[p]]=await conn.query<any[]>('SELECT * FROM product WHERE id=?',[context.productId]);if(!p||Number(p.status)!==1)fail('产品已停用')
    const [[spec]]=await conn.query<any[]>('SELECT spec_name FROM product_spec WHERE id=?',[p.spec_id]);productSnapshot={id:p.id,name:p.name,registrationNo:p.registration_no,specName:spec?.spec_name}
    const [others]=await conn.query<any[]>('SELECT context_json,effective_context FROM worker_run WHERE enterprise_id=? AND product_id=?',[device.enterprise_id,context.productId])
    const [[old]]=await conn.query<any[]>('SELECT produce_date,expire_date FROM batch WHERE product_id=? AND batch_no=?',[context.productId,context.batchNo])
    contextConflict=!!((old&&(String(old.produce_date).slice(0,10)!==context.produceDate||String(old.expire_date).slice(0,10)!==context.expireDate))||others.some(r=>{const c=contextOfRun(r);return batchKey(c.batchNo)===batchKey(context.batchNo)&&(c.produceDate!==context.produceDate||c.expireDate!==context.expireDate)}))
    await conn.execute("UPDATE worker_pool SET state='active' WHERE id=?",[pool.id])
   }
   await conn.execute('INSERT INTO worker_run(id,device_id,enterprise_id,pool_id,product_id,mode,context_json,context_hash,review_needed) VALUES(?,?,?,?,?,?,?,?,?)',[runId,device.device_id??null,device.enterprise_id,context.mode==='production'?context.poolId??null:null,context.mode==='production'?context.productId:null,context.mode,JSON.stringify(context),hash(context),g.changed||contextConflict?1:0])
   await conn.execute('UPDATE worker_run SET device_snapshot=?,product_snapshot=? WHERE id=?',[JSON.stringify({id:device.device_id,name:device.name,lineName:device.device_line,enterpriseName:device.enterprise_name}),productSnapshot?JSON.stringify(productSnapshot):null,runId])
   if(contextConflict)await audit(conn,device,'context_conflict',runId,{original:context,reason:'同产品同批号日期不一致，保存原录入，待管理员核对'})
  }
  const [[session]]=await conn.query<any[]>('SELECT * FROM worker_session WHERE id=?',[sessionId])
  if(session){if(session.run_id!==runId||session.grant_id!==g.id||session.device_id!==device.device_id)fail('工人会话归属不一致')}
  else{await conn.execute('INSERT INTO worker_session(id,run_id,device_id,user_id,grant_id,identity_json,started_at,started_ms) VALUES(?,?,?,?,?,?,?,?)',[sessionId,runId,device.device_id,g.user_id,g.id,JSON.stringify(json(g.identity_json)),new Date(started),started]);await audit(conn,{...device,id:g.user_id},'join_batch',runId,{sessionId,identity:json(g.identity_json)})}
  if(context.mode==='external'){
   const [[savedRun]]=await conn.query<any[]>('SELECT * FROM worker_run WHERE id=?',[runId])
   const [[savedSession]]=await conn.query<any[]>('SELECT * FROM worker_session WHERE id=?',[sessionId])
   await ensureWorkerExternalBatch(conn,savedSession,savedRun)
  }
  return {ok:true,runId,sessionId,identity:json(g.identity_json)}
 })
}
export async function syncWorkerEvents(device:AuthUser,sessionId:string,body:any){
 collectionId(sessionId);const events=workerEvents(body),receipts=[]
 for(const event of events){
  const receipt=await transaction(async conn=>{
   await lockProductionDevice(conn,device)
   const [[seed]]=await conn.query<any[]>('SELECT r.* FROM worker_run r JOIN worker_session s ON s.run_id=r.id WHERE s.id=? AND s.device_id=?',[sessionId,device.device_id]);if(!seed)fail('工人采集会话不存在',404)
   if(seed.product_id)await conn.query('SELECT id FROM product WHERE id=? FOR UPDATE',[seed.product_id])
   if(seed.task_id)await lockMonitoredTask(conn,Number(seed.task_id))
   const [[run]]=await conn.query<any[]>('SELECT * FROM worker_run WHERE id=? FOR UPDATE',[seed.id]),[[s]]=await conn.query<any[]>('SELECT * FROM worker_session WHERE id=? FOR UPDATE',[sessionId])
   const [[prior]]=await conn.query<any[]>('SELECT * FROM worker_event WHERE session_id=? AND sequence_no=?',[sessionId,event.sequence])
   if(prior){if(prior.id!==event.eventId||prior.payload_hash!==hash(event))fail('相同事件标识或序号包含不同内容');return eventReceipt(prior)}
   if(run.state!=='active'||s.state!=='active'||event.sequence!==Number(s.last_sequence)+1)fail('批次已结束或事件序号存在缺口，请补传较早记录')
   const [[g]]=await conn.query<any[]>('SELECT g.*,u.status AS us,u.session_epoch AS uv,u.role AS ur,u.enterprise_id AS ue FROM worker_grant g JOIN user u ON u.id=g.user_id WHERE g.id=?',[s.grant_id])
   const within=Date.parse(event.capturedAt)>=Number(g.issued_at)-60000&&Date.parse(event.capturedAt)<=Number(g.expires_at)&&Date.parse(event.capturedAt)<=Date.now()+60000
   let result='exception',reason='',classification:string|null=null,dedup:string|null=null
   if(run.task_id){const line=await lineEvent(conn,device,run,s,event,within,g);result=line.result;reason=line.reason}
   else if(run.mode==='production'){
    const [[code]]=event.code?await conn.query<any[]>('SELECT p.*,c.status,c.batch_id,c.abnormal_flag FROM worker_pool_code p JOIN trace_code c ON c.id=p.code_id WHERE p.pool_id=? AND p.code=? FOR UPDATE',[run.pool_id,event.code]):[[]]
    if(!code)reason='缺位、多候选、未分配或其他产品的码'
    else if(code.state==='captured'||code.state==='bound'){result='duplicate';reason='此码已采集，不重复计入生产'}
    else if(code.state!=='reserved'||code.status!==1||code.batch_id||code.abnormal_flag!==0)reason='码状态已变化，不能覆盖原生产资料'
    else if(event.kind==='valid'){
     result='saved';await conn.execute("UPDATE worker_pool_code SET state='captured',operator_id=?,event_id=? WHERE pool_id=? AND code_id=?",[s.user_id,event.eventId,run.pool_id,code.code_id])
    }else reason='本机记录判定为重复或异常，保留原文待核对'
   } else {
    dedup=hash(event.code||event.rawCode.trim())
    const [[old]]=await conn.query<any[]>("SELECT e.id FROM worker_event e JOIN worker_session w ON w.id=e.session_id WHERE w.run_id=? AND e.dedup_key=? AND e.result_state='saved' LIMIT 1",[run.id,dedup])
    if(old){result='duplicate';reason='重复采集，原文保留，不重复导出'}else result='saved'
     classification=traceUrlClassification(event.rawCode,String(useRuntimeConfig().public.traceBaseUrl))
   }
   if(!within||Number(g.us)!==1||Number(g.uv)!==Number(g.user_version)||g.ur!=='production_operator'||Number(g.ue)!==Number(run.enterprise_id)){
    await conn.execute('UPDATE worker_run SET review_needed=1 WHERE id=?',[run.id]);reason=(reason?reason+'；':'')+'工人授权或采集时间需管理员核对，历史数据保留'
   }
   await conn.execute('INSERT INTO worker_event(id,session_id,sequence_no,code,raw_code,kind,result_state,classification,reason,payload_hash,captured_at,dedup_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[event.eventId,sessionId,event.sequence,event.code,event.rawCode,event.kind,result,classification,reason,hash(event),event.capturedAt.replace('T',' ').replace('Z',''),dedup])
   if(run.mode==='external')await projectWorkerExternalEvent(conn,s,run,{id:event.eventId,sequence_no:event.sequence,raw_code:event.rawCode,dedup_key:dedup,result_state:result,reason,payload_hash:hash(event),captured_at:event.capturedAt.replace('T',' ').replace('Z','')})
   await conn.execute('UPDATE worker_session SET last_sequence=? WHERE id=?',[event.sequence,sessionId])
   return eventReceipt({id:event.eventId,sequence_no:event.sequence,code:event.code,result_state:result,classification,reason})
  });receipts.push(receipt)
 }
 return {ok:true,sessionId,receipts}
}
function eventReceipt(e:any){return {eventId:e.id,sequence:Number(e.sequence_no),code:e.code||null,state:e.result_state,classification:e.classification||null,reason:e.reason}}
export async function finishWorkerSession(device:AuthUser,id:string,body:any){return transaction(async conn=>{
 await lockProductionDevice(conn,device);const [[seed]]=await conn.query<any[]>('SELECT r.* FROM worker_run r JOIN worker_session s ON s.run_id=r.id WHERE s.id=? AND s.device_id=?',[collectionId(id),device.device_id]);if(!seed)fail('会话不存在',404);if(seed.product_id)await conn.query('SELECT id FROM product WHERE id=? FOR UPDATE',[seed.product_id]);if(seed.task_id)await lockMonitoredTask(conn,Number(seed.task_id));
 const [[s]]=await conn.query<any[]>('SELECT * FROM worker_session WHERE id=? AND device_id=? FOR UPDATE',[id,device.device_id]);
 if(!Number.isSafeInteger(body.lastSequence)||Number(s.last_sequence)!==body.lastSequence)fail('尚有未收到的采集记录，不能结束')
 if(Number(s.reported_sequence||0)>body.lastSequence)fail('设备上报还有未收到的采集记录，不能结束')
 const [[run]]=await conn.query<any[]>('SELECT * FROM worker_run WHERE id=?',[s.run_id])
 if(s.final_sequence!=null&&Number(s.final_sequence)!==body.lastSequence)fail('结束序号不一致')
 const stop=body.stoppedAt?new Date(String(body.stoppedAt)):null
 if(stop&&(!Number.isFinite(stop.getTime())||stop.getTime()>Date.now()+60000||(s.started_ms&&stop.getTime()<Number(s.started_ms))))fail('结束采集时间无效')
 if(s.stopped_ms&&stop&&Number(s.stopped_ms)!==stop.getTime())fail('结束采集时间与原标记不一致')
 if(run.mode==='external'){
  await ensureWorkerExternalBatch(conn,s,run)
  await conn.execute("UPDATE external_collection_batch SET state='completed',completed_at=COALESCE(completed_at,NOW(3)) WHERE id=? AND last_sequence=?",[id,body.lastSequence])
 }
 await conn.execute("UPDATE worker_session SET state='completed',final_sequence=?,stopped_at=COALESCE(stopped_at,?),stopped_ms=COALESCE(stopped_ms,?),completed_at=COALESCE(completed_at,NOW(3)) WHERE id=?",[body.lastSequence,stop,stop?.getTime()??null,id]);await projectWorkerCodeUsage(conn,id);await audit(conn,{...device,id:s.user_id},'handover',s.run_id,{sessionId:id,lastSequence:body.lastSequence});return {ok:true,sessionId:id,lastSequence:body.lastSequence}
})}
export async function finishWorkerRun(device:AuthUser,id:string,body:any){return transaction(async conn=>{
 await lockProductionDevice(conn,device);const [[seed]]=await conn.query<any[]>('SELECT * FROM worker_run WHERE id=? AND device_id=?',[collectionId(id),device.device_id]);if(!seed)fail('批次不存在',404);if(seed.product_id)await conn.query('SELECT id FROM product WHERE id=? FOR UPDATE',[seed.product_id]);const task=seed.task_id?await lockMonitoredTask(conn,Number(seed.task_id)):null;const [[run]]=await conn.query<any[]>('SELECT * FROM worker_run WHERE id=? FOR UPDATE',[id]);
 const [sessions]=await conn.query<any[]>('SELECT * FROM worker_session WHERE run_id=? FOR UPDATE',[id]),given=body.sessions
 if(!Array.isArray(given)||given.length!==sessions.length||sessions.some(s=>s.state!=='completed'||s.final_sequence==null||Number(s.final_sequence)!==Number(s.last_sequence)||!given.some(g=>g.id===s.id&&g.lastSequence===Number(s.last_sequence))))fail('全部工人记录及结束序号尚未确认，不能释放余码')
 if(run.state==='active'){await conn.execute("UPDATE worker_run SET state='sealed',ended_at=NOW(),final_sessions=? WHERE id=?",[JSON.stringify(given),id]);if(run.pool_id)await conn.execute("UPDATE worker_pool SET state='review' WHERE id=?",[run.pool_id]);await audit(conn,device,'end_batch',id,{sessions:given})}
 const taskEnded=await completeMonitoredTask(conn,task,Number(sessions[0]?.user_id||0));
 return {ok:true,runId:id,state:'sealed',taskEnded}
})}
export async function workerAdminList(user:AuthUser,params:any){
 deviceManager(user);const conds=['1=1'],args:any[]=[]
 if(user.role!=='platform_admin'){conds.push('r.enterprise_id=?');args.push(user.enterprise_id)}else if(params.enterpriseId){conds.push('r.enterprise_id=?');args.push(Number(params.enterpriseId))}
 if(params.deviceId){conds.push('r.device_id=?');args.push(Number(params.deviceId))}
 if(['production','external'].includes(params.mode)){conds.push('r.mode=?');args.push(params.mode)}
 if(['active','sealed'].includes(params.state)){conds.push('r.state=?');args.push(params.state)}
 for(const [key,op] of [['from','>='],['to','<=']] as const)if(params[key]){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(params[key])))fail('查询日期无效',400);conds.push(`r.created_at ${op} ?`);args.push(params[key]+(key==='from'?' 00:00:00':' 23:59:59'))}
 if(params.operator){conds.push('EXISTS(SELECT 1 FROM worker_session ws JOIN user wu ON wu.id=ws.user_id WHERE ws.run_id=r.id AND (wu.username LIKE ? OR wu.name LIKE ?))');args.push('%'+String(params.operator).slice(0,100)+'%','%'+String(params.operator).slice(0,100)+'%')}
 if(['internal','external','own','other_enterprise','not_imported','unparsed'].includes(params.classification)){conds.push('EXISTS(SELECT 1 FROM worker_event we JOIN worker_session ws ON ws.id=we.session_id WHERE ws.run_id=r.id AND we.classification=?)');args.push(params.classification)}
 const page=Math.max(1,Math.min(100000,Math.floor(Number(params.page)||1))),pageSize=50,where=conds.join(' AND ')
 const [count]=await query<any[]>(`SELECT COUNT(*) AS n FROM worker_run r WHERE ${where}`,args)
 const rows=await query<any[]>(`SELECT r.*,p.name AS product_name,d.name AS device_name,d.line_name,en.name AS enterprise_name,(SELECT COUNT(*) FROM worker_pool_code c WHERE c.pool_id=r.pool_id) AS total,IF(r.mode='external',(SELECT COUNT(*) FROM worker_event e JOIN worker_session s ON s.id=e.session_id WHERE s.run_id=r.id AND e.result_state='saved'),(SELECT COUNT(*) FROM worker_pool_code c WHERE c.pool_id=r.pool_id AND c.state IN ('captured','bound'))) AS collected,(SELECT COUNT(*) FROM worker_pool_code c WHERE c.pool_id=r.pool_id AND c.state='reserved') AS remaining,(SELECT COUNT(*) FROM worker_pool_code c WHERE c.pool_id=r.pool_id AND c.state='bound') AS bound FROM worker_run r LEFT JOIN product p ON p.id=r.product_id JOIN production_device d ON d.id=r.device_id JOIN enterprise en ON en.id=r.enterprise_id WHERE ${where} ORDER BY r.created_at DESC,r.id LIMIT ? OFFSET ?`,[...args,pageSize,(page-1)*pageSize])
 const pools=await query<any[]>(`SELECT p.*,d.name AS device_name,pr.name AS product_name,(SELECT COUNT(*) FROM worker_pool_code c WHERE c.pool_id=p.id) AS total FROM worker_pool p JOIN production_device d ON d.id=p.device_id JOIN product pr ON pr.id=p.product_id WHERE ${user.role==='platform_admin'?'1=1':'p.enterprise_id=?'} ORDER BY p.created_at DESC LIMIT 200`,user.role==='platform_admin'?[]:[user.enterprise_id])
 return {rows:rows.map(r=>({...r,context:contextOfRun(r),originalContext:json(r.context_json)})),pools,total:Number(count.n),page,pageSize}
}
export async function workerDetails(user:AuthUser,id:string,params:any={}){
 const [r]=await query<any[]>('SELECT * FROM worker_run WHERE id=?',[collectionId(id)]);scope(user,r)
 if(user.role==='production_operator'){const [own]=await query<any[]>('SELECT id FROM worker_session WHERE run_id=? AND user_id=?',[id,user.id]);if(!own)fail('只能查看自己的采集记录',403)}else deviceManager(user)
 const conds=['s.run_id=?'],args:any[]=[id];if(user.role==='production_operator'){conds.push('s.user_id=?');args.push(user.id)}
 if(['saved','duplicate','exception'].includes(params.result)){conds.push('e.result_state=?');args.push(params.result)}
 if(['internal','external','own','other_enterprise','not_imported','unparsed'].includes(params.classification)){conds.push('e.classification=?');args.push(params.classification)}
 const page=Math.max(1,Math.min(100000,Math.floor(Number(params.page)||1))),pageSize=100
 const [count]=await query<any[]>(`SELECT COUNT(*) AS n FROM worker_event e JOIN worker_session s ON s.id=e.session_id WHERE ${conds.join(' AND ')}`,args)
 const rows=await query<any[]>(`SELECT e.*,s.user_id,s.identity_json FROM worker_event e JOIN worker_session s ON s.id=e.session_id WHERE ${conds.join(' AND ')} ORDER BY e.received_at,e.session_id,e.sequence_no LIMIT ? OFFSET ?`,[...args,pageSize,(page-1)*pageSize])
 const sessions=await query<any[]>(`SELECT id,user_id,identity_json,last_sequence,final_sequence,state FROM worker_session WHERE run_id=?${user.role==='production_operator'?' AND user_id=?':''}`,user.role==='production_operator'?[id,user.id]:[id])
 const remaining=r.pool_id?await query<any[]>("SELECT code FROM worker_pool_code WHERE pool_id=? AND state='reserved' ORDER BY code_id",[r.pool_id]):[]
 const audits=await query<any[]>(`SELECT a.*,u.name AS actor_name FROM worker_audit a LEFT JOIN user u ON u.id=a.actor_id WHERE a.run_id=?${user.role==='production_operator'?' AND a.actor_id=?':''} ORDER BY a.id DESC LIMIT 100`,user.role==='production_operator'?[id,user.id]:[id])
 return {run:{...r,context:contextOfRun(r),originalContext:json(r.context_json),deviceSnapshot:r.device_snapshot?json(r.device_snapshot):null,productSnapshot:r.product_snapshot?json(r.product_snapshot):null},rows,sessions,remaining,audits,total:Number(count.n),page,pageSize}
}
async function allRunsSealed(conn:PoolConnection,r:any){
 if(r.state!=='sealed')fail('本批还未完整上传及结束')
 const context=contextOfRun(r),[others]=await conn.query<any[]>("SELECT context_json,effective_context,state FROM worker_run WHERE enterprise_id=? AND product_id=? AND mode='production'",[r.enterprise_id,r.product_id])
 if(others.some(o=>batchKey(contextOfRun(o).batchNo)===batchKey(context.batchNo)&&o.state!=='sealed'))fail('同批其他设备尚未结束，请等待完整上传')
}
export async function reviewWorkerRun(user:AuthUser,id:string,body:any){deviceManager(user);return transaction(async conn=>{
 const [[seed]]=await conn.query<any[]>('SELECT * FROM worker_run WHERE id=?',[collectionId(id)]);scope(user,seed);if(seed.product_id)await conn.query('SELECT id FROM product WHERE id=? FOR UPDATE',[seed.product_id])
   if(seed.task_id)await lockMonitoredTask(conn,Number(seed.task_id))
 const [[run]]=await conn.query<any[]>('SELECT * FROM worker_run WHERE id=? FOR UPDATE',[collectionId(id)]);scope(user,run);await allRunsSealed(conn,run)
 if(run.mode!=='production')fail('外码采集不涉及生产审核')
 const reason=String(body.reason||'').trim().slice(0,500)
 if(body.action==='correct'){
  if(!reason)fail('补正须填写核对说明')
  const [[produced]]=await conn.query<any[]>("SELECT COUNT(*) AS n FROM worker_pool_code WHERE pool_id=? AND state='bound'",[run.pool_id]);if(Number(produced.n))fail('已有正式生产码，不能修改日期或批号')
  const before=contextOfRun(run),corrected=workerContext({...before,batchNo:body.correction?.batchNo,produceDate:body.correction?.produceDate,expireDate:body.correction?.expireDate})
  await conn.execute("UPDATE worker_run SET effective_context=?,review_needed=1,qc_state='pending',quality_cert_no=NULL WHERE id=?",[JSON.stringify(corrected),id]);await audit(conn,{...user,enterprise_id:run.enterprise_id},'correct_context',id,{original:json(run.context_json),before,corrected,reason})
 }else if(body.action==='quality'){
  if(!['pass','fail'].includes(body.decision))fail('请选择质检结果',400)
  const [[produced]]=await conn.query<any[]>("SELECT COUNT(*) AS n FROM worker_pool_code WHERE pool_id=? AND state='bound'",[run.pool_id])
  if(run.qc_state==='confirmed'){if(body.decision==='pass'&&String(body.qualityCertNo||'').trim()===run.quality_cert_no)return {ok:true,duplicate:true};fail('已确认生产不能覆盖，请走原纠错流程')}
  if(Number(produced.n)>0&&(body.decision!=='pass'||String(body.qualityCertNo||'').trim()!==run.quality_cert_no))fail('已有正式绑定码，不能覆盖质检资料；同资料可重试未完成绑定')
  if(run.review_needed&&!reason)fail('存在人员授权或时间异常，须填写核对说明')
  const certificate=String(body.qualityCertNo||'').trim();if(body.decision==='pass'&&(!certificate||certificate.length>64))fail('确认合格须填写1至64字质量合格证号',400)
  await conn.execute('UPDATE worker_run SET qc_state=?,quality_cert_no=?,review_needed=0 WHERE id=?',[body.decision==='pass'?'binding':'failed',certificate||null,id])
  await audit(conn,{...user,enterprise_id:run.enterprise_id},'quality_'+body.decision,id,{certificate,reason})
 }else if(body.action==='remaining'){
  if(!['approve','reject'].includes(body.decision))fail('请选择余码审核结果',400)
  if(run.review_state==='approved')return {ok:true,duplicate:true}
  if(body.decision==='approve'){
   await conn.execute("UPDATE worker_pool_code SET state='released',active_code_id=NULL WHERE pool_id=? AND state='reserved'",[run.pool_id])
   await conn.execute("UPDATE worker_pool SET state='approved',active_key=NULL WHERE id=?",[run.pool_id])
  }
  await conn.execute('UPDATE worker_run SET review_state=? WHERE id=?',[body.decision==='approve'?'approved':'rejected',id]);await audit(conn,{...user,enterprise_id:run.enterprise_id},'remaining_'+body.decision,id,{reason})
 }else fail('审核操作无效',400)
 return {ok:true}
})}
export async function processWorkerBindings(){
 const rows=await query<any[]>("SELECT id FROM worker_run WHERE qc_state='binding' ORDER BY created_at LIMIT 5")
 for(const row of rows)try{await transaction(async conn=>{
  const [[seed]]=await conn.query<any[]>('SELECT product_id FROM worker_run WHERE id=?',[row.id]);await conn.query('SELECT id FROM product WHERE id=? FOR UPDATE',[seed.product_id])
  const [[r]]=await conn.query<any[]>('SELECT * FROM worker_run WHERE id=? FOR UPDATE',[row.id]);if(r.qc_state!=='binding')return
  const c=contextOfRun(r),[[existing]]=await conn.query<any[]>('SELECT * FROM batch WHERE product_id=? AND batch_no=? FOR UPDATE',[r.product_id,c.batchNo]);let batchId=existing?.id
  if(existing){if(String(existing.produce_date).slice(0,10)!==c.produceDate||String(existing.expire_date).slice(0,10)!==c.expireDate||existing.quality_cert_no!==r.quality_cert_no||Number(existing.qc_result)!==1)fail('既有批次的日期、合格证或质检资料冲突')}
  else {const [b]:any=await conn.execute('INSERT INTO batch(enterprise_id,product_id,batch_no,produce_date,expire_date,quality_cert_no,qc_result,quantity) VALUES(?,?,?,?,?,?,1,0)',[r.enterprise_id,r.product_id,c.batchNo,c.produceDate,c.expireDate,r.quality_cert_no]);batchId=b.insertId}
  const [codes]=await conn.query<any[]>("SELECT p.code_id,t.status,t.batch_id,t.abnormal_flag FROM worker_pool_code p JOIN trace_code t ON t.id=p.code_id WHERE p.pool_id=? AND p.state='captured' ORDER BY p.code_id LIMIT 20 FOR UPDATE",[r.pool_id])
  for(const code of codes){if(code.status!==1||code.batch_id||code.abnormal_flag!==0)fail('采集码状态变更，保持占用并请管理员核对')
   await conn.execute('UPDATE trace_code SET status=2,batch_id=?,batch_no=?,produce_date=?,expire_date=?,quality_cert_no=?,qc_result=1,bound_at=NOW() WHERE id=?',[batchId,c.batchNo,c.produceDate,c.expireDate,r.quality_cert_no,code.code_id]);await conn.execute("UPDATE worker_pool_code SET state='bound' WHERE pool_id=? AND code_id=?",[r.pool_id,code.code_id]);await conn.execute('UPDATE batch SET code_count=code_count+1,quantity=COALESCE(quantity,0)+1 WHERE id=?',[batchId])
  }
  await conn.execute('UPDATE worker_run SET batch_id=? WHERE id=?',[batchId,r.id]);if(codes.length<20)await conn.execute("UPDATE worker_run SET qc_state='confirmed' WHERE id=?",[r.id])
 })}catch(error:any){await execute("UPDATE worker_run SET qc_state='binding_error' WHERE id=? AND qc_state='binding'",[row.id]);await execute('INSERT INTO worker_audit(enterprise_id,run_id,action,detail) SELECT enterprise_id,id,?,? FROM worker_run WHERE id=?',['binding_error',JSON.stringify({reason:String(error.statusMessage||error.message).slice(0,500)}),row.id])}
}
export async function exportWorkerTxt(user:AuthUser,id:string,classification?:string){
 const [r]=await query<any[]>('SELECT * FROM worker_run WHERE id=?',[collectionId(id)]);scope(user,r)
 if(r.mode!=='external')fail('仅外码采集可导出原文TXT')
 if(user.role!=='production_operator')deviceManager(user)
 const conds=["s.run_id=?","e.result_state='saved'"],args:any[]=[id]
 if(user.role==='production_operator'){const [own]=await query<any[]>('SELECT id FROM worker_session WHERE run_id=? AND user_id=? LIMIT 1',[id,user.id]);if(!own)fail('只能下载自己参与采集的记录',403);conds.push('s.user_id=?');args.push(user.id)}
 if(classification&&classification!=='all'){if(!['internal','external','own','other_enterprise','not_imported','unparsed'].includes(classification))fail('分类无效',400);conds.push('e.classification=?');args.push(classification)}
 const rows=await query<any[]>(`SELECT e.raw_code FROM worker_event e JOIN worker_session s ON s.id=e.session_id WHERE ${conds.join(' AND ')} ORDER BY e.received_at,e.sequence_no`,args)
 await execute('INSERT INTO worker_audit(enterprise_id,actor_id,run_id,action,detail) VALUES(?,?,?,?,?)',[r.enterprise_id,user.id,id,'export_txt',JSON.stringify({classification:classification||'all',count:rows.length})])
 return '\uFEFF'+rows.map(e=>String(e.raw_code).replace(/\r/g,'\\r').replace(/\n/g,'\\n')).join('\r\n')+(rows.length?'\r\n':'')
}

export async function workerHeartbeat(device:AuthUser,id:string,body:any){
 collectionId(id);const version=Number(body.version),sequence=Number(body.sequence),values=['valid','duplicate','exception','pending'].map(k=>Number(body[k]));
 if(!Number.isSafeInteger(version)||version<=0||!Number.isSafeInteger(sequence)||sequence<0||values.some(n=>!Number.isSafeInteger(n)||n<0||n>1000000000)||(values[0]! + values[1]! + values[2]!) !== sequence||values[3]!>sequence||!['running','paused','ended'].includes(body.state))fail('设备状态格式无效',400)
 return transaction(async conn=>{
  await lockProductionDevice(conn,device);const [[seed]]=await conn.query<any[]>('SELECT r.* FROM worker_run r JOIN worker_session s ON s.run_id=r.id WHERE s.id=? AND s.device_id=?',[id,device.device_id]);if(!seed)fail('采集会话不存在',404);if(seed.task_id)await lockMonitoredTask(conn,Number(seed.task_id));
  const [[s]]=await conn.query<any[]>('SELECT * FROM worker_session WHERE id=? FOR UPDATE',[id]);if(s.state==='completed'||version<=Number(s.report_version))return {ok:true,ignored:true};
  const [[u]]=await conn.query<any[]>('SELECT u.status,u.role,u.enterprise_id,u.session_epoch,g.user_version FROM worker_grant g JOIN user u ON u.id=g.user_id WHERE g.id=?',[s.grant_id]);if(!u||u.status!==1||u.role!=='production_operator'||Number(u.enterprise_id)!==Number(device.enterprise_id)||u.session_epoch!==u.user_version)fail('工人权限已失效，请重新登录',403);
  if(sequence<Number(s.last_sequence)||sequence<Number(s.reported_sequence||0))return {ok:true,ignored:true};
  await conn.execute('UPDATE worker_session SET heartbeat_ms=?,report_version=?,capture_state=?,reported_sequence=?,local_valid=?,local_duplicate=?,local_exception=?,local_pending=? WHERE id=?',[Date.now(),version,body.state,sequence,...values,id]);return {ok:true,serverTime:Date.now()}
 })
}
