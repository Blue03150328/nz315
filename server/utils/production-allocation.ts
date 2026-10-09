import type { PoolConnection } from 'mysql2/promise'
import { productionAllocationInput } from '../../shared/utils/production-allocation-input'
import { assertCodesCorrectable } from './binding-guard'
import { assertNoProductionReservation } from './production-reservation'
import { headOf } from './code-head'

// 列表计数和实际领取共用可领用口径；公众查询次数不参与判断。
export const freeProductionCode = `a.active_code_id IS NULL AND c.status=1 AND c.abnormal_flag=0 AND c.batch_id IS NULL
  AND c.bound_at IS NULL AND c.produce_date IS NULL AND c.expire_date IS NULL AND c.qc_result IS NULL AND c.quality_cert_no IS NULL AND c.batch_no IS NULL`
const fail = (message: string, statusCode = 409): never => { throw createError({ statusCode, statusMessage: message }) }
export async function selectProductionAllocation(conn: PoolConnection, product: any, body: Record<string, any>) {
  let input: ReturnType<typeof productionAllocationInput>
  try { input = productionAllocationInput(body) } catch (e) { fail((e as Error).message, 400) }
  const rows: any[] = []
  if (input!.sourceTaskId || input!.sourceUploadBatchId) {
    let where: string
    let params: any[]
    if (input!.sourceTaskId) {
      const [[source]] = await conn.query<any[]>('SELECT * FROM production_task WHERE id=? AND product_id=? AND enterprise_id=? FOR UPDATE', [input!.sourceTaskId, product.id, product.enterprise_id])
      if (!source) fail('来源任务不存在或与当前产品、企业不一致', 404)
      if (source.status !== 'approved') fail('来源任务剩余码尚未审核放行')
      where = "EXISTS (SELECT 1 FROM production_task_code d WHERE d.task_id=? AND d.code_id=c.id AND d.state='released')"
      params = [input!.sourceTaskId]
    } else {
      const [[upload]] = await conn.query<any[]>('SELECT id FROM upload_batch WHERE id=? AND product_id=? AND enterprise_id=?', [input!.sourceUploadBatchId, product.id, product.enterprise_id])
      if (!upload) fail('来源码文件不存在或与当前产品、企业不一致', 404)
      where = 'c.upload_batch_id=?'
      params = [input!.sourceUploadBatchId]
    }
    const [selected] = await conn.query<any[]>(`SELECT c.* FROM trace_code c LEFT JOIN production_task_code a ON a.active_code_id=c.id
      WHERE c.product_id=? AND c.enterprise_id=? AND ${where} AND ${freeProductionCode} ORDER BY c.id LIMIT ? FOR UPDATE`, [product.id, product.enterprise_id, ...params!, input!.quantity])
    if (selected.length !== input!.quantity) fail('当前可领用码不足，可能已被其他任务领取，请刷新数量后重试')
    rows.push(...selected)
  } else {
    for (let i = 0; i < input!.codes.length; i += 1000) {
      const chunk = input!.codes.slice(i, i + 1000)
      const [selected] = await conn.query<any[]>('SELECT * FROM trace_code WHERE code IN (' + chunk.map(() => '?').join(',') + ') ORDER BY id FOR UPDATE', chunk)
      rows.push(...selected)
    }
    if (rows.length !== input!.codes.length) fail('领用清单含不存在的追溯码', 400)
  }
  if (rows.some(c => Number(c.enterprise_id) !== Number(product.enterprise_id) || Number(c.product_id) !== Number(product.id))) fail('领用清单含其他企业或产品的码', 400)
  assertCodesCorrectable(rows)
  if (!product.spec_code || rows.some(c => !String(c.code).startsWith(headOf(product)))) fail('领用码前11位与当前产品规格或生产类型不一致', 400)
  if (rows.some(c => Number(c.status) !== 1 || c.batch_id || c.bound_at || c.produce_date || c.expire_date || c.quality_cert_no || c.batch_no || c.qc_result !== null)) fail('只能领取尚未生产且没有生产资料的码，已生产码不能再次领取', 400)
  await assertNoProductionReservation(conn, rows.map(c => Number(c.id)))
  return { rows, sourceTaskId: input!.sourceTaskId || null }
}
export async function recordProductionAllocation(conn: PoolConnection, taskId: number, rows: any[], allocationId: number, sourceTaskId: number | null) {
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000)
    await conn.query('INSERT INTO production_task_code (task_id,code_id,active_code_id,code,source_task_id,allocation_id) VALUES ' + chunk.map(() => '(?,?,?,?,?,?)').join(','), chunk.flatMap(c => [taskId, c.id, c.id, c.code, sourceTaskId, allocationId]))
  }
}
export async function productionUsage(conn: any, taskIds: number[]) {
  if (!taskIds.length) return new Map<number, any>()
  const [rows] = await conn.query(`SELECT d.task_id,COUNT(*) AS total,SUM(d.state='used') AS used_count,
    SUM(d.state='reserved') AS reserved_count,SUM(d.state='pending') AS pending_count,
    SUM(d.state='released' AND (${freeProductionCode})) AS available_count,
    SUM(d.state='released' AND a.task_id IS NOT NULL AND a.task_id<>d.task_id) AS transferred_count,
    SUM(d.state='released' AND a.state='used' AND a.task_id<>d.task_id) AS transferred_used_count
    FROM production_task_code d JOIN trace_code c ON c.id=d.code_id LEFT JOIN production_task_code a ON a.active_code_id=c.id
    WHERE d.task_id IN (${taskIds.map(() => '?').join(',')}) GROUP BY d.task_id`, taskIds)
  return new Map<number, any>(rows.map((r: any) => [Number(r.task_id), Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]))]))
}
