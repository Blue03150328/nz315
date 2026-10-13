import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { AuthUser } from './auth'
import { query } from './db'
import { transaction, bindProductionInTransaction, productionReviewer } from './production-task'
import { selectProductionAllocation, recordProductionAllocation } from './production-allocation'
import { productionAllocationInput } from '../../shared/utils/production-allocation-input'
import { productionRequestId } from '../../shared/utils/production-task-input'
import { refreshUploadSnapshots } from './upload-snapshot'
import { headOf } from './code-head'
import { openStockLineSession, stockLineEvent } from './stock-line-production'
import { projectWorkerCodeUsage } from '#scripts/worker-code-usage.mjs'
import { collectionId, collectionCode } from '../../shared/utils/collection-input'
function fail(message:string,statusCode=409):never{throw createError({statusCode,statusMessage:message})}
const hash=(value:any)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const json=(value:any)=>typeof value==='string'?JSON.parse(value):value
function scope(user:AuthUser,row:any){if(!row||(user.role!=='platform_admin'&&Number(row.enterprise_id)!==Number(user.enterprise_id)))fail('记录不存在或不属于本企业',404)}
export const taskPoolId=(id:number)=>'00000000-0000-4000-8000-'+String(id).padStart(12,'0')
export function offlineExportKey(grantId:string){return createHmac('sha256',String(useRuntimeConfig().sessionSecret)).update('nz315-offline-v1:'+grantId).digest('hex')}
export async function createLineTask(user:AuthUser,body:any){
 let input:ReturnType<typeof productionAllocationInput>,requestId:string
 try{input=productionAllocationInput(body);requestId=productionRequestId(body)}catch(e:any){fail(e.message,400)}
 const name=String(body.name||'').trim(),line=String(body.lineName||'').trim(),cert=String(body.qualityCertNo||'').trim()
 if(!name||name.length>100||!line||line.length>100||!cert||cert.length>100||body.qcResult!==1)fail('请填写任务名称、生产线、合格证号并确认质检结果',400)
 const requestHash=hash({input,name,line,cert,qcResult:1})
 return transaction(async conn=>{
  const [[previous]]=await conn.query<any[]>('SELECT id,request_hash FROM production_task WHERE created_by=? AND request_id=?',[user.id,requestId])
  if(previous){if(previous.request_hash!==requestHash)fail('相同提交标识不能用于不同任务');return {ok:true,id:Number(previous.id),duplicate:true}}
  let seed:any
  if(input.sourceTaskId)[[seed]]=await conn.query<any[]>('SELECT product_id,enterprise_id FROM production_task WHERE id=?',[input.sourceTaskId])
  else if(input.sourceUploadBatchId)[[seed]]=await conn.query<any[]>('SELECT product_id,enterprise_id FROM upload_batch WHERE id=?',[input.sourceUploadBatchId])
  else [[seed]]=await conn.query<any[]>('SELECT product_id,enterprise_id FROM trace_code WHERE code=?',[input.codes[0]])
  scope(user,seed)
  const [[product]]=await conn.query<any[]>('SELECT p.*,s.spec_code FROM product p LEFT JOIN product_spec s ON s.id=p.spec_id WHERE p.id=? FOR UPDATE',[seed.product_id]);scope(user,product)
  if(Number(product.status)!==1)fail('产品已停用')
  const allocation=await selectProductionAllocation(conn,product,input)
  const [r]:any=await conn.execute("INSERT INTO production_task(enterprise_id,product_id,batch_id,name,line_name,request_id,request_hash,created_by,workflow,draft_qc_result,draft_quality_cert_no) VALUES(?,?,NULL,?,?,?,?,?,'worker-line',1,?)",[product.enterprise_id,product.id,name,line,requestId,requestHash,user.id,cert])
  const [change]:any=await conn.execute("INSERT INTO production_task_change(task_id,actor_id,action,request_id,request_hash,detail) VALUES(?,?,'create',?,?,?)",[r.insertId,user.id,requestId,requestHash,JSON.stringify({count:allocation.rows.length,sourceTaskId:allocation.sourceTaskId,codes:allocation.rows.map(c=>c.code)})])
  await recordProductionAllocation(conn,r.insertId,allocation.rows,change.insertId,allocation.sourceTaskId)
  return {ok:true,id:Number(r.insertId),total:allocation.rows.length,duplicate:false}
 })
}
export async function editLineTask(user:AuthUser,id:number,body:any){
 const requestId=productionRequestId(body),requestHash=hash(body)
 return transaction(async conn=>{
  const [[seed]]=await conn.query<any[]>('SELECT * FROM production_task WHERE id=?',[id]);scope(user,seed)
  await conn.query('SELECT id FROM product WHERE id=? FOR UPDATE',[seed.product_id])
  const [[task]]=await conn.query<any[]>('SELECT * FROM production_task WHERE id=? FOR UPDATE',[id])
  if(Number(task.created_by)!==user.id&&!productionReviewer(user))fail('仅管理员或创建人可编辑任务',403)
  const [[prior]]=await conn.query<any[]>('SELECT request_hash FROM production_task_change WHERE task_id=? AND actor_id=? AND request_id=?',[id,user.id,requestId])
  if(prior){if(prior.request_hash!==requestHash)fail('相同提交标识不能用于不同编辑');return {ok:true,id,duplicate:true}}
  if(['batchNo','produceDate','expireDate'].some(k=>body[k]))fail('生产日期、有效期和批号由工人填写，后台不能覆盖',400)
  const name=String(body.name||task.name).trim(),line=String(body.lineName||task.line_name).trim(),cert=String(body.qualityCertNo??task.draft_quality_cert_no).trim()
  if(!name||name.length>100||!line||line.length>100||!cert||cert.length>100||Number(body.qcResult??task.draft_qc_result)!==1)fail('任务名称、生产线及质检资料无效',400)
  if(task.batch_id&&cert!==task.draft_quality_cert_no)fail('工人已开始此批生产，不能更改质检资料')
  let allocation:any=null
  if(body.allocation){if(task.status!=='active')fail('已结束的任务不能追加领用');const [[p]]=await conn.query<any[]>('SELECT p.*,s.spec_code FROM product p LEFT JOIN product_spec s ON s.id=p.spec_id WHERE p.id=?',[task.product_id]);allocation=await selectProductionAllocation(conn,p,body.allocation)}
  await conn.execute('UPDATE production_task SET name=?,line_name=?,draft_quality_cert_no=? WHERE id=?',[name,line,cert,id])
  const [r]:any=await conn.execute("INSERT INTO production_task_change(task_id,actor_id,action,request_id,request_hash,detail) VALUES(?,?,'edit',?,?,?)",[id,user.id,requestId,requestHash,JSON.stringify({before:{name:task.name,lineName:task.line_name},after:{name,lineName:line},count:allocation?.rows.length||0})])
  if(allocation)await recordProductionAllocation(conn,id,allocation.rows,r.insertId,allocation.sourceTaskId)
  return {ok:true,id,added:allocation?.rows.length||0}
 })
}
export async function lineCache(device:AuthUser){
 const tasks=await query<any[]>("SELECT t.*,b.batch_no,b.produce_date,b.expire_date,(SELECT COUNT(*) FROM production_task_code d WHERE d.task_id=t.id) AS total,(SELECT COUNT(*) FROM production_task_code d WHERE d.task_id=t.id AND d.state='used') AS collected FROM production_task t LEFT JOIN batch b ON b.id=t.batch_id LEFT JOIN product p ON p.id=t.product_id WHERE t.enterprise_id=? AND t.status='active' AND t.workflow='line-team' AND (t.product_id IS NULL OR p.status=1) ORDER BY t.id",[device.enterprise_id])
 const pools=tasks.map(t=>({workflow:t.workflow,id:taskPoolId(t.id),product_id:t.product_id,state:'ready',task_id:t.id,task_name:t.name,line_name:t.line_name,context:t.batch_id?{batchNo:t.batch_no,produceDate:String(t.produce_date).slice(0,10),expireDate:String(t.expire_date).slice(0,10)}:null}))
 const assigned=await query<any[]>('SELECT task_id,user_id FROM production_task_member WHERE removed_at IS NULL')
 for(const pool of pools)(pool as any).memberIds=pool.workflow==='line-team'?assigned.filter(m=>Number(m.task_id)===Number(pool.task_id)).map(m=>Number(m.user_id)):null
 const codes=await query<any[]>("SELECT d.task_id,d.code,d.state,t.product_id FROM production_task_code d JOIN production_task t ON t.id=d.task_id WHERE t.enterprise_id=? AND t.status='active' AND d.active_code_id IS NOT NULL ORDER BY t.id,d.code_id",[device.enterprise_id])
 const stock=await query<any[]>(`SELECT c.code,c.product_id,c.status,c.abnormal_flag,r.owner_kind,r.owner_id FROM trace_code c
  LEFT JOIN production_code_reservation r ON r.code_id=c.id WHERE c.enterprise_id=? ORDER BY c.id`,[device.enterprise_id])
 return {pools,codes:[...codes.map(c=>({...c,pool_id:taskPoolId(c.task_id)})),...stock.map(c=>({...c,pool_id:'stock:'+c.product_id,state:Number(c.status)===1&&!Number(c.abnormal_flag)?'reserved':'unavailable'}))]}
}
/** 由首码缓存匹配到具体任务；服务端重新核对公司、产品及不可变生产资料。 */
export async function openLineSession(conn:any,device:AuthUser,body:any,context:any,g:any){
 if(context.stockWorkflow)return openStockLineSession(conn,device,body,context,g)
 const runId=collectionId(body.runId),sessionId=collectionId(body.sessionId)
 await conn.query('SELECT id FROM product WHERE id=? FOR UPDATE',[context.productId])
 if(context.taskId===0){
  const [[p]]=await conn.query('SELECT * FROM product WHERE id=?',[context.productId]);scope(device,p)
  const [[r]]=await conn.query('SELECT * FROM worker_run WHERE id=? FOR UPDATE',[runId])
  if(r&&(r.device_id!==device.device_id||r.context_hash!==hash(context)))fail('未识别任务的批次资料冲突')
  if(!r)await conn.execute("INSERT INTO worker_run(id,device_id,enterprise_id,product_id,mode,context_json,context_hash,review_needed,device_snapshot) VALUES(?,?,?,?,'production',?,?,1,?)",[runId,device.device_id,device.enterprise_id,context.productId,JSON.stringify(context),hash(context),JSON.stringify({id:device.device_id,name:device.name,lineName:device.device_line})])
  const [[s]]=await conn.query('SELECT * FROM worker_session WHERE id=?',[sessionId])
  if(s&&(s.run_id!==runId||s.grant_id!==g.id||s.device_id!==device.device_id))fail('会话归属不一致')
  if(!s)await conn.execute('INSERT INTO worker_session(id,run_id,device_id,user_id,grant_id,identity_json,started_at,started_ms) VALUES(?,?,?,?,?,?,?,?)',[sessionId,runId,device.device_id,g.user_id,g.id,JSON.stringify(json(g.identity_json)),new Date(String(body.startedAt)),Date.parse(String(body.startedAt))])
  return {ok:true,runId,sessionId,identity:json(g.identity_json)}
 }
 const [[task]]=await conn.query('SELECT * FROM production_task WHERE id=? FOR UPDATE',[context.taskId]);scope(device,task)
 if(Number(task.product_id)!==context.productId)fail('所选产品与首码所属任务不一致',400)
 const [[prior]]=await conn.query('SELECT * FROM worker_run WHERE id=? FOR UPDATE',[runId])
 const [[existingSession]]=await conn.query('SELECT * FROM worker_session WHERE id=?',[sessionId])
 if(existingSession){if(existingSession.run_id!==runId||existingSession.grant_id!==g.id||existingSession.device_id!==device.device_id||prior?.context_hash!==hash(context))fail('原会话与文件生产资料不一致');return {ok:true,runId,sessionId,identity:json(g.identity_json)}}
 if(task.status!=='active')fail('任务已结束；不能继续生产，原记录仍可重传')
 if(task.workflow==='line-team'){const [[member]]=await conn.query('SELECT *,UNIX_TIMESTAMP(added_at)*1000 AS added_ms,UNIX_TIMESTAMP(removed_at)*1000 AS removed_ms FROM production_task_member WHERE task_id=? AND user_id=?',[task.id,g.user_id]);const at=Date.parse(String(body.startedAt));if(!member||at<Number(member.added_ms)-60000||(member.removed_at&&at>Number(member.removed_ms)))fail('当前工人未安排在这条生产线上',403)}
 if(prior&&(prior.device_id!==device.device_id||prior.context_hash!==hash(context)||prior.state!=='active'))fail('批次标识或生产资料冲突')
 let conflict=false
 const [[product]]=await conn.query('SELECT * FROM product WHERE id=?',[context.productId]);scope(device,product)
 if(Number(product.status)!==1)fail('产品已停用')
 let batch:any
 if(task.batch_id){[[batch]]=await conn.query('SELECT * FROM batch WHERE id=? FOR UPDATE',[task.batch_id]);conflict=!batch||batch.batch_no!==context.batchNo||String(batch.produce_date).slice(0,10)!==context.produceDate||String(batch.expire_date).slice(0,10)!==context.expireDate}
 else {
  const [[old]]=await conn.query('SELECT * FROM batch WHERE product_id=? AND batch_no=? FOR UPDATE',[context.productId,context.batchNo])
  if(old){batch=old;conflict=String(old.produce_date).slice(0,10)!==context.produceDate||String(old.expire_date).slice(0,10)!==context.expireDate||(task.workflow!=='line-team'&&(old.quality_cert_no!==task.draft_quality_cert_no||Number(old.qc_result)!==1))||Number(old.qc_result)===0&&old.qc_result!==null}
  else {const [r]=await conn.execute('INSERT INTO batch(enterprise_id,product_id,batch_no,produce_date,expire_date,quality_cert_no,qc_result,quantity) VALUES(?,?,?,?,?,?,?,0)',[task.enterprise_id,task.product_id,context.batchNo,context.produceDate,context.expireDate,task.draft_quality_cert_no,task.workflow==='line-team'?null:1]);batch={id:r.insertId}}
  if(!conflict)await conn.execute('UPDATE production_task SET batch_id=? WHERE id=?',[batch.id,task.id])
 }
 if(!prior)await conn.execute('INSERT INTO worker_run(id,device_id,enterprise_id,task_id,product_id,mode,context_json,context_hash,review_needed,device_snapshot,product_snapshot) VALUES(?,?,?,?,?,\'production\',?,?,?,?,?)',[runId,device.device_id,device.enterprise_id,task.id,context.productId,JSON.stringify(context),hash(context),conflict||g.changed?1:0,JSON.stringify({id:device.device_id,name:device.name,lineName:task.line_name,enterpriseName:device.enterprise_name}),JSON.stringify({id:product.id,name:product.name})])
 await conn.execute('INSERT INTO worker_session(id,run_id,device_id,user_id,grant_id,identity_json,started_at,started_ms) VALUES(?,?,?,?,?,?,?,?)',[sessionId,runId,device.device_id,g.user_id,g.id,JSON.stringify({...json(g.identity_json),lineName:task.line_name}),new Date(String(body.startedAt)),Date.parse(String(body.startedAt))])
 await conn.execute("INSERT INTO worker_audit(enterprise_id,actor_id,device_id,run_id,action,detail) VALUES(?,?,?,?,'join_line',?)",[task.enterprise_id,g.user_id,device.device_id,runId,JSON.stringify({taskId:task.id,context,conflict})])
 return {ok:true,runId,sessionId,identity:json(g.identity_json)}
}
export async function lineEvent(conn:any,device:AuthUser,run:any,s:any,event:any,within:boolean,g:any){
 if(json(run.context_json).stockWorkflow)return stockLineEvent(conn,device,run,s,event,within,g,bindTeamCode)
 const [[task]]=await conn.query('SELECT * FROM production_task WHERE id=? FOR UPDATE',[run.task_id]);scope(device,task)
 let result='exception',reason=''
 const c=json(run.context_json),[[batch]]=task.batch_id?await conn.query('SELECT * FROM batch WHERE id=?',[task.batch_id]):[[]]
 if(!within)reason='采集时间超出工人授权范围'
 else if(!batch||batch.batch_no!==c.batchNo||String(batch.produce_date).slice(0,10)!==c.produceDate||String(batch.expire_date).slice(0,10)!==c.expireDate)reason='同任务生产资料不一致，待管理员核对'
 else if(Number(g.us)!==1||Number(g.uv)!==Number(g.user_version)||g.ur!=='production_operator'||Number(g.ue)!==Number(run.enterprise_id))reason='员工权限已变更，待管理员核对'
 else if(task.status!=='active')reason='任务已结束，记录保留，禁止覆盖原生产资料'
 else if(!event.code)reason='缺位或多个完整码，无法确定追溯码'
 else {
  const [[detail]]=await conn.query('SELECT * FROM production_task_code WHERE task_id=? AND code=? FOR UPDATE',[task.id,event.code])
  if(!detail)reason='此码未领用到当前任务或属于其他产品、生产线'
  else if(detail.state==='used'){result='duplicate';reason='此码已被采集，不重复计入生产'}
  else if(event.kind!=='valid')reason='本机判定为重复或异常，保留原文'
  else {
   try {if(task.workflow==='line-team')await bindTeamCode(conn,task,batch,detail,Number(s.user_id),device.name||'');else await bindProductionInTransaction(conn,{...device,id:Number(s.user_id)},task.id,{code:event.code,device:device.name},task,task.line_name);result='saved'}
   catch(e:any){if(!e.statusCode)throw e;reason=e.statusMessage||'码状态发生冲突'}
  }
 }
 return {result,reason}
}
async function bindTeamCode(conn:any,task:any,batch:any,detail:any,userId:number,device:string){
 const [[tc]]=await conn.query('SELECT * FROM trace_code WHERE id=? FOR UPDATE',[detail.code_id])
 const [[product]]=await conn.query('SELECT p.*,s.spec_code FROM product p LEFT JOIN product_spec s ON s.id=p.spec_id WHERE p.id=?',[task.product_id])
 if(!tc||!product||Number(product.status)!==1||!product.spec_code||!String(tc.code).startsWith(headOf(product))||Number(tc.enterprise_id)!==Number(task.enterprise_id)||Number(tc.product_id)!==Number(task.product_id)||detail.state!=='reserved'||Number(detail.active_code_id)!==Number(tc.id)||Number(tc.status)!==1||tc.batch_id||tc.abnormal_flag||tc.bound_at||tc.produce_date||tc.expire_date||tc.batch_no||tc.quality_cert_no||tc.qc_result!==null)fail('码状态发生变化，不能覆盖已有生产记录')
 await conn.execute('UPDATE trace_code SET batch_id=?,batch_no=?,produce_date=?,expire_date=?,qc_result=?,quality_cert_no=?,status=2,bound_at=NOW() WHERE id=?',[batch.id,batch.batch_no,batch.produce_date,batch.expire_date,batch.qc_result,batch.quality_cert_no,tc.id])
 await conn.execute("UPDATE production_task_code SET state='used',used_by=?,device=?,used_line=?,used_at=NOW() WHERE task_id=? AND code_id=?",[userId,device,task.line_name,task.id,tc.id])
 await conn.execute('UPDATE batch SET code_count=(SELECT COUNT(*) FROM trace_code WHERE batch_id=?) WHERE id=?',[batch.id,batch.id])
 if(tc.upload_batch_id)await refreshUploadSnapshots(conn,[Number(tc.upload_batch_id)])
}
export async function lineWorkerProgress(user:AuthUser,taskId:number,params:any={}){
 const [task]=await query<any[]>('SELECT * FROM production_task WHERE id=?',[taskId]);scope(user,task)
 const rows=await query<any[]>(`SELECT s.user_id,MAX(JSON_UNQUOTE(JSON_EXTRACT(s.identity_json,'$.name'))) AS name,MAX(JSON_UNQUOTE(JSON_EXTRACT(s.identity_json,'$.username'))) AS username,COUNT(e.id) AS scans,COALESCE(SUM(e.result_state='saved' OR e.resolution_state='bound'),0) AS collected,COALESCE(SUM(e.result_state='duplicate'),0) AS duplicates,COALESCE(SUM(e.result_state='exception'),0) AS exceptions,MAX(e.received_at) AS last_uploaded,COUNT(DISTINCT s.device_id) AS devices,MIN(s.started_at) AS started_at,MAX(s.stopped_at) AS stopped_at,MIN(s.started_ms) AS started_ms,MAX(s.stopped_ms) AS stopped_ms,MAX(UNIX_TIMESTAMP(e.received_at)*1000) AS last_uploaded_ms,COUNT(DISTINCT CASE WHEN s.state='active' THEN s.id END) AS active_sessions FROM worker_run r JOIN worker_session s ON s.run_id=r.id LEFT JOIN worker_event e ON e.session_id=s.id WHERE r.task_id=? GROUP BY s.user_id ORDER BY collected DESC,s.user_id`,[taskId])
 const assigned=await query<any[]>('SELECT op.id AS user_id,op.name,op.username FROM production_task_member m JOIN user op ON op.id=m.user_id WHERE m.task_id=? AND m.removed_at IS NULL',[taskId]);for(const person of assigned)if(!rows.some(r=>Number(r.user_id)===Number(person.user_id)))rows.push({...person,collected:0,duplicates:0,exceptions:0,devices:0,active_sessions:0,started_at:null,stopped_at:null,last_uploaded:null})
 const page=Math.max(1,Number(params.page)||1),userId=Number(params.userId)||0
 const where='r.task_id=?'+(userId?' AND s.user_id=?':'')+(params.state&&['saved','duplicate','exception'].includes(params.state)?' AND e.result_state=?':'')
 const args:any[]=[taskId];if(userId)args.push(userId);if(params.state&&['saved','duplicate','exception'].includes(params.state))args.push(params.state)
 const events=userId?await query<any[]>(`SELECT e.*,s.user_id,JSON_UNQUOTE(JSON_EXTRACT(s.identity_json,'$.name')) AS worker_name,JSON_UNQUOTE(JSON_EXTRACT(r.device_snapshot,'$.name')) AS device_name FROM worker_event e JOIN worker_session s ON s.id=e.session_id JOIN worker_run r ON r.id=s.run_id WHERE ${where} ORDER BY e.received_at DESC,e.id LIMIT 100 OFFSET ?`,[...args,(page-1)*100]):[]
 const [count]=userId?await query<any[]>(`SELECT COUNT(*) AS n FROM worker_event e JOIN worker_session s ON s.id=e.session_id JOIN worker_run r ON r.id=s.run_id WHERE ${where}`,args):[{n:0}]
 const [legacy]=await query<any[]>('SELECT COUNT(*) AS n FROM production_collection_event e JOIN production_collection_session s ON s.id=e.session_id WHERE s.task_id=?',[taskId])
 return {task:{id:task.id,name:task.name,lineName:task.line_name},rows,events,total:Number(count.n),page,legacyRecords:Number(legacy.n)}
}
export async function resolveLineException(user:AuthUser,taskId:number,body:any){
 if(!productionReviewer(user))fail('仅管理员可核对生产异常',403)
 const id=collectionId(body.eventId),action=String(body.action||''),reason=String(body.reason||'').trim()
 if(!['bind','unused'].includes(action)||!reason||reason.length>500)fail('请选择已投产或未投产，并填写核对依据',400)
 return transaction(async conn=>{
  const [[seed]]=await conn.query<any[]>('SELECT * FROM production_task WHERE id=?',[taskId]);scope(user,seed)
  const [[eventSeed]]=await conn.query<any[]>('SELECT r.product_id FROM worker_event e JOIN worker_session s ON s.id=e.session_id JOIN worker_run r ON r.id=s.run_id WHERE e.id=? AND r.task_id=?',[id,taskId])
  await conn.query('SELECT id FROM product WHERE id=? FOR UPDATE',[eventSeed?.product_id||seed.product_id])
  const [[task]]=await conn.query<any[]>('SELECT * FROM production_task WHERE id=? FOR UPDATE',[taskId])
  const [[e]]=await conn.query<any[]>('SELECT e.*,s.user_id,r.device_snapshot,r.context_json,r.batch_id,r.product_id,r.enterprise_id,r.id AS run_id FROM worker_event e JOIN worker_session s ON s.id=e.session_id JOIN worker_run r ON r.id=s.run_id WHERE e.id=? AND r.task_id=? FOR UPDATE',[id,taskId])
  if(!e||e.result_state!=='exception')fail('该异常记录不存在或无需核对',404)
  if(e.resolution_state)return {ok:true,duplicate:true,state:e.resolution_state}
  if(task.status!=='active')fail('任务已结束，不能更改生产归属')
  let state='unused'
  if(action==='bind'){
   if(!e.code)fail('没有可核对的完整码')
   if(json(e.context_json).stockWorkflow){
    // 管理员仅核对历史采集授权；产品、批次、码占用校验仍然执行。
    const result=await stockLineEvent(conn,{name:json(e.device_snapshot)?.name||'管理员核对'},{...e,id:e.run_id,task_id:taskId},{user_id:e.user_id},{code:e.code,kind:'valid'},true,{manualReview:true,us:1,uv:0,user_version:0,ur:'production_operator',ue:task.enterprise_id},bindTeamCode)
    if(result.result==='exception')fail(result.reason);state=result.result==='duplicate'?'duplicate':'bound'
   }else if(task.workflow==='line-team'){
    if(!task.batch_id)fail('没有可核对的任务生产资料')
    const [[batch]]=await conn.query<any[]>('SELECT * FROM batch WHERE id=?',[task.batch_id]),[[detail]]=await conn.query<any[]>('SELECT * FROM production_task_code WHERE task_id=? AND code=?',[taskId,e.code])
    if(!detail)fail('此码不属于当前任务，不能改为本任务生产')
    if(detail.state==='used')state='duplicate'
    else {await bindTeamCode(conn,task,batch,detail,Number(e.user_id),json(e.device_snapshot)?.name||'管理员核对');state='bound'}
   }else{
    const result=await bindProductionInTransaction(conn,{...user,id:Number(e.user_id)},taskId,{code:e.code,device:json(e.device_snapshot)?.name||'管理员核对'},task,task.line_name)
    state=result.duplicate?'duplicate':'bound'
   }
  }
  await conn.execute('UPDATE worker_event SET resolution_state=?,resolution_reason=?,resolved_by=?,resolved_at=NOW() WHERE id=?',[state,reason,user.id,id])
  if(state==='bound')await projectWorkerCodeUsage(conn,e.session_id)
  await conn.execute("INSERT INTO worker_audit(enterprise_id,actor_id,run_id,action,detail) VALUES(?,?,NULL,'resolve_line_exception',?)",[task.enterprise_id,user.id,JSON.stringify({eventId:id,taskId,action,state,reason,originalWorkerId:e.user_id})])
  return {ok:true,state}
 })
}
