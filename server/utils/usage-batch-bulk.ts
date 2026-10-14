import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise'
import type { AuthUser } from './auth'
import { query } from './db'
import { transaction } from './production-task'
import { requireUsageBatchSchema } from './usage-batch-schema'
import { usageBatchFilter, usageFrom } from './usage-batch-list'

const fail = (statusMessage: string, statusCode = 400): never => { throw createError({ statusCode, statusMessage }) }
export function usageSelection(input: any) {
  if (input?.all === true) {
    if (input.ids?.length || !input.filters || typeof input.filters !== 'object' || Array.isArray(input.filters)) fail('全选范围无效')
    if (input.excludeIds !== undefined && (!Array.isArray(input.excludeIds) || input.excludeIds.some((id: unknown) => typeof id !== 'number' || !Number.isSafeInteger(id) || Number(id) <= 0))) fail('排除批次范围无效')
    return { all: true as const, filters: input.filters as Record<string, any>, excludeIds: [...new Set<number>(input.excludeIds || [])].sort((a, b) => a - b) }
  }
  if (!Array.isArray(input?.ids) || !input.ids.length || input.ids.some((id: unknown) => typeof id !== 'number' || !Number.isSafeInteger(id) || Number(id) <= 0)) fail('请选择有效的上传批次')
  return { all: false as const, ids: [...new Set<number>(input.ids)].sort((a, b) => a - b) }
}

async function selectedBatches(user: AuthUser, input: any, conn?: PoolConnection) {
  const selection = usageSelection(input)
  const filter = usageBatchFilter(user, selection.all ? selection.filters : {})
  let sql = filter.sql
  const params = [...filter.params]
  if (!selection.all) { sql += ` AND cb.id IN (${selection.ids.map(() => '?').join(',')})`; params.push(...selection.ids) }
  else if (selection.excludeIds.length) { sql += ` AND cb.id NOT IN (${selection.excludeIds.map(() => '?').join(',')})`; params.push(...selection.excludeIds) }
  const statement = `SELECT cb.id,cb.parent_upload_batch_id,ub.enterprise_id,COALESCE(cb.product_id,t.product_id) AS product_id,
    COUNT(c.id) AS total,COALESCE(SUM(c.abnormal_flag=0),0) AS normal,
    COALESCE(SUM(c.abnormal_flag=1),0) AS frozen,COALESCE(SUM(c.abnormal_flag=2),0) AS voided
    ${usageFrom} LEFT JOIN trace_code c ON c.usage_batch_id=cb.id AND c.upload_batch_id=cb.parent_upload_batch_id AND c.enterprise_id=ub.enterprise_id
    WHERE ${sql} GROUP BY cb.id,cb.parent_upload_batch_id,ub.enterprise_id,cb.product_id,t.product_id ORDER BY cb.id`
  const rows = conn ? (await conn.query<any[]>(statement, params))[0] : await query<any[]>(statement, params)
  if (!rows.length) fail('所选范围没有已完成的上传批次', 404)
  if (!selection.all && rows.length !== selection.ids.length) fail('所选批次不存在、尚未完成或不属于本企业', 404)
  const hash = createHash('sha256').update(JSON.stringify(rows.map(row => ['id', 'parent_upload_batch_id', 'enterprise_id', 'product_id', 'total', 'normal', 'frozen', 'voided'].map(key => Number(row[key]))))).digest('hex')
  return { rows, hash, selection: selection.all ? { ...selection, filters: filter.filters } : selection }
}

/** 预览回传范围指纹；提交时再次验证，查询结果变化不能扩大操作范围。 */
export async function previewUsageSelection(user: AuthUser, input: any) {
  await requireUsageBatchSchema()
  const selected = await selectedBatches(user, input)
  const sum = (key: string) => selected.rows.reduce((n, row) => n + Number(row[key]), 0)
  return { selection: selected.selection, previewHash: selected.hash, batchCount: selected.rows.length, codeTotal: sum('total'), normalCount: sum('normal'), frozenCount: sum('frozen'), voidedCount: sum('voided') }
}

function samePreview(hash: string, expected: unknown) {
  if (typeof expected !== 'string' || hash !== expected) fail('所选批次或码状态已变化，请重新预览并确认操作范围', 409)
}

/** 全部批次共用事务与按产品排序的行锁；任何企业边界、审计或写入失败均整次回滚。 */
export async function flagUsageSelection(user: AuthUser, body: any) {
  await requireUsageBatchSchema()
  if (user.role === 'viewer' || user.device_id) fail('当前账号不能批量编辑码库', 403)
  const flag = body?.flag, reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (![0, 1, 2].includes(flag)) fail('无效的异常标记')
  if (reason.length > 500 || (flag === 2 && !reason)) fail(flag === 2 && !reason ? '作废必须填写原因' : '原因不能超过500字')
  const seed = await selectedBatches(user, body.selection)
  samePreview(seed.hash, body.previewHash)
  return transaction(async conn => {
    const products = [...new Set(seed.rows.map(row => Number(row.product_id)))].sort((a, b) => a - b)
    for (const id of products) await conn.query('SELECT id FROM product WHERE id=? FOR UPDATE', [id])
    const selected = await selectedBatches(user, body.selection, conn)
    samePreview(selected.hash, body.previewHash)
    let affected = 0
    const action = ({ 0: '恢复', 1: '冻结', 2: '作废' } as Record<number, string>)[flag]
    for (const batch of selected.rows) {
      const [result] = await conn.execute<ResultSetHeader>(`UPDATE trace_code SET abnormal_flag=?,abnormal_reason=? WHERE usage_batch_id=? AND upload_batch_id=? AND enterprise_id=? AND ${flag === 2 ? 'abnormal_flag<>2' : 'abnormal_flag=?'}`, [flag, flag === 0 ? null : reason || null, batch.id, batch.parent_upload_batch_id, batch.enterprise_id, ...(flag === 2 ? [] : [flag === 1 ? 0 : 1])])
      const count = Number(result.affectedRows)
      affected += count
      if (count) await conn.execute('INSERT INTO operation_log(enterprise_id,user_id,module,action,content,result) VALUES (?,?,?,?,?,1)', [batch.enterprise_id, user.id, '码库管理', '批量' + action, JSON.stringify({ usageBatchId: Number(batch.id), count, flag, reason, previewHash: selected.hash })])
    }
    if (!affected) fail(`所选范围没有可${action}的追溯码`)
    return { ok: true, affected, batchCount: selected.rows.length }
  })
}

/** 完成上传后的码归属固定，导出冻结的批次集合；按码主键分段读取完整清单。 */
export async function exportUsageSelection(user: AuthUser, body: any) {
  await requireUsageBatchSchema()
  if (!['txt', 'urls', 'csv'].includes(body.format)) fail('导出格式不支持')
  const selected = await selectedBatches(user, body.selection)
  samePreview(selected.hash, body.previewHash)
  if (!selected.rows.some(row => Number(row.total) > 0)) fail('所选范围没有可导出的追溯码')
  const base = String(useRuntimeConfig().public?.traceBaseUrl || 'https://www.nz315.cn/trace?code=')
  const csv = (value: unknown) => '"' + String(value ?? '').replaceAll('"', '""') + '"'
  const typeLabel: Record<string, string> = { '1': '持有人生产', '2': '委托加工', '3': '委托分装' }
  async function* chunks() {
    yield body.format === 'csv' ? '\uFEFFsn,农药名称,登记证号,生产企业,生产类型,规格码,生成时间,绑定状态,登记类别,登记证后6位,自定义段,上传批次\r\n' : '\uFEFF'
    for (const batch of selected.rows) {
      let cursor = 0
      while (true) {
        const rows = await query<any[]>(`SELECT c.id,c.code,c.status,ub.created_at,p.name,p.registration_no,e.name AS company_name FROM trace_code c JOIN product p ON p.id=c.product_id JOIN enterprise e ON e.id=c.enterprise_id JOIN upload_batch ub ON ub.id=c.upload_batch_id WHERE c.usage_batch_id=? AND c.upload_batch_id=? AND c.enterprise_id=? AND c.id>? ORDER BY c.id LIMIT 5000`, [batch.id, batch.parent_upload_batch_id, batch.enterprise_id, cursor])
        if (!rows.length) break
        yield rows.map(row => body.format === 'csv' ? [row.code, csv(row.name), csv(row.registration_no), csv(row.company_name), csv(typeLabel[row.code.slice(7, 8)] || ''), csv(row.code.slice(8, 11)), csv(String(row.created_at).slice(0, 19)), Number(row.status) === 2 ? '已绑定' : '未绑定', row.code.slice(0, 1), row.code.slice(1, 7), row.code.slice(11), batch.id].join(',') : body.format === 'urls' ? base + row.code : row.code).join('\r\n') + '\r\n'
        cursor = Number(rows.at(-1).id)
      }
    }
  }
  return { stream: Readable.from(chunks()), count: selected.rows.reduce((n, row) => n + Number(row.total), 0), filename: `码库_${selected.rows.length}批_${Date.now()}.${body.format === 'csv' ? 'csv' : 'txt'}` }
}
