import {createHash,randomUUID} from 'node:crypto'
import {query} from './db'
const fail=(message:string,statusCode=409):never=>{throw createError({statusCode,statusMessage:message})}
const json=(v:any)=>typeof v==='string'?JSON.parse(v):v
const sha=(v:any)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex')
export const lineName=(v:any)=>String(v||'').normalize('NFKC').trim().replace(/\s+/g,' ')
/** 和加入、心跳、结束共用锁序：设备→产品（需要时）→产线→任务→run/session。 */
export async function lockMonitoredTask(conn:any,id:number){
 await conn.query('SELECT line_key FROM production_line_runtime WHERE current_task_id=? FOR UPDATE',[id])
 const [[task]]=await conn.query('SELECT * FROM production_task WHERE id=? FOR UPDATE',[id]);return task
}
export async function resolveAutomaticTask(conn:any,device:any,body:any,context:any,g:any){
 const [[existing]]=await conn.query('SELECT * FROM worker_run WHERE id=?',[body.runId])
 if(existing){const old=json(existing.context_json);if(existing.device_id!==device.device_id||!old.autoLine||lineName(old.lineName).toLowerCase()!==lineName(context.lineName).toLowerCase()||(context.taskId&&context.taskId!==old.taskId))fail('原采集生产线或设备不一致');context.taskId=old.taskId;context.lineName=old.lineName;return}
 if(g.changed||Number(g.expires_at)<Date.now())fail('请联网重新登录后加入生产线',401)
 const name=lineName(context.lineName);if(!name||name.length>100)fail('生产线名称须为1至100字',400)
 const key=sha(name.toLowerCase())
 await conn.execute('INSERT IGNORE INTO production_line_runtime(enterprise_id,line_key,line_name) VALUES(?,?,?)',[device.enterprise_id,key,name])
 const [[line]]=await conn.query('SELECT * FROM production_line_runtime WHERE enterprise_id=? AND line_key=? FOR UPDATE',[device.enterprise_id,key])
 let [[task]]=await conn.query("SELECT * FROM production_task WHERE id=? AND enterprise_id=? AND workflow='line-team' AND product_id IS NULL AND source_upload_id IS NULL AND status='active' FOR UPDATE",[line.current_task_id,device.enterprise_id])
 if(!task){
  const [matches]=await conn.query("SELECT * FROM production_task WHERE enterprise_id=? AND line_name=? AND workflow='line-team' AND product_id IS NULL AND source_upload_id IS NULL AND status='active' ORDER BY id DESC LIMIT 2 FOR UPDATE",[device.enterprise_id,line.line_name])
  if(matches.length>1)fail('此生产线存在多个进行中任务，请管理员核对，避免归属错误')
  task=matches[0]
 }
 if(context.taskId&&context.taskId!==Number(task?.id))fail('所选任务已结束，请重新选择生产线')
 if(!task){
  const [[ent]]=await conn.query('SELECT status FROM enterprise WHERE id=?',[device.enterprise_id]);if(!ent||Number(ent.status)!==1)fail('厂家已停用',403)
  const requestHash=sha({line:line.line_name,runId:body.runId,userId:g.user_id})
  const [created]=await conn.execute("INSERT INTO production_task(enterprise_id,product_id,name,line_name,request_id,request_hash,created_by,workflow) VALUES(?,NULL,?,?,?,?,?,'line-team')",[device.enterprise_id,(line.line_name+' · '+new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})).slice(0,100),line.line_name,body.runId,requestHash,g.user_id])
  task={id:Number(created.insertId)}
  await conn.execute("INSERT INTO production_task_change(task_id,actor_id,action,request_id,request_hash,detail) VALUES(?,?,'auto_create',?,?,?)",[task.id,g.user_id,body.runId,requestHash,JSON.stringify({lineName:line.line_name,deviceId:device.device_id})])
 }
 await conn.execute('UPDATE production_line_runtime SET current_task_id=? WHERE enterprise_id=? AND line_key=?',[task.id,device.enterprise_id,key])
 context.taskId=Number(task.id);context.lineName=line.line_name
 await conn.execute('INSERT INTO production_task_member(task_id,user_id) VALUES(?,?) ON DUPLICATE KEY UPDATE removed_at=NULL',[task.id,g.user_id])
}
/** 已登记的所有run和完整结束序号都已确认才自动结束，心跳不能代替收据。 */
export async function completeMonitoredTask(conn:any,task:any,actorId:number){
 if(!task||task.workflow!=='line-team'||task.status!=='active')return false
 const [[count]]=await conn.query(`SELECT COUNT(*) AS total,SUM(r.state<>'sealed' OR NOT EXISTS(SELECT 1 FROM worker_session s WHERE s.run_id=r.id) OR EXISTS(SELECT 1 FROM worker_session s WHERE s.run_id=r.id AND (s.state<>'completed' OR s.final_sequence IS NULL OR s.final_sequence<>s.last_sequence))) AS pending FROM worker_run r WHERE r.task_id=?`,[task.id])
 const [[legacy]]=await conn.query("SELECT COUNT(*) AS n,SUM(state<>'completed') AS pending FROM production_collection_session WHERE task_id=?",[task.id])
 const [[uploads]]=await conn.query("SELECT COUNT(*) AS n FROM production_collection_upload WHERE task_id=? AND state<>'completed'",[task.id])
 if(!(Number(count.total)+Number(legacy.n))||Number(count.pending)||Number(legacy.pending)||Number(uploads.n))return false
 await conn.execute("UPDATE production_task SET status='completed',ended_at=NOW(3),records_confirmed_at=NOW(3),records_confirmed_by=? WHERE id=? AND status='active'",[actorId,task.id])
 await conn.execute('UPDATE production_line_runtime SET current_task_id=NULL WHERE current_task_id=?',[task.id])
 await conn.execute("INSERT INTO production_task_change(task_id,actor_id,action,request_id,request_hash,detail) VALUES(?,?,'auto_complete',?,?,?)",[task.id,actorId,randomUUID(),sha({taskId:task.id,total:Number(count.total)}),JSON.stringify({reason:'所有参与设备完整上传并结束',runs:Number(count.total)})]);return true
}
export async function taskMonitorRows(ids:number[],details=true){
 if(!ids.length)return []
 if(!details)return query<any[]>('SELECT r.task_id,r.device_id,r.state AS run_state,s.state,s.heartbeat_ms,s.capture_state,s.local_valid,s.local_duplicate,s.local_exception FROM worker_run r JOIN worker_session s ON s.run_id=r.id WHERE r.task_id IN (?)',[ids])
 return query<any[]>(`SELECT r.task_id,r.id AS run_id,r.device_id,r.product_id,r.state AS run_state,r.context_json,
  s.id AS session_id,s.user_id,s.identity_json,s.state,s.started_ms,s.stopped_ms,s.heartbeat_ms,s.capture_state,s.reported_sequence,s.local_valid,s.local_duplicate,s.local_exception,s.local_pending,
  d.name AS device_name,p.name AS product_name,p.trademark,p.content,p.dosage,ps.spec_name,p.registration_no,
  (SELECT COUNT(*) FROM worker_event e WHERE e.session_id=s.id AND (e.result_state='saved' OR e.resolution_state='bound')) AS cloud_valid,
  (SELECT COUNT(*) FROM worker_event e WHERE e.session_id=s.id AND (e.result_state='saved' OR e.resolution_state='bound') AND (e.classification='internal' OR e.classification IS NULL)) AS internal_count,
  (SELECT COUNT(*) FROM worker_event e WHERE e.session_id=s.id AND e.result_state='saved' AND e.classification='external') AS external_count,
  (SELECT COUNT(*) FROM worker_event e WHERE e.session_id=s.id AND e.result_state='duplicate') AS cloud_duplicate,
  (SELECT COUNT(*) FROM worker_event e WHERE e.session_id=s.id AND e.result_state='exception') AS cloud_exception
  FROM worker_run r JOIN worker_session s ON s.run_id=r.id JOIN production_device d ON d.id=r.device_id
  LEFT JOIN product p ON p.id=r.product_id LEFT JOIN product_spec ps ON ps.id=p.spec_id WHERE r.task_id IN (?) ORDER BY s.started_ms,s.id`,[ids])
}
export function monitorSummary(rows:any[],now=Date.now()){
 const devices=new Map<number,any[]>();for(const r of rows){const list=devices.get(Number(r.device_id))||[];list.push(r);devices.set(Number(r.device_id),list)}
 const result={participatingDevices:devices.size,runningDevices:0,pausedDevices:0,offlineDevices:0,pendingDevices:0,endedDevices:0,localValid:rows.some(r=>r.local_valid!=null)?rows.reduce((sum,r)=>sum+Number(r.local_valid||0),0):null,localDuplicates:rows.some(r=>r.local_duplicate!=null)?rows.reduce((sum,r)=>sum+Number(r.local_duplicate||0),0):null,localExceptions:rows.some(r=>r.local_exception!=null)?rows.reduce((sum,r)=>sum+Number(r.local_exception||0),0):null}
 for(const sessions of devices.values()){
  const unfinished=sessions.filter(s=>s.run_state!=='sealed'||s.state!=='completed')
  if(!unfinished.length){result.endedDevices++;continue}
  const fresh=unfinished.filter(s=>s.heartbeat_ms&&now-Number(s.heartbeat_ms)<90000&&s.state!=='completed')
  if(fresh.some(s=>s.capture_state==='running'))result.runningDevices++
  else if(fresh.some(s=>s.capture_state==='paused'))result.pausedDevices++
  else if(fresh.some(s=>s.capture_state==='ended')||unfinished.every(s=>s.state==='completed'))result.pendingDevices++
  else result.offlineDevices++
 }
 return result
}
