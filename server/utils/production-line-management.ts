import {createHash,randomUUID} from 'node:crypto'
import type {AuthUser} from './auth'
import {query} from './db'
import {transaction,productionReviewer} from './production-task'
import {lineName,monitorSummary,taskMonitorRows} from './production-monitor'
import {emptyLineDraftSql} from './production-line-draft'
const fail=(message:string,statusCode=409):never=>{throw createError({statusCode,statusMessage:message})}
const keyOf=(name:string)=>createHash('sha256').update(lineName(name).toLowerCase()).digest('hex')
const scope=(user:AuthUser,enterpriseId:number)=>{if(user.role!=='platform_admin'&&enterpriseId!==Number(user.enterprise_id))fail('生产线不存在或不属于本企业',404)}
export async function productionLineOptions(user:AuthUser){
 const args=user.role==='platform_admin'?[]:[user.enterprise_id]
 const enterprises=await query<any[]>('SELECT id,name,status FROM enterprise'+(args.length?' WHERE id=?':'')+' ORDER BY name,id',args)
 const supervisors=await query<any[]>("SELECT DISTINCT enterprise_id,supervisor_name AS name FROM production_line_runtime WHERE supervisor_name<>'' AND deleted_at IS NULL"+(args.length?' AND enterprise_id=?':'')+' ORDER BY supervisor_name',args)
 return {enterprises,supervisors}
}
/** 产线是长期档案，任务是一次生产。空产线也能显示，添加产线不预建任务。 */
export async function productionLineOverview(user:AuthUser,q:any={}){
 const args=user.role==='platform_admin'?[]:[user.enterprise_id],condition=args.length?' WHERE enterprise_id=?':''
 const registered=await query<any[]>('SELECT * FROM production_line_runtime'+condition,args)
 const archived=new Set(registered.filter(r=>r.deleted_at).map(r=>Number(r.enterprise_id)+':'+r.line_key))
 const tasks=(await query<any[]>(`SELECT t.id,t.enterprise_id,t.line_name,t.status,(${emptyLineDraftSql}) AS empty_draft FROM production_task t WHERE t.status<>'deleted' AND t.line_name<>''`+(args.length?' AND t.enterprise_id=?':''),args)).filter(t=>!archived.has(Number(t.enterprise_id)+':'+keyOf(t.line_name)))
 const enterprises=await query<any[]>('SELECT id,name FROM enterprise'+(args.length?' WHERE id=?':''),args)
 const rows=new Map<string,any>()
 const rowFor=(enterpriseId:number,name:string)=>{
  const lineKey=keyOf(name),id=enterpriseId+':'+lineKey
  if(!rows.has(id))rows.set(id,{id,enterprise_id:enterpriseId,enterprise_name:enterprises.find(e=>Number(e.id)===enterpriseId)?.name||'-',line_key:lineKey,line_name:lineName(name),supervisor_name:'',taskCount:0,activeTaskCount:0,draftTaskCount:0,unfinishedTaskCount:0,collected:0,internal_count:0,external_count:0,duplicates:0,exceptions:0,products:[],latestHeartbeat:null,taskIds:[],activeTaskIds:[]})
  return rows.get(id)
 }
 for(const line of registered.filter(r=>!r.deleted_at))Object.assign(rowFor(Number(line.enterprise_id),line.line_name),{supervisor_name:line.supervisor_name||'',created_at:line.created_at})
 for(const t of tasks){const row=rowFor(Number(t.enterprise_id),t.line_name);row.taskCount++;row.taskIds.push(Number(t.id));if(Number(t.empty_draft))row.draftTaskCount++;else if(!['completed','approved'].includes(t.status))row.unfinishedTaskCount++;if(t.status==='active'){row.activeTaskCount++;row.activeTaskIds.push(Number(t.id))}}
 const taskIds=tasks.map(t=>Number(t.id)),activeIds=tasks.filter(t=>t.status==='active').map(t=>Number(t.id))
 const monitors=await taskMonitorRows(activeIds,false)
 const counts=taskIds.length?await query<any[]>(`SELECT t.id AS task_id,
  (SELECT COUNT(*) FROM production_task_code c WHERE c.task_id=t.id AND c.state='used') AS internal_count,
  SUM(e.result_state='saved' AND e.classification='external') AS external_count,
  SUM(e.result_state='duplicate') AS duplicates,SUM(e.result_state='exception') AS exceptions
  FROM production_task t LEFT JOIN worker_run r ON r.task_id=t.id LEFT JOIN worker_session s ON s.run_id=r.id LEFT JOIN worker_event e ON e.session_id=s.id
  WHERE t.id IN (?) GROUP BY t.id`,[taskIds]):[]
 const products=activeIds.length?await query<any[]>("SELECT DISTINCT r.task_id,p.name FROM worker_run r JOIN product p ON p.id=r.product_id WHERE r.task_id IN (?) AND r.state<>'sealed'",[activeIds]):[]
 for(const row of rows.values()){
  const live=monitors.filter(m=>row.activeTaskIds.includes(Number(m.task_id)))
  Object.assign(row,monitorSummary(live))
  for(const c of counts.filter(c=>row.taskIds.includes(Number(c.task_id))))for(const field of ['internal_count','external_count','duplicates','exceptions'])row[field]+=Number(c[field]||0)
  row.collected=row.internal_count+row.external_count
  row.products=[...new Set(products.filter(p=>row.activeTaskIds.includes(Number(p.task_id))).map(p=>p.name))].join(' / ')||'-'
  row.latestHeartbeat=live.reduce((n,m)=>Math.max(n,Number(m.heartbeat_ms||0)),0)||null
  row.status=row.runningDevices?'running':row.pausedDevices?'paused':row.pendingDevices?'pending':row.offlineDevices?'offline':'idle'
  row.canRename=row.taskCount===0
  row.can_delete=productionReviewer(user)&&row.unfinishedTaskCount===0
 }
 const summary=monitorSummary(monitors),keyword=String(q.keyword||'').trim().toLowerCase()
 const filtered=[...rows.values()].filter(r=>(!q.enterpriseId||Number(q.enterpriseId)===r.enterprise_id)&&(!q.lineName||r.line_name===q.lineName)&&(!q.supervisorName||r.supervisor_name===q.supervisorName)&&(!q.status||q.status==='all'||r.status===q.status)&&(!keyword||[r.enterprise_name,r.line_name,r.supervisor_name,r.products].some(v=>String(v).toLowerCase().includes(keyword)))).sort((a,b)=>a.enterprise_name.localeCompare(b.enterprise_name,'zh-CN')||a.line_name.localeCompare(b.line_name,'zh-CN'))
 const page=Math.max(1,Number(q.page)||1),pageSize=20
 return {rows:filtered.slice((page-1)*pageSize,page*pageSize).map(({taskIds,activeTaskIds,localValid,localDuplicates,localExceptions,...r})=>r),total:filtered.length,page,pageSize,summary:{runningDevices:summary.runningDevices,pausedDevices:summary.pausedDevices,offlineDevices:summary.offlineDevices,pendingDevices:summary.pendingDevices},lines:[...new Set([...rows.values()].map(r=>r.line_name))]}
}
export async function saveProductionLine(user:AuthUser,body:any,editing=false){
 if(!productionReviewer(user))fail('仅总部管理员或厂家管理员可管理生产线',403)
 const enterpriseId=user.role==='platform_admin'?Number(body.enterpriseId):Number(user.enterprise_id),name=lineName(body.lineName),supervisor=String(body.supervisorName||'').normalize('NFKC').trim()
 scope(user,Number(body.enterpriseId||enterpriseId))
 if(!Number.isSafeInteger(enterpriseId)||enterpriseId<=0||!name||name.length>100||supervisor.length>100)fail('请选择厂家并填写1至100字的生产线名称，负责人最多100字',400)
 const key=keyOf(name),originalKey=editing?String(body.lineKey||''):key
 if(editing&&!/^[a-f0-9]{64}$/.test(originalKey))fail('生产线标识无效',400)
 return transaction(async conn=>{
  const [[enterprise]]=await conn.query<any[]>('SELECT id,status FROM enterprise WHERE id=? FOR UPDATE',[enterpriseId]);if(!enterprise||enterprise.status!==1)fail('厂家不存在或已停用',400)
  const [[old]]=await conn.query<any[]>('SELECT * FROM production_line_runtime WHERE enterprise_id=? AND line_key=? FOR UPDATE',[enterpriseId,originalKey])
  if(!editing&&old&&!old.deleted_at)fail('此厂家已存在同名生产线')
  if(editing&&old?.deleted_at)fail('生产线已删除，请重新添加后再编辑',404)
  if(editing&&!old){
   const [historical]=await conn.query<any[]>("SELECT line_name FROM production_task WHERE enterprise_id=? AND line_name<>'' AND status<>'deleted'",[enterpriseId])
   if(!historical.some(t=>keyOf(t.line_name)===originalKey))fail('生产线不存在',404)
   if(originalKey!==key)fail('已有生产记录的生产线须保留原名称，可以修改负责人')
  }
  if(editing&&originalKey!==key){
   const [[used]]=await conn.query<any[]>('SELECT COUNT(*) AS n FROM production_task WHERE enterprise_id=? AND line_name=?',[enterpriseId,old.line_name])
   if(Number(used.n)||old.current_task_id)fail('已有生产记录的生产线须保留原名称，可以修改负责人')
  }
  const [[duplicate]]=await conn.query<any[]>('SELECT line_key,deleted_at FROM production_line_runtime WHERE enterprise_id=? AND line_key=?',[enterpriseId,key]);if(duplicate&&(!editing||originalKey!==key)&&!duplicate.deleted_at)fail('此厂家已存在同名生产线')
  if(editing&&originalKey!==key&&duplicate)fail('该名称有历史产线档案，请重新添加该产线，不能用改名覆盖')
  // 与列表可见范围一致：仅删除任务留下的名字不占用新产线，历史资料仍保留。
  if(!editing&&!old?.deleted_at){const [history]=await conn.query<any[]>("SELECT line_name FROM production_task WHERE enterprise_id=? AND status<>'deleted'",[enterpriseId]);if(history.some(t=>keyOf(t.line_name)===key))fail('此厂家已存在同名生产线，请编辑现有生产线')}
  if(old)await conn.execute('UPDATE production_line_runtime SET line_key=?,line_name=?,supervisor_name=?,deleted_at=NULL,deleted_by=NULL WHERE enterprise_id=? AND line_key=?',[key,name,supervisor,enterpriseId,originalKey])
  else await conn.execute('INSERT INTO production_line_runtime(enterprise_id,line_key,line_name,supervisor_name) VALUES(?,?,?,?)',[enterpriseId,key,name,supervisor])
  await conn.execute('INSERT INTO operation_log(enterprise_id,user_id,module,action,content,result) VALUES(?,?,?,?,?,1)',[enterpriseId,user.id,'生产线管理',editing?'修改':'新增',JSON.stringify({before:old?{lineName:old.line_name,supervisorName:old.supervisor_name||''}:null,after:{lineName:name,supervisorName:supervisor}})])
  return {ok:true,lineKey:key}
 })
}
/** 软删除长期档案，不删除或改变任何任务、采集、绑定或码占用。整批校验和审计共事务。 */
export async function deleteProductionLines(user:AuthUser,body:any){
 if(!productionReviewer(user))fail('仅总部管理员或厂家管理员可删除生产线',403)
 const raw=Array.isArray(body?.lines)?body.lines:[body]
 if(!raw.length||raw.length>100)fail('请选择1至100条生产线',400)
 const selected=new Map<string,{enterpriseId:number,lineKey:string}>()
 for(const item of raw){const enterpriseId=Number(item?.enterpriseId),lineKey=String(item?.lineKey||'');if(!Number.isSafeInteger(enterpriseId)||enterpriseId<=0||!/^[0-9a-f]{64}$/.test(lineKey))fail('生产线标识无效',400);scope(user,enterpriseId);selected.set(enterpriseId+':'+lineKey,{enterpriseId,lineKey})}
 const targets=[...selected.values()].sort((a,b)=>a.enterpriseId-b.enterpriseId||a.lineKey.localeCompare(b.lineKey))
 return transaction(async conn=>{
  for(const id of [...new Set(targets.map(t=>t.enterpriseId))]){const [[enterprise]]=await conn.query<any[]>('SELECT id FROM enterprise WHERE id=? FOR UPDATE',[id]);if(!enterprise)fail('厂家不存在',404)}
  const candidates=[];let duplicateCount=0
  for(const target of targets){
   const {enterpriseId,lineKey}=target
   let [[line]]=await conn.query<any[]>('SELECT * FROM production_line_runtime WHERE enterprise_id=? AND line_key=? FOR UPDATE',[enterpriseId,lineKey])
   if(line?.deleted_at){duplicateCount++;continue}
   const [history]=await conn.query<any[]>('SELECT id,line_name,status FROM production_task WHERE enterprise_id=? AND line_name<>\'\'',[enterpriseId])
   const tasks=history.filter(t=>keyOf(t.line_name)===lineKey)
   if(!line){const legacy=tasks.find(t=>t.status!=='deleted');if(!legacy)fail('生产线不存在或已不在列表中',404);await conn.execute('INSERT INTO production_line_runtime(enterprise_id,line_key,line_name) VALUES(?,?,?)',[enterpriseId,lineKey,lineName(legacy.line_name)]);[[line]]=await conn.query<any[]>('SELECT * FROM production_line_runtime WHERE enterprise_id=? AND line_key=? FOR UPDATE',[enterpriseId,lineKey])}
   const ids=tasks.map(t=>Number(t.id))
   const [locked]=ids.length?await conn.query<any[]>(`SELECT t.id,t.status,(${emptyLineDraftSql}) AS empty_draft FROM production_task t WHERE t.id IN (?) ORDER BY t.id FOR UPDATE`,[ids]):[[]]
   if(locked.some(t=>!['completed','approved','deleted'].includes(t.status)&&!Number(t.empty_draft)))fail('生产线“'+line.line_name+'”有已开工或已领码的未结束任务，请先结束采集并完整上传')
   if(ids.length){const [[runs]]=await conn.query<any[]>("SELECT COUNT(*) AS n FROM worker_run r WHERE r.task_id IN (?) AND (r.state<>'sealed' OR EXISTS(SELECT 1 FROM worker_session s WHERE s.run_id=r.id AND (s.state<>'completed' OR s.final_sequence IS NULL OR s.final_sequence<>s.last_sequence)))",[ids]);const [[legacy]]=await conn.query<any[]>("SELECT COUNT(*) AS n FROM production_collection_session WHERE task_id IN (?) AND state<>'completed'",[ids]);const [[uploads]]=await conn.query<any[]>("SELECT COUNT(*) AS n FROM production_collection_upload WHERE task_id IN (?) AND state<>'completed'",[ids]);if(Number(runs.n)||Number(legacy.n)||Number(uploads.n))fail('生产线“'+line.line_name+'”还有设备未结束或记录待同步，不能删除')}
   candidates.push({target,line,drafts:locked.filter(t=>Number(t.empty_draft)).map(t=>Number(t.id))})
  }
  let draftTasksDeletedCount=0
  for(const {target,line,drafts} of candidates){
   for(const taskId of drafts){await conn.execute("UPDATE production_task SET status='deleted' WHERE id=? AND status='active'",[taskId]);const detail=JSON.stringify({reason:'删除产线时同步清理未开工空任务',lineKey:target.lineKey,historyPreserved:true});await conn.execute("INSERT INTO production_task_change(task_id,actor_id,action,request_id,request_hash,detail) VALUES(?,?,'delete',?,?,?)",[taskId,user.id,randomUUID(),createHash('sha256').update(detail).digest('hex'),detail]);draftTasksDeletedCount++}
   await conn.execute('UPDATE production_line_runtime SET deleted_at=NOW(3),deleted_by=?,current_task_id=NULL WHERE enterprise_id=? AND line_key=?',[user.id,target.enterpriseId,target.lineKey]);await conn.execute('INSERT INTO operation_log(enterprise_id,user_id,module,action,content,result) VALUES(?,?,?,?,?,1)',[target.enterpriseId,user.id,'生产线管理','删除',JSON.stringify({lineName:line.line_name,lineKey:target.lineKey,supervisorName:line.supervisor_name||'',emptyDraftTasks:drafts,historyPreserved:true})])
  }
  return {ok:true,deletedCount:candidates.length,duplicateCount,draftTasksDeletedCount}
 })
}
