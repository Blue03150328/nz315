// 一次完成上传为固定更正范围，不更改任务、共享业务批次、原采集资料或收据。
import { createHash } from 'node:crypto'
import type { AuthUser } from './auth'
import { query } from './db'
import { transaction, lockedTask } from './production-task'
import { productionRequestId } from '../../shared/utils/production-task-input'
import { effectiveProduction } from '../../shared/utils/production-info'
import { productionPatch } from './production-patch'
import { isInputDate } from '../../shared/utils/input-date'
import { requireUsageBatchSchema } from './usage-batch-schema'
import { resolveCodeScope, codeScopeSql } from './code-scope'
import { refreshUploadSnapshots } from './upload-snapshot'
import { uploadCorrectionBlock } from './upload-correction-rules'

const fail=(message:string,statusCode=409):never=>{throw createError({statusCode,statusMessage:message})}
const json=(value:any)=>typeof value==='string'?JSON.parse(value):value
const hash=(value:any)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const productionColumns=['batch_no','produce_date','expire_date','qc_result','quality_cert_no']
const uploadSql=`SELECT cb.*,ub.enterprise_id,ub.file_name,u.state AS upload_state,u.source_kind,u.session_id,u.worker_session_id,
 t.name AS task_name,t.created_by AS task_created_by,t.status AS task_status,t.ended_at,ls.state AS legacy_session_state,
 ws.state AS worker_session_state,ws.last_sequence,ws.final_sequence,wr.state AS run_state
 FROM code_usage_batch cb JOIN upload_batch ub ON ub.id=cb.parent_upload_batch_id
 JOIN production_collection_upload u ON u.id=cb.upload_id JOIN production_task t ON t.id=cb.task_id
 LEFT JOIN production_collection_session ls ON ls.id=u.session_id LEFT JOIN worker_session ws ON ws.id=u.worker_session_id
 LEFT JOIN worker_run wr ON wr.id=ws.run_id WHERE cb.id=?`
function codesSql(scope:any){const selected=codeScopeSql(scope,'c');return {sql:`SELECT c.*,b.batch_no AS shared_batch_no,b.produce_date AS shared_produce_date,b.expire_date AS shared_expire_date,b.qc_result AS shared_qc_result,b.quality_cert_no AS shared_quality_cert_no FROM trace_code c LEFT JOIN batch b ON b.id=c.batch_id WHERE ${selected.sql} ORDER BY c.id`,values:selected.values}}
function actualProduction(code:any){const p=effectiveProduction(code,{batch_no:code.shared_batch_no,produce_date:code.shared_produce_date,expire_date:code.shared_expire_date,qc_result:code.shared_qc_result,quality_cert_no:code.shared_quality_cert_no});return {batch_no:p.batchNo,produce_date:p.produceDate,expire_date:p.expireDate,qc_result:p.qcResult==='合格'?1:p.qcResult==='不合格'?0:null,quality_cert_no:p.qualityCertNo}}
function consensus(codes:any[]){const production:any={},mixedFields:string[]=[];for(const column of productionColumns){const values=[...new Set(codes.map(c=>JSON.stringify(actualProduction(c)[column as keyof ReturnType<typeof actualProduction>])))];production[column]=values.length===1?JSON.parse(values[0]!):null;if(values.length>1)mixedFields.push(column)}return {...production,mixed_fields:mixedFields}}
function revision(upload:any,codes:any[]){return hash({id:Number(upload.id),root:Number(upload.parent_upload_batch_id),uploadId:upload.upload_id,codes:codes.map(c=>({id:Number(c.id),productId:Number(c.product_id),batchId:c.batch_id,status:c.status,abnormal:c.abnormal_flag,raw:Object.fromEntries(productionColumns.map(k=>[k,c[k]])),effective:actualProduction(c)}))})}
function block(user:AuthUser,upload:any,codes:any[]){return uploadCorrectionBlock(user,{...upload,code_total:codes.length,frozen_count:codes.filter(c=>Number(c.abnormal_flag)===1).length,voided_count:codes.filter(c=>Number(c.abnormal_flag)===2).length})}

export async function usageBatchCorrectionPreview(user:AuthUser,childId:number){
 const {scope}=await resolveCodeScope(user,{usageBatchId:childId}),[upload]=await query<any[]>(uploadSql,[childId]);if(!upload)fail('上传记录不存在',404)
 const selected=codesSql(scope),codes=await query<any[]>(selected.sql,selected.values),reason=block(user,upload,codes)
 return {task:{id:Number(upload.task_id),name:upload.task_name},usageBatchId:childId,uploadId:upload.upload_id,totalCodes:codes.length,usedCodes:codes.length,rootCount:1,
  roots:[{id:Number(upload.parent_upload_batch_id),fileName:upload.file_name,count:codes.length,usedCount:codes.length}],production:consensus(codes),previewHash:revision(upload,codes),canCorrect:!reason,reason}
}

export async function correctUsageBatchProduction(user:AuthUser,childId:number,body:any){
 await requireUsageBatchSchema();const {row,scope}=await resolveCodeScope(user,{usageBatchId:childId});let requestId:string,fields:Record<string,string|number>
 try{requestId=productionRequestId(body);fields=productionPatch(body)}catch(error){fail((error as Error).message,400)}
 if(body.batchNo!==undefined&&body.batchNo!==''){const value=String(body.batchNo).trim();if(!value||value.length>64)fail('生产批号须为1至64字',400);fields!.batch_no=value}
 if(String(fields!.quality_cert_no||'').length>64)fail('质量合格证号不能超过64字',400)
 const reason=String(body.reason||'').trim();if(reason.length>500)fail('修改备注不能超过500字',400)
 if(!Object.keys(fields!).length)fail('请至少选择一个需要更正的字段',400)
 if(!/^[a-f0-9]{64}$/.test(String(body.previewHash||'')))fail('请重新打开修正窗口并确认本次上传范围',400)
 const requestHash=hash({action:'correct_usage_batch',usageBatchId:childId,rootId:scope.uploadBatchId,fields:fields!,reason,previewHash:body.previewHash})
 return transaction(async conn=>{
  const selected=codesSql(scope),[seed]=await conn.query<any[]>(selected.sql,selected.values),productIds=[...new Set(seed.map(c=>Number(c.product_id)))].sort((a,b)=>a-b)
  if(productIds.length)await conn.query('SELECT id FROM product WHERE id IN ('+productIds.map(()=>'?').join(',')+') ORDER BY id FOR UPDATE',productIds)
  const task=await lockedTask(conn,user,Number(row.task_id));if(user.role==='viewer'||(Number(task.created_by)!==user.id&&!['platform_admin','enterprise_admin'].includes(user.role)))fail('仅管理员或任务创建人可修正本次上传',403)
  const [[prior]]=await conn.query<any[]>('SELECT request_hash,detail FROM production_task_change WHERE task_id=? AND actor_id=? AND request_id=?',[task.id,user.id,requestId!])
  if(prior){if(prior.request_hash!==requestHash)fail('相同提交标识不能用于另一上传记录或不同修改');return {...json(prior.detail).result,duplicate:true}}
  const [[upload]]=await conn.query<any[]>(uploadSql+' FOR UPDATE',[childId]);if(!upload||Number(upload.parent_upload_batch_id)!==scope.uploadBatchId||Number(upload.task_id)!==Number(task.id)||Number(upload.enterprise_id)!==Number(row.enterprise_id))fail('上传范围发生变化，请重新打开修正窗口')
  const [codes]=await conn.query<any[]>(selected.sql+' FOR UPDATE',selected.values),blocked=block(user,upload,codes);if(blocked)fail(blocked,400)
  if(revision(upload,codes)!==body.previewHash)fail('这次上传的资料或码清单已变化，请重新打开修正窗口')
  for(const code of codes){if(Number(code.enterprise_id)!==Number(upload.enterprise_id)||!productIds.includes(Number(code.product_id)))fail('码归属发生变化，请重新打开修正窗口');if(fields!.produce_date!==undefined||fields!.expire_date!==undefined){const after=actualProduction({...code,...fields!});if(!isInputDate(after.produce_date)||!isInputDate(after.expire_date)||after.expire_date<after.produce_date)fail('有效期不能早于所选码的生产日期，请核对日期',400)}}
  const groups=new Map<string,{before:any,effectiveBefore:any,codeIds:number[]}>();for(const code of codes){const before=Object.fromEntries(Object.keys(fields!).map(k=>[k,code[k]])),effectiveBefore=Object.fromEntries(Object.keys(fields!).map(k=>[k,actualProduction(code)[k as keyof ReturnType<typeof actualProduction>]])),key=JSON.stringify({before,effectiveBefore});if(!groups.has(key))groups.set(key,{before,effectiveBefore,codeIds:[]});groups.get(key)!.codeIds.push(Number(code.id))}
  const columns=Object.keys(fields!);for(let i=0;i<codes.length;i+=1000){const ids=codes.slice(i,i+1000).map(c=>Number(c.id));await conn.execute('UPDATE trace_code SET '+columns.map(k=>k+'=?').join(',')+' WHERE upload_batch_id=? AND usage_batch_id=? AND id IN ('+ids.map(()=>'?').join(',')+')',[...Object.values(fields!),scope.uploadBatchId!,childId,...ids])}
  const [updated]=await conn.query<any[]>(selected.sql,selected.values),snapshot=consensus(updated);await conn.execute('UPDATE code_usage_batch SET production_snapshot=? WHERE id=?',[JSON.stringify(snapshot),childId]);await refreshUploadSnapshots(conn,[scope.uploadBatchId!])
  const result={ok:true,usageBatchId:childId,uploadId:upload.upload_id,taskId:Number(task.id),rootCount:1,corrected:codes.length,fields:fields!,reason}
  await conn.execute('INSERT INTO production_task_change(task_id,actor_id,action,request_id,request_hash,detail) VALUES(?,?,?,?,?,?)',[task.id,user.id,'correct_usage_batch',requestId!,requestHash,JSON.stringify({scope:{usageBatchId:childId,uploadId:upload.upload_id,uploadBatchId:scope.uploadBatchId},reason,fields:fields!,beforeGroups:[...groups.values()],productionSnapshotBefore:json(upload.production_snapshot),productionSnapshotAfter:snapshot,previewHash:body.previewHash,result})])
  return {...result,duplicate:false}
 })
}
