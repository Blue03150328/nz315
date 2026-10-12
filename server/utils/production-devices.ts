import { randomBytes } from 'node:crypto'
import { getRequestURL, getHeader } from 'h3'
import type { AuthUser } from './auth'
import { getPool, query } from './db'
import { transaction } from './production-task'
import { deviceHash, deviceFail as fail } from './production-device-auth'
const publicColumns = 'd.id,d.enterprise_id,d.name,d.line_name,d.status,d.model,d.last_seen_at,d.last_sync_at,d.reported_pending,d.created_at,d.deleted_at'
export function activationServer(event: any) {
  const url=getRequestURL(event,{xForwardedProto:true,xForwardedHost:true})
  const origin=getHeader(event,'origin')
  if(origin){const parsed=new URL(origin);if(parsed.host===url.host)return parsed.origin}
  return process.env.NZ315_DEVICE_SERVER || url.origin
}
export function deviceManager(user: AuthUser) { if (!['enterprise_admin','platform_admin'].includes(user.role) || user.device_id) fail('仅厂家管理员和总部管理员可管理设备',403) }
function scope(user: AuthUser, row: any) { if (!row || (user.role !== 'platform_admin' && Number(row.enterprise_id) !== Number(user.enterprise_id))) fail('设备不存在或不属于本企业',404) }
const text = (value: any, label: string) => { if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) fail(label+'请填写1至100字',400); return value.trim() }
async function activeCount(conn: any, id: number) { const [[r]] = await conn.query("SELECT COUNT(*) AS n FROM production_collection_session WHERE device_id=? AND state='active'",[id]);return Number(r.n) }
async function audit(conn: any, id: number, actor: number | null, action: string, detail: any) { await conn.execute('INSERT INTO production_device_change(device_id,actor_id,action,detail) VALUES (?,?,?,?)',[id,actor,action,JSON.stringify(detail)]) }
export async function deviceOptions(user: AuthUser) {
  deviceManager(user)
  const where = user.role==='platform_admin'?'':' WHERE id=?', params=user.role==='platform_admin'?[]:[user.enterprise_id]
  const enterprises=await query<any[]>('SELECT id,name FROM enterprise'+where+' ORDER BY id',params)
  const cond=user.role==='platform_admin'?'':' AND enterprise_id=?'
  const lines=await query<any[]>(`SELECT DISTINCT enterprise_id,line_name FROM production_task WHERE line_name<>''${cond} UNION SELECT DISTINCT enterprise_id,line_name FROM production_device WHERE deleted_at IS NULL${cond} ORDER BY enterprise_id,line_name`,[...params,...params])
  return {enterprises,lines}
}
export async function listDevices(user: AuthUser) {
  deviceManager(user)
  const rows=await query<any[]>(`SELECT ${publicColumns},e.name AS enterprise_name,(SELECT COUNT(*) FROM production_collection_session s WHERE s.device_id=d.id AND s.state='active') AS active_sessions FROM production_device d JOIN enterprise e ON e.id=d.enterprise_id WHERE d.deleted_at IS NULL`+(user.role==='platform_admin'?'':' AND d.enterprise_id=?')+' ORDER BY d.id DESC LIMIT 500',user.role==='platform_admin'?[]:[user.enterprise_id])
  return {rows}
}
async function activation(conn: any,id: number,user: AuthUser,server: string) {
  // 更换激活码前必须先排空原设备，保留旧记录归属。
  if(await activeCount(conn,id))fail('设备有未结束采集，请先同步全部记录并结束本机采集；停用设备可先恢复启用')
  const [[row]]=await conn.query('SELECT * FROM production_device WHERE id=? FOR UPDATE',[id]);scope(user,row)
  if(row.deleted_at)fail('已删除设备不能激活，请新建登记')
  const token=randomBytes(32).toString('hex')
  await conn.execute('UPDATE production_device_activation SET revoked_at=NOW() WHERE device_id=? AND revoked_at IS NULL',[id])
  await conn.execute('INSERT INTO production_device_activation(device_id,token_hash,expires_at,created_by) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE),?)',[id,deviceHash(token),user.id])
  await conn.execute("UPDATE production_device SET status='pending',credential_hash=NULL,instance_id=NULL,reported_pending=NULL WHERE id=?",[id])
  await audit(conn,id,user.id,'activation',{})
  return {ok:true,id,activationCode:'NZ315-DEVICE:'+Buffer.from(JSON.stringify({v:1,server,token})).toString('base64url'),expiresIn:600}
}
export async function addDevice(user: AuthUser, body: any, server: string) {
  deviceManager(user)
  const enterpriseId=user.role==='platform_admin'?Number(body.enterpriseId):Number(user.enterprise_id)
  if(!Number.isSafeInteger(enterpriseId)||enterpriseId<=0)fail('请选择已入驻企业',400)
  const name=text(body.name,'设备名称'),line=text(body.lineName,'生产线')
  return transaction(async conn=>{
    const [[ent]]=await conn.query<any[]>('SELECT id,status FROM enterprise WHERE id=?',[enterpriseId]);if(!ent||Number(ent.status)!==1)fail('企业不存在或已停用',400)
    const [r]:any=await conn.execute('INSERT INTO production_device(enterprise_id,name,line_name,created_by) VALUES (?,?,?,?)',[enterpriseId,name,line,user.id])
    await audit(conn,r.insertId,user.id,'create',{enterpriseId,name,lineName:line})
    return activation(conn,Number(r.insertId),user,server)
  })
}
export async function changeDevice(user: AuthUser,id: number,body: any,server: string) {
  deviceManager(user)
  if(!Number.isSafeInteger(id)||id<=0)fail('设备编号无效',400)
  return transaction(async conn=>{
    const [[row]]=await conn.query<any[]>('SELECT * FROM production_device WHERE id=? FOR UPDATE',[id]);scope(user,row)
    if(row.deleted_at)fail('设备已删除')
    const action=String(body.action||'')
    if(action==='activate')return activation(conn,id,user,server)
    if(action==='edit'){
      const name=text(body.name,'设备名称'),line=text(body.lineName,'生产线'),enterpriseId=user.role==='platform_admin'?Number(body.enterpriseId):Number(user.enterprise_id)
      if(!Number.isSafeInteger(enterpriseId)||enterpriseId<=0)fail('所属企业无效',400)
      const changed=enterpriseId!==Number(row.enterprise_id)||line!==row.line_name
      if(changed&&await activeCount(conn,id))fail('有未结束采集，请同步并结束后再调换公司或生产线')
      const [[ent]]=await conn.query<any[]>('SELECT id,status FROM enterprise WHERE id=?',[enterpriseId]);if(!ent||Number(ent.status)!==1)fail('企业不存在或已停用',400)
      if(enterpriseId!==Number(row.enterprise_id)){
        await conn.execute("UPDATE production_device SET enterprise_id=?,name=?,line_name=?,status='pending',credential_hash=NULL,instance_id=NULL WHERE id=?",[enterpriseId,name,line,id])
        await conn.execute('UPDATE production_device_activation SET revoked_at=NOW() WHERE device_id=? AND revoked_at IS NULL',[id])
      }else await conn.execute('UPDATE production_device SET name=?,line_name=? WHERE id=?',[name,line,id])
      await audit(conn,id,user.id,action,{before:{enterpriseId:row.enterprise_id,name:row.name,lineName:row.line_name},after:{enterpriseId,name,lineName:line}})
    }else if(action==='disable'){
      await conn.execute("UPDATE production_device SET status='disabled' WHERE id=?",[id])
      await conn.execute('UPDATE production_device_activation SET revoked_at=NOW() WHERE device_id=? AND revoked_at IS NULL',[id])
      await audit(conn,id,user.id,action,{})
    }else if(action==='enable'){
      if(!row.credential_hash)fail('设备尚未激活，请生成激活二维码')
      await conn.execute("UPDATE production_device SET status='enabled' WHERE id=?",[id]);await audit(conn,id,user.id,action,{})
    }else if(action==='delete'){
      if(await activeCount(conn,id))fail('有未结束采集，请同步全部记录并结束后再删除')
      await conn.execute("UPDATE production_device SET status='deleted',deleted_at=NOW(),credential_hash=NULL,instance_id=NULL WHERE id=?",[id])
      await conn.execute('UPDATE production_device_activation SET revoked_at=NOW() WHERE device_id=? AND revoked_at IS NULL',[id])
      await audit(conn,id,user.id,action,{})
    }else fail('设备操作无效',400)
    return {ok:true,id}
  })
}
export async function activateDevice(body: any) {
  if(!/^[a-f0-9]{64}$/.test(body.token)||!/^[a-f0-9]{64}$/.test(body.credential)||!/^[a-f0-9-]{36}$/.test(body.instanceId))fail('激活资料无效',400)
  const model=text(body.model,'设备型号'),androidId=typeof body.androidId==='string'?body.androidId.slice(0,100):''
  return transaction(async conn=>{
    const [[seed]]=await conn.query<any[]>('SELECT device_id FROM production_device_activation WHERE token_hash=?',[deviceHash(body.token)]);if(!seed)fail('激活码不存在',400)
    const [[row]]=await conn.query<any[]>('SELECT * FROM production_device WHERE id=? FOR UPDATE',[seed.device_id])
    const [[a]]=await conn.query<any[]>('SELECT *,expires_at>NOW() AS unexpired FROM production_device_activation WHERE token_hash=? FOR UPDATE',[deviceHash(body.token)])
    const credentialHash=deviceHash(body.credential)
    if(!row||row.deleted_at||a.revoked_at||row.status==='disabled')fail('激活码已撤销或设备已停用',403)
    if(a.consumed_at){if(a.instance_id!==body.instanceId||a.credential_hash!==credentialHash||row.credential_hash!==credentialHash)fail('激活码已被使用',409);return {ok:true,deviceId:Number(row.id)}}
    if(!Number(a.unexpired))fail('激活码已过期，请管理员重新生成',400)
    const [[ent]]=await conn.query<any[]>('SELECT status,renew_expire,CURDATE() AS today FROM enterprise WHERE id=?',[row.enterprise_id])
    if(!ent||Number(ent.status)!==1||!ent.renew_expire||String(ent.renew_expire).slice(0,10)<String(ent.today).slice(0,10))fail('所属企业停用或已到期',403)
    const [[existing]]=await conn.query<any[]>('SELECT id FROM production_device WHERE instance_id=? AND id<>?',[body.instanceId,row.id]);if(existing)fail('本机已登记到另一台设备，请先处理原登记')
    await conn.execute("UPDATE production_device SET status='enabled',instance_id=?,credential_hash=?,model=?,android_id=?,last_seen_at=NOW() WHERE id=?",[body.instanceId,credentialHash,model,androidId,row.id])
    await conn.execute('UPDATE production_device_activation SET consumed_at=NOW(),instance_id=?,credential_hash=? WHERE id=?',[body.instanceId,credentialHash,a.id])
    await audit(conn,Number(row.id),null,'activated',{model,instanceId:body.instanceId})
    return {ok:true,deviceId:Number(row.id)}
  })
}
export async function deviceHistory(user: AuthUser,id: number) {
  deviceManager(user);const [row]=await query<any[]>('SELECT enterprise_id FROM production_device WHERE id=?',[id]);scope(user,row)
  const rows=await query<any[]>('SELECT c.id,c.action,c.detail,c.created_at,u.name AS actor_name FROM production_device_change c LEFT JOIN user u ON u.id=c.actor_id WHERE c.device_id=? ORDER BY c.id DESC LIMIT 100',[id]);return {rows}
}
export async function deviceContext(user: AuthUser,body?: any) {
  if(body){const n=Number(body.pending);if(Number.isSafeInteger(n)&&n>=0&&n<=10000000)await query('UPDATE production_device SET reported_pending=? WHERE id=?',[n,user.device_id])}
  const [device]=await query<any[]>(`SELECT ${publicColumns},e.name AS enterprise_name FROM production_device d JOIN enterprise e ON e.id=d.enterprise_id WHERE d.id=?`,[user.device_id])
  return {ok:true,device,user:{id:0,role:'code_admin',enterprise_id:user.enterprise_id,name:device.enterprise_name+' / '+device.line_name,device_id:user.device_id}}
}
