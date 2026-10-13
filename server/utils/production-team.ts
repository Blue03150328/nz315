import {createHash,randomUUID} from 'node:crypto'
import type {AuthUser} from './auth'
import {query} from './db'
import {transaction,productionReviewer} from './production-task'
import {recordProductionAllocation} from './production-allocation'
import {assertNoProductionReservation} from './production-reservation'
import {headOf} from './code-head'
const fail=(message:string,statusCode=409):never=>{throw createError({statusCode,statusMessage:message})}
export function teamScope(user:AuthUser,row:any){if(!row||(user.role!=='platform_admin'&&Number(user.enterprise_id)!==Number(row.enterprise_id)))fail('记录不存在或不属于本企业',404)}
async function members(conn:any,user:AuthUser,enterpriseId:number,ids:any){
 if(!Array.isArray(ids)||!ids.length||ids.length>500)fail('请至少选择一名生产操作员',400)
 const selected=[...new Set(ids.map(Number))];if(selected.some(n=>!Number.isSafeInteger(n)||n<=0))fail('人员选择无效',400)
 const [rows]=await conn.query('SELECT id FROM user WHERE id IN (?) AND enterprise_id=? AND role=\'production_operator\' AND status=1 FOR UPDATE',[selected,enterpriseId])
 if(rows.length!==selected.length)fail('只能选择本厂启用的生产操作员',400)
 return selected
}
export async function teamOptions(user:AuthUser,keyword=''){
 const condition=user.role==='platform_admin'?'':' AND u.enterprise_id=?',args:any[]=user.role==='platform_admin'?[]:[user.enterprise_id]
 const uploads=await query<any[]>(`SELECT u.id,u.file_name,u.product_id,u.enterprise_id,p.name AS product_name,en.name AS enterprise_name,COUNT(*) AS total FROM upload_batch u JOIN trace_code c ON c.upload_batch_id=u.id JOIN product p ON p.id=u.product_id JOIN enterprise en ON en.id=u.enterprise_id LEFT JOIN production_code_reservation r ON r.code_id=c.id WHERE p.status=1${condition} AND (u.file_name LIKE ? OR p.name LIKE ?) GROUP BY u.id,u.file_name,u.product_id,u.enterprise_id,p.name,en.name HAVING SUM(c.status<>1 OR c.abnormal_flag<>0 OR c.batch_id IS NOT NULL OR c.bound_at IS NOT NULL OR c.produce_date IS NOT NULL OR c.expire_date IS NOT NULL OR c.qc_result IS NOT NULL OR c.quality_cert_no IS NOT NULL OR c.batch_no IS NOT NULL OR r.code_id IS NOT NULL)=0 ORDER BY u.id DESC LIMIT 200`,[...args,'%'+keyword+'%','%'+keyword+'%'])
 const operators=await query<any[]>(`SELECT u.id,u.name,u.username,u.enterprise_id,e.name AS enterprise_name FROM user u JOIN enterprise e ON e.id=u.enterprise_id WHERE u.role='production_operator' AND u.status=1${condition} ORDER BY u.name,u.id`,args)
 const lines=await query<any[]>(`SELECT DISTINCT line_name FROM production_task WHERE status<>'deleted' AND line_name<>''${user.role==='platform_admin'?'':' AND enterprise_id=?'} ORDER BY line_name`,args)
 return {uploads,operators,lines:lines.map(l=>l.line_name)}
}
export async function createTeamTask(user:AuthUser,body:any){
 if(!productionReviewer(user))fail('仅管理员可创建生产线任务和安排人员',403)
 const name=String(body.name||'').trim(),lineName=String(body.lineName||'').trim(),sourceId=Number(body.sourceUploadBatchId),requestId=String(body.requestId||'')
 if(!name||name.length>100||!lineName||lineName.length>100||!Number.isSafeInteger(sourceId)||sourceId<=0||!/^[-a-f0-9]{36}$/i.test(requestId))fail('请填写任务名称、生产线并选择入库文件',400)
 const hash=createHash('sha256').update(JSON.stringify({name,lineName,sourceId,operatorIds:[...new Set((body.operatorIds||[]).map(Number))].sort()})).digest('hex')
 return transaction(async conn=>{
  const [[prior]]=await conn.query<any[]>('SELECT id,request_hash FROM production_task WHERE created_by=? AND request_id=?',[user.id,requestId]);if(prior){if(prior.request_hash!==hash)fail('同一提交标识内容发生变化');return {ok:true,id:prior.id,duplicate:true}}
  const [[upload]]=await conn.query<any[]>('SELECT * FROM upload_batch WHERE id=?',[sourceId]);teamScope(user,upload)
  const [[p]]=await conn.query<any[]>('SELECT p.*,s.spec_code FROM product p LEFT JOIN product_spec s ON s.id=p.spec_id WHERE p.id=? FOR UPDATE',[upload.product_id]);teamScope(user,p)
  if(Number(p.status)!==1)fail('产品已停用')
  const ids=await members(conn,user,p.enterprise_id,body.operatorIds)
  const [codes]=await conn.query<any[]>('SELECT * FROM trace_code WHERE upload_batch_id=? ORDER BY id LIMIT 100001 FOR UPDATE',[sourceId])
  if(!codes.length||codes.length>100000)fail('入库文件必须包含1至100000个码')
  if(!p.spec_code||codes.some(c=>Number(c.product_id)!==Number(p.id)||Number(c.enterprise_id)!==Number(p.enterprise_id)||Number(c.status)!==1||Number(c.abnormal_flag)!==0||c.batch_id||c.bound_at||c.produce_date||c.expire_date||c.qc_result!==null||c.quality_cert_no||c.batch_no||!String(c.code).startsWith(headOf(p))))fail('文件含已生产、异常或其他产品的码，不能覆盖生产资料')
  await assertNoProductionReservation(conn,codes.map(c=>Number(c.id)))
  const [r]:any=await conn.execute("INSERT INTO production_task(enterprise_id,product_id,batch_id,name,line_name,request_id,request_hash,created_by,workflow,source_upload_id) VALUES(?,?,NULL,?,?,?,?,?,'line-team',?)",[p.enterprise_id,p.id,name,lineName,requestId,hash,user.id,sourceId])
  const [change]:any=await conn.execute("INSERT INTO production_task_change(task_id,actor_id,action,request_id,request_hash,detail) VALUES(?,?,'create',?,?,?)",[r.insertId,user.id,requestId,hash,JSON.stringify({sourceUploadId:sourceId,total:codes.length,operatorIds:ids})])
  await recordProductionAllocation(conn,r.insertId,codes,change.insertId,null)
  for(const id of ids)await conn.execute('INSERT INTO production_task_member(task_id,user_id) VALUES(?,?)',[r.insertId,id])
  return {ok:true,id:r.insertId,total:codes.length}
 })
}
export async function teamTasks(user:AuthUser,q:any={}){
 const page=Math.max(1,Number(q.page)||1),size=20,conds:string[]=["t.status<>'deleted'"],args:any[]=[]
 if(user.role!=='platform_admin'){conds.push('t.enterprise_id=?');args.push(user.enterprise_id)}
 if(q.keyword){conds.push("(t.name LIKE ? OR t.line_name LIKE ? OR u.file_name LIKE ? OR p.name LIKE ? OR p.registration_no LIKE ? OR EXISTS(SELECT 1 FROM production_task_member m JOIN user op ON op.id=m.user_id WHERE m.task_id=t.id AND (op.name LIKE ? OR op.username LIKE ?)))");args.push(...Array(7).fill('%'+String(q.keyword).trim()+'%'))}
 if(q.lineName){conds.push('t.line_name=?');args.push(String(q.lineName))}
 if(q.status==='history')conds.push("t.workflow<>'line-team'")
 else if(q.status&&q.status!=='all'){conds.push("t.workflow='line-team' AND t.status=?");args.push(String(q.status))}
 if(q.operatorId){conds.push('EXISTS(SELECT 1 FROM production_task_member m WHERE m.task_id=t.id AND m.user_id=? AND m.removed_at IS NULL)');args.push(Number(q.operatorId))}
 if(q.dateFrom){const time=Date.parse(String(q.dateFrom)+'T00:00:00+08:00');if(!Number.isFinite(time))fail('查询开始日期无效',400);conds.push('UNIX_TIMESTAMP(t.created_at)>=?');args.push(time/1000)}
 if(q.dateTo){const time=Date.parse(String(q.dateTo)+'T00:00:00+08:00');if(!Number.isFinite(time))fail('查询结束日期无效',400);conds.push('UNIX_TIMESTAMP(t.created_at)<?');args.push(time/1000+86400)}
 const where=conds.length?' WHERE '+conds.join(' AND '):''
 const [count]=await query<any[]>('SELECT COUNT(*) AS n FROM production_task t LEFT JOIN product p ON p.id=t.product_id LEFT JOIN upload_batch u ON u.id=t.source_upload_id'+where,args)
 const rows=await query<any[]>(`SELECT t.*,p.name AS product_name,p.registration_no,spec.spec_name AS product_spec_name,u.file_name,(SELECT COUNT(*) FROM production_task_code d WHERE d.task_id=t.id) AS total,(SELECT COUNT(*) FROM production_task_code d WHERE d.task_id=t.id AND d.state='used') AS collected,(SELECT COUNT(*) FROM worker_event e JOIN worker_session s ON s.id=e.session_id JOIN worker_run r ON r.id=s.run_id WHERE r.task_id=t.id AND e.result_state='duplicate') AS duplicates,(SELECT COUNT(*) FROM worker_event e JOIN worker_session s ON s.id=e.session_id JOIN worker_run r ON r.id=s.run_id WHERE r.task_id=t.id AND e.result_state='exception') AS exceptions,(SELECT MIN(s.started_at) FROM worker_session s JOIN worker_run r ON r.id=s.run_id WHERE r.task_id=t.id) AS started_at,(SELECT MAX(s.stopped_at) FROM worker_session s JOIN worker_run r ON r.id=s.run_id WHERE r.task_id=t.id) AS stopped_at,(SELECT MIN(s.started_ms) FROM worker_session s JOIN worker_run r ON r.id=s.run_id WHERE r.task_id=t.id) AS started_ms,(SELECT MAX(s.stopped_ms) FROM worker_session s JOIN worker_run r ON r.id=s.run_id WHERE r.task_id=t.id) AS stopped_ms,(SELECT COUNT(*) FROM worker_session s JOIN worker_run r ON r.id=s.run_id WHERE r.task_id=t.id AND s.state<>'completed') AS active_sessions FROM production_task t LEFT JOIN product p ON p.id=t.product_id LEFT JOIN product_spec spec ON spec.id=p.spec_id LEFT JOIN upload_batch u ON u.id=t.source_upload_id${where} ORDER BY t.id DESC LIMIT ? OFFSET ?`,[...args,size,(page-1)*size])
 if(rows.length){const ids=rows.map(t=>t.id),people=await query<any[]>('SELECT m.task_id,m.user_id,m.removed_at,op.name,op.username FROM production_task_member m JOIN user op ON op.id=m.user_id WHERE m.task_id IN (?) ORDER BY op.name',[ids]),counts=await query<any[]>("SELECT r.task_id,s.user_id,SUM(e.result_state='saved' OR e.resolution_state='bound') AS collected,SUM(e.result_state='duplicate') AS duplicates,SUM(e.result_state='exception') AS exceptions,MIN(s.started_at) AS started_at,MAX(s.stopped_at) AS stopped_at,MIN(s.started_ms) AS started_ms,MAX(s.stopped_ms) AS stopped_ms,COUNT(DISTINCT CASE WHEN s.state<>'completed' THEN s.id END) AS active_sessions FROM worker_run r JOIN worker_session s ON s.run_id=r.id LEFT JOIN worker_event e ON e.session_id=s.id WHERE r.task_id IN (?) GROUP BY r.task_id,s.user_id",[ids]);for(const row of rows)row.operators=people.filter(p=>Number(p.task_id)===Number(row.id)).map(p=>({...p,...counts.find(c=>Number(c.task_id)===Number(p.task_id)&&Number(c.user_id)===Number(p.user_id))}))}
 return {rows:rows.map(t=>({...t,can_delete:productionReviewer(user)&&['completed','approved'].includes(t.status)&&!!t.ended_at&&Number(t.active_sessions)===0})),total:Number(count.n),page,pageSize:size}
}
export async function updateTeamTask(user:AuthUser,id:number,body:any){
 if(!productionReviewer(user))fail('仅管理员可编辑或结束生产线任务',403)
 return transaction(async conn=>{
  const [[seed]]=await conn.query<any[]>('SELECT * FROM production_task WHERE id=?',[id]);teamScope(user,seed)
  await conn.query('SELECT id FROM product WHERE id=? FOR UPDATE',[seed.product_id])
  const [[task]]=await conn.query<any[]>('SELECT * FROM production_task WHERE id=? FOR UPDATE',[id]);if(task.workflow!=='line-team')fail('历史任务仅查看，新流程请新建任务')
  if(task.status==='deleted')fail('任务已删除，采集历史仍保留',404)
  const action=String(body.action||'edit')
  if(action==='complete'){
   if(task.status==='completed')return {ok:true,id,duplicate:true}
   const [[pending]]=await conn.query<any[]>("SELECT COUNT(*) AS n FROM worker_run r WHERE r.task_id=? AND (r.state<>'sealed' OR EXISTS(SELECT 1 FROM worker_session s WHERE s.run_id=r.id AND (s.state<>'completed' OR s.final_sequence<>s.last_sequence)))",[id])
   if(Number(pending.n))fail('还有工人或设备未结束采集、未上传完整记录和结束标记')
   if(body.recordsComplete!==true)fail('请确认所有参与工人和设备的线上或TXT记录已经收齐')
   await conn.execute("UPDATE production_task SET status='completed',ended_at=NOW(),records_confirmed_at=NOW(),records_confirmed_by=? WHERE id=?",[user.id,id])
  }else if(action==='edit'){
   if(task.status==='completed')fail('任务已结束，不能更改人员安排')
   const name=String(body.name||task.name).trim(),line=String(body.lineName||task.line_name).trim();if(!name||name.length>100||!line||line.length>100)fail('任务名称和生产线必须为1至100字',400)
   const ids=await members(conn,user,task.enterprise_id,body.operatorIds)
   await conn.execute('UPDATE production_task SET name=?,line_name=? WHERE id=?',[name,line,id])
   await conn.query('UPDATE production_task_member SET removed_at=NOW(3) WHERE task_id=? AND user_id NOT IN (?) AND removed_at IS NULL',[id,ids])
   for(const worker of ids)await conn.execute('INSERT INTO production_task_member(task_id,user_id) VALUES(?,?) ON DUPLICATE KEY UPDATE removed_at=NULL',[id,worker])
  }else fail('操作无效',400)
  await conn.execute("INSERT INTO production_task_change(task_id,actor_id,action,request_id,request_hash,detail) VALUES(?,?,?,?,?,?)",[id,user.id,action,randomUUID(),createHash('sha256').update(JSON.stringify(body)).digest('hex'),JSON.stringify(body)])
  return {ok:true,id}
 })
}
