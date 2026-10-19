import { appendWorkerActions } from './worker-records'
import { isCaptureRole } from './capture-role'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AuthUser } from './auth'
import { query } from './db'
import { offlineExportKey } from './line-production'
import { openWorkerSession, syncWorkerEvents, finishWorkerSession, finishWorkerRun } from './worker-production'
const fail=(message:string,statusCode=400):never=>{throw createError({statusCode,statusMessage:message})}
export async function importLineRecords(user:AuthUser,body:any){
 const content=String(body.content||'').replace(/^\uFEFF/,'')
 if(Buffer.byteLength(content)>20*1024*1024)fail('生产记录文件超过20MB，请分批导出')
 const lines=content.split(/\r?\n/).filter(s=>s.trim())
 if(lines.shift()!=='NZ315-PRODUCTION-RECORDS/1'||!lines.length||lines.length>1000)fail('请选择扫描仪导出的完整生产记录TXT；简版码清单不包含追责资料')
 const verified:any[]=[];let count=0
 // 全文件预检签名与归属后才开始写入。上传者不能伪造员工ID或设备身份。
 for(const line of lines){
  let envelope:any,data:any
  try{envelope=JSON.parse(line);if(typeof envelope.payload!=='string'||typeof envelope.signature!=='string'||envelope.payload.length>20*1024*1024)throw Error();data=JSON.parse(envelope.payload)}catch{fail('生产记录格式损坏，请重新导出')}
  const [g]=await query<any[]>('SELECT g.*,u.status AS user_status,u.role AS user_role,u.session_epoch AS current_version,u.enterprise_id AS current_enterprise FROM worker_grant g JOIN user u ON u.id=g.user_id WHERE g.id=?',[data.grantId])
  if(!g||(user.role!=='platform_admin'&&Number(user.enterprise_id)!==Number(g.enterprise_id)))fail('文件不属于本企业或工人授权不存在',403)
  const expected=createHmac('sha256',offlineExportKey(g.id)).update(envelope.payload).digest('hex')
  if(!/^[a-f0-9]{64}$/.test(envelope.signature)||!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(envelope.signature,'hex')))fail('生产记录签名不正确，文件可能被修改',403)
  if(!Array.isArray(data.events)||data.events.length>50000||data.run?.context?.lineWorkflow!==true)fail('不是新版生产扫码记录')
  count+=data.events.length;if(count>50000)fail('单文件最多50000条采集记录，请分批导出')
  const [d]=await query<any[]>('SELECT d.*,e.name AS enterprise_name FROM production_device d JOIN enterprise e ON e.id=d.enterprise_id WHERE d.id=?',[g.device_id])
  if(!d||Number(d.enterprise_id)!==Number(g.enterprise_id))fail('设备归属发生变化，文件须管理员核对',409)
  const device:AuthUser={id:0,enterprise_id:Number(g.enterprise_id),username:'device:'+d.id,name:d.name,phone:null,role:'code_admin',status:1,device_id:Number(d.id),device_line:d.line_name,device_hash:d.credential_hash,enterprise_name:d.enterprise_name}
  g.changed=Number(g.user_status)!==1||!isCaptureRole(g.user_role)||Number(g.current_version)!==Number(g.user_version)||Number(g.current_enterprise)!==Number(g.enterprise_id)
  verified.push({data,g,device})
 }
 const preview={ok:true,sessions:verified.length,records:count,workers:[...new Set(verified.map(v=>JSON.parse(typeof v.g.identity_json==='string'?v.g.identity_json:JSON.stringify(v.g.identity_json)).name))]}
 if(body.preview===true)return preview
 let saved=0,duplicates=0,exceptions=0
 for(const {data,g,device} of verified){
  await openWorkerSession(device,{runId:data.run.id,sessionId:data.sessionId,context:data.run.context,startedAt:data.startedAt},g)
  for(let i=0;i<data.events.length;i+=20){const result=await syncWorkerEvents(device,data.sessionId,{events:data.events.slice(i,i+20)});for(const receipt of result.receipts){if(receipt.state==='saved')saved++;else if(receipt.state==='duplicate')duplicates++;else exceptions++}}
  if(data.actions!==undefined){if(!Array.isArray(data.actions)||data.actions.length>50000)fail('操作记录格式无效');for(let i=0;i<data.actions.length;i+=20)await appendWorkerActions(device,data.sessionId,{actions:data.actions.slice(i,i+20)})}
  if(data.finalSequence!=null)await finishWorkerSession(device,data.sessionId,{lastSequence:data.finalSequence,...(data.actions?.length?{lastActionSequence:data.actions.length}:{}),...(data.stoppedAt?{stoppedAt:data.stoppedAt}:{})})
  if(data.run.sealed&&Array.isArray(data.run.sessions)){
   // 交班文件可以分次导入，完整本机结束清单持久保存；尚缺其他工人文件时不结算。
   await query('UPDATE worker_run SET file_end_sessions=? WHERE id=?',[JSON.stringify(data.run.sessions),data.run.id])
  }
  await query("INSERT INTO worker_audit(enterprise_id,actor_id,device_id,run_id,action,detail) VALUES(?,?,?,?,'offline_import',?)",[g.enterprise_id,user.id,device.device_id,data.run.id,JSON.stringify({sessionId:data.sessionId,fileName:String(body.fileName||'').slice(0,255),records:data.events.length})])
 }
 for(const {device} of verified){
  const runs=await query<any[]>("SELECT id,file_end_sessions FROM worker_run WHERE device_id=? AND state='active' AND file_end_sessions IS NOT NULL",[device.device_id])
  for(const run of runs){try{await finishWorkerRun(device,run.id,{sessions:typeof run.file_end_sessions==='string'?JSON.parse(run.file_end_sessions):run.file_end_sessions})}catch(e:any){if(e.statusCode!==409)throw e}}
 }
 return {...preview,saved,duplicates,exceptions}
}
