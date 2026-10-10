import { createHash } from 'node:crypto'
import { getHeader } from 'h3'
import type { PoolConnection } from 'mysql2/promise'
import type { AuthUser } from './auth'
import { query } from './db'
export const deviceHash = (value: string) => createHash('sha256').update(value).digest('hex')
export const deviceFail = (message: string, statusCode = 409): never => { throw createError({ statusCode, statusMessage: message }) }
export async function requireProductionDevice(event: any): Promise<AuthUser> {
  const token = String(getHeader(event, 'authorization') || '').replace(/^Bearer /, '')
  if (!/^[a-f0-9]{64}$/.test(token)) deviceFail('设备尚未激活，请联系管理员', 401)
  const [row] = await query<any[]>('SELECT d.*,e.name AS enterprise_name,e.status AS enterprise_status,e.renew_expire,CURDATE() AS today FROM production_device d JOIN enterprise e ON e.id=d.enterprise_id WHERE d.credential_hash=?', [deviceHash(token)])
  if (!row || row.deleted_at) deviceFail('设备凭证失效，请联系管理员重新激活', 401)
  if (row.status !== 'enabled') deviceFail('设备已停用，请联系管理员；本机记录仍保留', 403)
  if (Number(row.enterprise_status) !== 1 || !row.renew_expire || String(row.renew_expire).slice(0,10) < String(row.today).slice(0,10)) deviceFail('所属企业已停用或已到期', 403)
  await query('UPDATE production_device SET last_seen_at=NOW() WHERE id=?', [row.id])
  // 设备是独立采集主体，不冒用登记管理员的账号或会话。
  return { id: 0, enterprise_id: Number(row.enterprise_id), username: 'device:'+row.id, name: row.name, phone: null, role: 'code_admin', status: 1,
    device_id: Number(row.id), device_line: row.line_name, device_hash: row.credential_hash, enterprise_name: row.enterprise_name }
}
/** 所有设备生产写入先锁设备，停用和改派与扫码提交串行。 */
export async function lockProductionDevice(conn: PoolConnection, user: AuthUser) {
  if (!user.device_id) return
  const [[row]] = await conn.query<any[]>('SELECT * FROM production_device WHERE id=? FOR UPDATE', [user.device_id])
  if (!row || row.deleted_at || row.status !== 'enabled' || row.credential_hash !== user.device_hash) deviceFail('设备已停用或凭证失效，本机记录仍保留', 403)
  if (Number(row.enterprise_id) !== Number(user.enterprise_id) || row.line_name !== user.device_line) deviceFail('设备归属已变更，请刷新设备信息', 403)
}
export async function assertDeviceTask(conn: any, user: AuthUser, task: any) {
  if (!user.device_id || task.line_name === user.device_line) return
  // 任务改名/调线不能改变此前已经缓存的采集快照；只允许原设备排空原会话。
  const [[prior]] = await conn.query('SELECT id FROM production_collection_session WHERE task_id=? AND device_id=? LIMIT 1', [task.id, user.device_id])
  if (!prior) deviceFail('任务不属于本设备生产线', 403)
}
