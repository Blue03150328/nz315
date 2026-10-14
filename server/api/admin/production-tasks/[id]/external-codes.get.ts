import { requireBackendUser } from '../../../../utils/auth'
import { query } from '../../../../utils/db'
import { teamScope } from '../../../../utils/production-team'

/** 同一生产任务下的外码明细，历史独立采集仍从历史入口查询。 */
export default defineEventHandler(async event => {
  const user = await requireBackendUser(event), id = Number(getRouterParam(event, 'id')), input = getQuery(event)
  const [task] = await query<any[]>('SELECT * FROM production_task WHERE id=?', [id])
  teamScope(user, task)
  const page = Math.max(1, Math.min(100000, Number(input.page) || 1)), keyword = String(input.keyword || '').trim().slice(0, 200)
  const where = "r.task_id=? AND e.classification='external' AND e.result_state='saved'" + (keyword ? " AND e.raw_code LIKE ? ESCAPE '!'" : '')
  const args: any[] = [id]
  if (keyword) args.push('%' + keyword.replace(/[!%_]/g, value => '!' + value) + '%')
  const joins = ' FROM worker_event e JOIN worker_session s ON s.id=e.session_id JOIN worker_run r ON r.id=s.run_id LEFT JOIN product p ON p.id=r.product_id'
  const [count] = await query<any[]>('SELECT COUNT(*) AS n' + joins + ' WHERE ' + where, args)
  const rows = await query<any[]>(`SELECT e.id,e.raw_code,p.name AS product_name,JSON_UNQUOTE(JSON_EXTRACT(r.context_json,'$.batchNo')) AS batch_no,JSON_UNQUOTE(JSON_EXTRACT(r.context_json,'$.produceDate')) AS produce_date,JSON_UNQUOTE(JSON_EXTRACT(s.identity_json,'$.name')) AS operator_name,JSON_UNQUOTE(JSON_EXTRACT(r.device_snapshot,'$.name')) AS device,e.captured_at,e.received_at${joins} WHERE ${where} ORDER BY e.received_at,e.id LIMIT 100 OFFSET ?`, [...args, (page - 1) * 100])
  return { rows, page, filteredTotal: Number(count.n) }
})
