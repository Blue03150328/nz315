import type { PoolConnection } from 'mysql2/promise'
/** 调用者先锁产品及码；新任务与旧写入口共用产品锁，不能绕过领用。 */
export async function assertNoProductionReservation(conn: PoolConnection, ids: number[]) {
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000)
    if (!chunk.length) continue
    const [rows] = await conn.query<any[]>('SELECT task_id FROM production_task_code WHERE active_code_id IN (' + chunk.map(() => '?').join(',') + ') LIMIT 1', chunk)
    if (rows.length) throw createError({ statusCode: 409, statusMessage: '所选码已领用或已用于生产任务，请从生产任务管理处理，不能修改、重绑或删除' })
  }
}
