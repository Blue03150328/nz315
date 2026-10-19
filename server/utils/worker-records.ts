import { createHash, createHmac } from 'node:crypto'
import type { AuthUser } from './auth'
import { query } from './db'
import { transaction } from './production-task'
import { lockProductionDevice } from './production-device-auth'
import { grantOf } from './worker-production'
import { collectionId } from '../../shared/utils/collection-input'
import { offlineExportKey } from './line-production'

const json = (v: any) => typeof v === 'string' ? JSON.parse(v) : v
const fail = (message: string, statusCode = 409): never => { throw createError({ statusCode, statusMessage: message }) }
const iso = (value: any) => value ? new Date(value).toISOString() : null
const pageOf = (n: any) => Math.max(1, Math.min(100000, Math.floor(Number(n) || 1)))

/** Actions have their own sequence; a pause never becomes a production scan. */
export async function appendWorkerActions(device: AuthUser, id: string, body: any) {
 collectionId(id)
 if (!Array.isArray(body.actions) || !body.actions.length || body.actions.length > 20) fail('每批操作须为1至20条', 400)
 return transaction(async conn => {
  await lockProductionDevice(conn, device)
  const [[s]] = await conn.query<any[]>('SELECT * FROM worker_session WHERE id=? AND device_id=? FOR UPDATE', [id, device.device_id])
  if (!s) fail('采集会话不存在', 404)
  const receipts = []
  for (const a of body.actions) {
   collectionId(a.eventId)
   if (!Number.isSafeInteger(a.sequence) || a.sequence < 1 || !['start','pause','resume','end'].includes(a.kind) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(a.capturedAt) || !Number.isFinite(Date.parse(a.capturedAt)) || Date.parse(a.capturedAt) > Date.now() + 60000) fail('操作记录格式无效', 400)
   const hash = createHash('sha256').update(JSON.stringify([a.eventId,a.sequence,a.kind,a.capturedAt])).digest('hex')
   const [[old]] = await conn.query<any[]>('SELECT * FROM worker_action WHERE id=? OR (session_id=? AND sequence_no=?)', [a.eventId,id,a.sequence])
   if (old) {
    if (old.session_id !== id || old.payload_hash !== hash) fail('操作记录重试内容不一致')
   } else {
    if (s.state === 'completed') fail('已完成会话不可追加操作')
    const [[last]] = await conn.query<any[]>('SELECT sequence_no,kind FROM worker_action WHERE session_id=? ORDER BY sequence_no DESC LIMIT 1', [id])
    if (a.sequence !== Number(last?.sequence_no || 0) + 1 || last?.kind === 'end') fail('操作序号不连续或采集已结束')
    if ((a.kind === 'start' && last) || (a.kind === 'resume' && last?.kind !== 'pause') || (a.kind === 'pause' && !['start','resume'].includes(last?.kind))) fail('操作状态转换无效')
    await conn.execute('INSERT INTO worker_action(id,session_id,sequence_no,kind,captured_at,payload_hash) VALUES(?,?,?,?,?,?)', [a.eventId,id,a.sequence,a.kind,new Date(a.capturedAt),hash])
   }
   receipts.push({eventId:a.eventId,sequence:a.sequence})
  }
  return {ok:true,sessionId:id,receipts}
 })
}

export async function requireLeader(device: AuthUser, token: string) {
 const g = await grantOf(device, token)
 if (g.user_role !== 'line_leader') fail('仅线长可查看本厂采集记录', 403)
 return g
}

const sums = `(SELECT COUNT(*) FROM worker_event e WHERE e.session_id=s.id) AS total,
 (SELECT COUNT(*) FROM worker_event e WHERE e.session_id=s.id AND e.result_state='saved') AS saved,
 (SELECT COUNT(*) FROM worker_event e WHERE e.session_id=s.id AND e.result_state='duplicate') AS duplicates,
 (SELECT COUNT(*) FROM worker_event e WHERE e.session_id=s.id AND e.result_state='exception') AS exceptions,
 (SELECT MIN(captured_at) FROM worker_event e WHERE e.session_id=s.id) AS first_scan,
 (SELECT MAX(captured_at) FROM worker_event e WHERE e.session_id=s.id) AS last_scan`
function record(s: any) {
 const product=json(s.product_snapshot||'{}'),context={productName:product.name||'',trademark:product.trademark||'',specName:product.specName||'',registrationNo:product.registrationNo||'',content:product.content||'',dosage:product.dosage||'',...json(s.effective_context||s.context_json)},identity=json(s.identity_json)
 return {id:s.id,runId:s.run_id,mode:s.mode,identity,context,device:json(s.device_snapshot || '{}'),state:s.state,
  startedAt:iso(s.started_at),stoppedAt:iso(s.stopped_at),uploadedAt:iso(s.completed_at),firstScan:iso(s.first_scan),lastScan:iso(s.last_scan),
  summary:{total:Number(s.total),collected:Number(s.saved),saved:Number(s.saved),waiting:0,duplicates:Number(s.duplicates),exceptions:Number(s.exceptions)},scope:'factory',cloud_done:s.state==='completed'}
}
export async function leaderRecords(device: AuthUser, body: any) {
 await requireLeader(device, String(body.grant || ''))
 const args:any[] = [device.enterprise_id], conds = ['r.enterprise_id=?']
 const kw = String(body.keyword || '').trim().slice(0,100)
 if (kw) {conds.push('(CAST(s.identity_json AS CHAR) LIKE ? OR CAST(r.context_json AS CHAR) LIKE ? OR CAST(r.effective_context AS CHAR) LIKE ? OR CAST(r.product_snapshot AS CHAR) LIKE ? OR s.id LIKE ?)');args.push(...Array(5).fill('%'+kw+'%'))}
 for (const [key, op] of [['from','>='],['to','<=']] as const) if(body[key]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body[key])) fail('日期无效',400)
  conds.push(`s.started_at ${op} ?`);args.push(body[key]+(key==='from'?' 00:00:00':' 23:59:59.999'))
 }
 const where=conds.join(' AND '), page=pageOf(body.page)
 const [count]=await query<any[]>(`SELECT COUNT(*) n FROM worker_session s JOIN worker_run r ON r.id=s.run_id WHERE ${where}`,args)
 const rows=await query<any[]>(`SELECT s.*,r.mode,r.context_json,r.effective_context,r.product_snapshot,r.device_snapshot,${sums} FROM worker_session s JOIN worker_run r ON r.id=s.run_id WHERE ${where} ORDER BY s.started_at DESC,s.id DESC LIMIT 30 OFFSET ?`,[...args,(page-1)*30])
 return {ok:true,rows:rows.map(record),total:Number(count.n),page,pageSize:30,scope:'factory'}
}
async function sessionFor(device:AuthUser,body:any) {
 const g=await requireLeader(device,String(body.grant||'')),id=collectionId(body.sessionId)
 const [s]=await query<any[]>(`SELECT s.*,r.mode,r.context_json,r.effective_context,r.product_snapshot,r.device_snapshot,r.state AS run_state,${sums} FROM worker_session s JOIN worker_run r ON r.id=s.run_id WHERE s.id=? AND r.enterprise_id=?`,[id,device.enterprise_id])
 if(!s)fail('记录不存在或不属于本厂',404)
 return {s,g}
}
export async function leaderRecordDetail(device:AuthUser,body:any) {
 const {s}=await sessionFor(device,body),page=pageOf(body.page),args:any[]=[s.id]
 const filter=['saved','duplicate','exception'].includes(body.result)?' AND result_state=?':''
 if(filter)args.push(body.result)
 const [count]=await query<any[]>(`SELECT COUNT(*) n FROM worker_event WHERE session_id=?${filter}`,args)
 const events=await query<any[]>(`SELECT id AS eventId,sequence_no AS sequence,code,raw_code AS rawCode,kind,result_state AS state,classification,reason,captured_at AS capturedAt,received_at AS receivedAt FROM worker_event WHERE session_id=?${filter} ORDER BY sequence_no LIMIT 100 OFFSET ?`,[...args,(page-1)*100])
 const actions=await query<any[]>('SELECT id AS eventId,sequence_no AS sequence,kind,captured_at AS capturedAt,received_at AS receivedAt FROM worker_action WHERE session_id=? ORDER BY sequence_no',[s.id])
 return {ok:true,record:record(s),events,actions,total:Number(count.n),page,pageSize:100,scope:'factory'}
}
/** Download contains original worker identity/signature, not the leader's identity. */
export async function leaderRecordExport(device:AuthUser,body:any) {
 const {s,g}=await sessionFor(device,body)
 const events=await query<any[]>('SELECT id AS eventId,sequence_no AS sequence,raw_code AS rawCode,code,kind,result_state AS resultState,captured_at AS capturedAt FROM worker_event WHERE session_id=? ORDER BY sequence_no LIMIT 50001',[s.id])
 if(events.length>50000)fail('单次导出最多50000条',400)
 let text:string
 if(s.mode==='external'){const unique=new Map<string,string>();for(const e of events)if(e.resultState==='saved'&&!unique.has(e.code||e.rawCode))unique.set(e.code||e.rawCode,e.rawCode);text=[...unique.values()].join('\r\n')+(unique.size?'\r\n':'')}
 else {
  const manifest=await query<any[]>('SELECT id,final_sequence AS lastSequence FROM worker_session WHERE run_id=? ORDER BY id',[s.run_id])
  const actions=await query<any[]>('SELECT id AS eventId,sequence_no AS sequence,kind,captured_at AS capturedAt FROM worker_action WHERE session_id=? ORDER BY sequence_no',[s.id])
  const payload=JSON.stringify({grantId:s.grant_id,sessionId:s.id,startedAt:iso(s.started_at),stoppedAt:iso(s.stopped_at),finalSequence:s.final_sequence,run:{id:s.run_id,context:json(s.context_json),sealed:s.run_state==='sealed',sessions:manifest},events:events.map(e=>({eventId:e.eventId,sequence:e.sequence,rawCode:e.rawCode,code:e.code,kind:e.kind,capturedAt:iso(e.capturedAt)})),actions:actions.map(a=>({...a,capturedAt:iso(a.capturedAt)}))})
  text='NZ315-PRODUCTION-RECORDS/1\n'+JSON.stringify({payload,signature:createHmac('sha256',offlineExportKey(s.grant_id)).update(payload).digest('hex')})+'\n'
 }
 if(Buffer.byteLength(text,'utf8')>20*1024*1024)fail('导出超过20MB，请分批处理',400)
 await query('INSERT INTO worker_audit(enterprise_id,actor_id,device_id,run_id,action,detail) VALUES(?,?,?,?,?,?)',[device.enterprise_id,g.user_id,device.device_id,s.run_id,'leader_export',JSON.stringify({sessionId:s.id,captureUserId:s.user_id,count:events.length})])
 return {ok:true,text,record:record(s),count:events.length}
}

