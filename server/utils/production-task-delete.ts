import {lockMonitoredTask} from './production-monitor'
import { createHash, randomUUID } from 'node:crypto'
import type { AuthUser } from './auth'
import { productionReviewer, transaction } from './production-task'

const fail = (message: string, statusCode = 409): never => { throw createError({ statusCode, statusMessage: message }) }

/** 仅移除已结束任务的列表入口，码占用、生产资料及采集收据始终保留。 */
export async function deleteProductionTasks(user: AuthUser, input: unknown) {
  if (!productionReviewer(user)) fail('仅总部管理员或厂家管理员可删除生产任务', 403)
  if (!Array.isArray(input) || !input.length || input.length > 100 || input.some(id => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)) {
    fail('请选择1至100个有效的生产任务', 400)
  }
  const ids = [...new Set(input as number[])].sort((a, b) => a - b)
  return transaction(async conn => {
    const [seeds] = await conn.query<any[]>('SELECT id,enterprise_id,product_id FROM production_task WHERE id IN (?) ORDER BY id', [ids])
    const inScope = (rows: any[]) => rows.length === ids.length && rows.every(t => user.role === 'platform_admin' || Number(t.enterprise_id) === Number(user.enterprise_id))
    if (!inScope(seeds)) fail('所选任务不存在或不属于本企业', 404)
    // 与开工、扫码、结束任务共用产品→任务锁；多选固定加锁顺序，整批原子处理。
    for (const productId of [...new Set(seeds.map(t => Number(t.product_id)))].sort((a, b) => a - b)) {
      await conn.query('SELECT id FROM product WHERE id=? FOR UPDATE', [productId])
    }
    for(const seed of seeds)await lockMonitoredTask(conn,Number(seed.id))
    const [tasks] = await conn.query<any[]>('SELECT * FROM production_task WHERE id IN (?) ORDER BY id FOR UPDATE', [ids])
    if (!inScope(tasks)) fail('所选任务不存在或不属于本企业', 404)
    const targets = tasks.filter(t => t.status !== 'deleted')
    for (const task of targets) {
      const [[usage]]=await conn.query<any[]>('SELECT (SELECT COUNT(*) FROM worker_run WHERE task_id=?)+(SELECT COUNT(*) FROM production_collection_session WHERE task_id=?)+(SELECT COUNT(*) FROM production_task_code WHERE task_id=?)+(SELECT COUNT(*) FROM production_collection_upload WHERE task_id=?) AS n',[task.id,task.id,task.id,task.id]);const empty=task.status==='active'&&!Number(usage.n)
      if (!empty&&(!['completed', 'approved'].includes(task.status) || !task.ended_at || (task.workflow === 'line-team' && !task.records_confirmed_at))) {
        fail(`任务“${task.name}”尚未结束或记录未确认收齐，请等待设备完整结束并同步`)
      }
      const [[pending]] = await conn.query<any[]>(`SELECT
        (SELECT COUNT(*) FROM worker_run r WHERE r.task_id=? AND (r.state<>'sealed' OR EXISTS(
          SELECT 1 FROM worker_session s WHERE s.run_id=r.id AND
          (s.state<>'completed' OR s.final_sequence IS NULL OR s.final_sequence<>s.last_sequence))))
        + (SELECT COUNT(*) FROM production_collection_session s WHERE s.task_id=? AND s.state<>'completed') AS n`, [task.id, task.id])
      if (Number(pending.n)) fail(`任务“${task.name}”还有未结束或未同步完整的采集记录，不能删除`)
    }
    const requestId = randomUUID(), requestHash = createHash('sha256').update(JSON.stringify(ids)).digest('hex')
    for (const task of targets) {
      await conn.execute("INSERT INTO production_task_change(task_id,actor_id,action,request_id,request_hash,detail) VALUES(?,?,'delete',?,?,?)", [task.id, user.id, requestId, requestHash, JSON.stringify({ name: task.name, lineName: task.line_name, previousStatus: task.status, selectedIds: ids, historyPreserved: true })])
      await conn.execute("UPDATE production_task SET status='deleted' WHERE id=?", [task.id]);await conn.execute('UPDATE production_line_runtime SET current_task_id=NULL WHERE current_task_id=?',[task.id])
    }
    return { ok: true, deletedCount: targets.length, deletedIds: targets.map(t => Number(t.id)), alreadyDeletedIds: tasks.filter(t => t.status === 'deleted').map(t => Number(t.id)) }
  })
}
