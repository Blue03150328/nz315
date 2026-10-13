import {resolveAutomaticTask,lockMonitoredTask} from './production-monitor'
import { createHash } from 'node:crypto'
import { headOf } from './code-head'
const fail=(message:string,statusCode=409):never=>{throw createError({statusCode,statusMessage:message})}
const json=(value:any)=>typeof value==='string'?JSON.parse(value):value
const hash=(value:any)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
async function collectionRoot(conn:any,run:any,product:any,batch:any,context:any,userId:number){
 const [[lockedRun]]=await conn.query('SELECT upload_batch_id FROM worker_run WHERE id=? FOR UPDATE',[run.id]);if(lockedRun.upload_batch_id)return lockedRun.upload_batch_id
 const name=('生产采集_'+product.name+'_'+context.produceDate+'_'+context.batchNo+'_'+run.id+'.txt').slice(0,255)
 const [upload]=await conn.execute('INSERT INTO upload_batch(enterprise_id,file_name,product_id,batch_id,batch_no,produce_date,quality_cert_no,created_by,spec_name_snapshot) VALUES(?,?,?,?,?,?,NULL,?,?)',[run.enterprise_id,name,run.product_id,batch.id,context.batchNo,context.produceDate,userId,product.spec_name])
 await conn.execute('UPDATE worker_run SET upload_batch_id=? WHERE id=?',[upload.insertId,run.id]);return upload.insertId
}

/** 任务只确定生产线和人员；产品及生产批次固定在本次工人采集中。 */
export async function openStockLineSession(conn:any,device:any,body:any,context:any,g:any){
 const [[p]]=await conn.query('SELECT p.*,s.spec_code FROM product p LEFT JOIN product_spec s ON s.id=p.spec_id WHERE p.id=? FOR UPDATE',[context.productId])
 if(!p||Number(p.enterprise_id)!==Number(device.enterprise_id)||Number(p.status)!==1)fail('请选择本厂启用的产品',403)
 if(!/^\d{11}$/.test(headOf(p)))fail('产品未配置有效的登记证或规格，请联系管理员')
 if(context.autoLine)await resolveAutomaticTask(conn,device,body,context,g)
 const task=await lockMonitoredTask(conn,context.taskId)
 if(!task||task.workflow!=='line-team'||Number(task.enterprise_id)!==Number(device.enterprise_id))fail('生产线任务不存在或不属于本厂',403)
 const [[prior]]=await conn.query('SELECT * FROM worker_run WHERE id=? FOR UPDATE',[body.runId]),[[s]]=await conn.query('SELECT * FROM worker_session WHERE id=?',[body.sessionId])
 if(s){if(!prior||prior.device_id!==device.device_id||prior.context_hash!==hash(context)||s.run_id!==body.runId||s.grant_id!==g.id)fail('原采集身份或资料不一致');return {ok:true,runId:body.runId,sessionId:body.sessionId,identity:json(g.identity_json),context}}
 if(task.status!=='active')fail('生产线任务已结束，不能开始新采集')
 const [[member]]=await conn.query('SELECT UNIX_TIMESTAMP(added_at)*1000 AS added_ms,UNIX_TIMESTAMP(removed_at)*1000 AS removed_ms,removed_at FROM production_task_member WHERE task_id=? AND user_id=?',[task.id,g.user_id])
 const at=Date.parse(body.startedAt);if(!member||at<Number(member.added_ms)-60000||(member.removed_at&&at>Number(member.removed_ms)))fail('当前工人未安排在此生产线上',403)
 if(prior&&(prior.device_id!==device.device_id||prior.context_hash!==hash(context)||prior.state!=='active'))fail('原批次身份或资料不一致')
 if(!prior){
  const [[old]]=await conn.query('SELECT * FROM batch WHERE product_id=? AND batch_no=? FOR UPDATE',[p.id,context.batchNo]);let batchId=old?.id,conflict=false
  if(old)conflict=String(old.produce_date).slice(0,10)!==context.produceDate||String(old.expire_date).slice(0,10)!==context.expireDate||old.qc_result===0
  else {const [b]=await conn.execute('INSERT INTO batch(enterprise_id,product_id,batch_no,produce_date,expire_date,qc_result,quality_cert_no,quantity) VALUES(?,?,?,?,?,NULL,NULL,0)',[device.enterprise_id,p.id,context.batchNo,context.produceDate,context.expireDate]);batchId=b.insertId}
  await conn.execute(`INSERT INTO worker_run(id,device_id,enterprise_id,task_id,product_id,batch_id,mode,context_json,context_hash,review_needed,device_snapshot,product_snapshot)
   VALUES(?,?,?,?,?,?,'production',?,?,?,?,?)`,[body.runId,device.device_id,device.enterprise_id,task.id,p.id,batchId,JSON.stringify(context),hash(context),conflict||g.changed?1:0,
   JSON.stringify({id:device.device_id,name:device.name,lineName:task.line_name,enterpriseName:device.enterprise_name}),JSON.stringify({id:p.id,name:p.name})])
 }
 await conn.execute('INSERT INTO worker_session(id,run_id,device_id,user_id,grant_id,identity_json,started_at,started_ms) VALUES(?,?,?,?,?,?,?,?)',[body.sessionId,body.runId,device.device_id,g.user_id,g.id,JSON.stringify({...json(g.identity_json),lineName:task.line_name}),new Date(at),at])
 await conn.execute("INSERT INTO worker_audit(enterprise_id,actor_id,device_id,run_id,action,detail) VALUES(?,?,?,?,'join_stock_line',?)",[task.enterprise_id,g.user_id,device.device_id,body.runId,JSON.stringify({taskId:task.id,productId:p.id,context})])
 return {ok:true,runId:body.runId,sessionId:body.sessionId,identity:json(g.identity_json),context}
}

/** 生产采集才入库；新码、归线、绑定和收据由调用方同事务提交。 */
export async function stockLineEvent(conn:any,device:any,run:any,s:any,event:any,within:boolean,g:any,bind:any){
 const [[task]]=await conn.query('SELECT * FROM production_task WHERE id=? FOR UPDATE',[run.task_id]),[[batch]]=await conn.query('SELECT * FROM batch WHERE id=? FOR UPDATE',[run.batch_id]);const context=json(run.context_json)
 let reason='';if(!within)reason='采集时间超出工人授权范围'
 else if(!task||task.status!=='active')reason='生产线任务已结束，记录保留'
 else if(Number(g.us)!==1||Number(g.uv)!==Number(g.user_version)||g.ur!=='production_operator'||Number(g.ue)!==Number(run.enterprise_id))reason='员工权限已变更，待核对'
 else if(!batch||batch.product_id!==run.product_id||batch.batch_no!==context.batchNo||String(batch.produce_date).slice(0,10)!==context.produceDate||String(batch.expire_date).slice(0,10)!==context.expireDate||batch.qc_result===0)reason='同产品同批号生产资料不一致，待核对'
 if(reason)return {result:'exception',reason}
 if(!g.manualReview){const [[member]]=await conn.query('SELECT UNIX_TIMESTAMP(added_at)*1000 AS added_ms,UNIX_TIMESTAMP(removed_at)*1000 AS removed_ms FROM production_task_member WHERE task_id=? AND user_id=?',[task.id,s.user_id]);const at=Date.parse(event.capturedAt);if(!member||at<Number(member.added_ms)-60000||(member.removed_ms&&at>Number(member.removed_ms)))return {result:'exception',reason:'工人未参与此生产线或已被移出，原始记录保留'}}
 const [[product]]=await conn.query('SELECT p.*,s.spec_code,s.spec_name FROM product p LEFT JOIN product_spec s ON s.id=p.spec_id WHERE p.id=?',[run.product_id])
 if(!event.code||!/^\d{32}$/.test(event.code))return {result:'exception',reason:'缺位或多个完整码，无法确定追溯码'}
 if(!product||Number(product.enterprise_id)!==Number(run.enterprise_id)||product.status!==1||!/^\d{11}$/.test(headOf(product))||!event.code.startsWith(headOf(product)))return {result:'exception',reason:'码结构与所选产品、登记证或规格不一致'}
 let [[code]]=await conn.query('SELECT * FROM trace_code WHERE code=? FOR UPDATE',[event.code])
 if(code&&(Number(code.enterprise_id)!==Number(run.enterprise_id)||Number(code.product_id)!==Number(run.product_id)))return {result:'exception',reason:'此码属于其他企业或产品，不能覆盖'}
 if(!code&&event.kind!=='valid')return {result:'exception',reason:'本机判定为异常，原文保留，不入库'}
 if(!code){
  const root=await collectionRoot(conn,run,product,batch,context,s.user_id)
  // 全局唯一键与产品/任务锁保护竞争；若竞争插入失败，整个事件回滚并以原UUID重试。
  const [created]=await conn.execute('INSERT INTO trace_code(enterprise_id,product_id,upload_batch_id,code,status,abnormal_flag,uploaded_at) VALUES(?,?,?,?,1,0,NOW())',[run.enterprise_id,run.product_id,root,event.code])
  ;[[code]]=await conn.query('SELECT * FROM trace_code WHERE id=? FOR UPDATE',[created.insertId])
 }
 const [[detail]]=await conn.query('SELECT * FROM production_task_code WHERE code_id=? AND task_id=? FOR UPDATE',[code.id,task.id])
 if(detail?.state==='used')return Number(code.batch_id)===Number(run.batch_id)?{result:'duplicate',reason:'此码已在本批采集，不重复计数'}:{result:'exception',reason:'此码已用于其他生产批次，不能覆盖原资料'}
 if(code.status!==1||code.abnormal_flag!==0||code.batch_id||code.bound_at||code.produce_date||code.expire_date||code.batch_no||code.quality_cert_no||code.qc_result!==null)return {result:'exception',reason:'此码已有生产资料或处于异常状态，不能覆盖'}
 const [[owner]]=await conn.query('SELECT * FROM production_code_reservation WHERE code_id=?',[code.id])
 if(owner&&(owner.owner_kind!=='legacy'||Number(owner.owner_id)!==Number(task.id)))return {result:'exception',reason:'此码已被其他任务或旧设备码池占用'}
 if(event.kind!=='valid')return {result:'exception',reason:'本机判定为异常，原文保留'}
 if(!code.upload_batch_id){const root=await collectionRoot(conn,run,product,batch,context,s.user_id);await conn.execute('UPDATE trace_code SET upload_batch_id=?,uploaded_at=NOW() WHERE id=?',[root,code.id])}
 if(!detail)await conn.execute('INSERT INTO production_task_code(task_id,code_id,active_code_id,code) VALUES(?,?,?,?)',[task.id,code.id,code.id,code.code])
 await bind(conn,{...task,product_id:run.product_id},batch,detail||{code_id:code.id,active_code_id:code.id,state:'reserved'},Number(s.user_id),device.name||'')
 return {result:'saved',reason:''}
}
