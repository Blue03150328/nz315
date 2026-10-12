import { Readable } from 'node:stream'
import type { ResultSetHeader } from 'mysql2/promise'
import { setResponseHeaders, sendStream, type H3Event } from 'h3'
import type { AuthUser } from './auth'
import { query } from './db'
import { transaction } from './production-task'
import { resolveCodeScope, codeScopeSql, type CodeScope } from './code-scope'
import { refreshUploadSnapshots } from './upload-snapshot'
import { logOperation } from './audit'

const fail = (message: string, statusCode = 400): never => { throw createError({ statusCode, statusMessage: message }) }
const labels: Record<number, string> = { 0: '恢复正常', 1: '冻结', 2: '作废' }
export function remainingScope(value: unknown) {
  if (value !== undefined && value !== 'remaining') fail('码范围无效')
  return value === 'remaining'
}

/** 管理操作先锁产品再锁实际码范围，与领用、采集和生产资料更正保持相同顺序。 */
export async function flagCodeScope(user: AuthUser, selection: CodeScope, body: any) {
  const { row, scope } = await resolveCodeScope(user, selection), flag = Number(body.flag), reason = String(body.reason || '').trim()
  if (![0, 1, 2].includes(flag)) fail('无效的异常标记')
  if (reason.length > 500) fail('原因不能超过500字')
  if (flag === 2 && !reason) fail('作废必须填写原因')
  const selected = codeScopeSql(scope)
  const affected = await transaction(async conn => {
    await conn.query('SELECT id FROM product WHERE id=? FOR UPDATE', [row.product_id])
    const [codes] = await conn.query<any[]>(`SELECT c.id,c.abnormal_flag FROM trace_code c WHERE ${selected.sql} AND c.enterprise_id=? ORDER BY c.id FOR UPDATE`, [...selected.values, row.enterprise_id])
    const operable = codes.filter(c => flag === 2 ? Number(c.abnormal_flag) !== 2 : Number(c.abnormal_flag) === (flag === 1 ? 0 : 1))
    if (!operable.length) fail(flag === 2 ? '所选范围没有可作废的追溯码' : flag === 1 ? '所选范围没有可冻结的追溯码' : '所选范围没有需要恢复的冻结码')
    for (let i = 0; i < operable.length; i += 1000) {
      const chunk = operable.slice(i, i + 1000)
      await conn.execute('UPDATE trace_code SET abnormal_flag=?,abnormal_reason=? WHERE id IN (' + chunk.map(() => '?').join(',') + ')', [flag, flag === 0 ? null : reason || null, ...chunk.map(c => c.id)])
    }
    return operable.length
  })
  return { ok: true, affected, flagLabel: labels[flag], fileName: row.file_name, scope }
}

/** 已绑定码和任何任务历史均保留；删除剩余范围时保留原总批及已有使用子批。 */
export async function deleteCodeScope(user: AuthUser, selection: CodeScope) {
  const { row, scope } = await resolveCodeScope(user, selection), selected = codeScopeSql(scope)
  const deletedCodes = await transaction(async conn => {
    await conn.query('SELECT id FROM product WHERE id=? FOR UPDATE', [row.product_id])
    const [codes] = await conn.query<any[]>(`SELECT c.id,c.status FROM trace_code c WHERE ${selected.sql} AND c.enterprise_id=? ORDER BY c.id FOR UPDATE`, [...selected.values, row.enterprise_id])
    if (codes.some(c => Number(c.status) === 2)) fail('所选范围含已绑定码，不能删除，需保留扫码追溯', 409)
    const [[history]] = await conn.query<any[]>(`SELECT d.task_id FROM production_task_code d JOIN trace_code c ON c.id=d.code_id WHERE ${selected.sql} AND c.enterprise_id=? LIMIT 1`, [...selected.values, row.enterprise_id])
    if (history) fail('所选范围含生产任务历史，不能删除', 409)
    if (scope.usageBatchId) fail('已用子批次需保留扫码追溯，不能删除', 409)
    const [removed] = await conn.execute<ResultSetHeader>(`DELETE c FROM trace_code c WHERE ${selected.sql} AND c.enterprise_id=?`, [...selected.values, row.enterprise_id])
    if (!scope.remaining) await conn.execute('DELETE FROM upload_batch WHERE id=? AND enterprise_id=?', [scope.uploadBatchId!, row.enterprise_id])
    else {
      await refreshUploadSnapshots(conn, [scope.uploadBatchId!])
    }
    return Number(removed.affectedRows)
  })
  return { ok: true, deletedCodes, fileName: row.file_name, scope }
}

/** 导出读取固定子批归属或当时剩余范围，使用生成时规格快照命名。 */
export async function exportCodeScope(event: H3Event, user: AuthUser, selection: CodeScope, format: string) {
  if (!['txt', 'urls', 'csv'].includes(format)) fail('导出格式不支持')
  const { row: root, scope } = await resolveCodeScope(user, selection)
  if (!String(root.file_name || '').startsWith('生成入库')) fail('仅生成入库留档批次支持导出，采集文件请使用原始文件', 403)
  const [meta] = await query<any[]>(`SELECT p.name,p.registration_no,e.name AS company_name FROM product p JOIN enterprise e ON e.id=p.enterprise_id WHERE p.id=?`, [root.product_id])
  const selected = codeScopeSql(scope)
  const [count] = await query<any[]>(`SELECT COUNT(*) AS n FROM trace_code c WHERE ${selected.sql} AND c.enterprise_id=?`, [...selected.values, root.enterprise_id])
  const total = Number(count.n)
  if (!total) fail('所选范围没有可导出的追溯码')
  const safe = (value: unknown) => String(value ?? '').replace(/[\\/:*?"<>|]/g, '_')
  const suffix = scope.usageBatchId ? `_使用子批${scope.usageBatchId}` : scope.remaining ? '_剩余未用' : ''
  const fileName = `${safe(root.enterprise_id)}_${safe(meta?.name)}_${safe(root.spec_name_snapshot || '原规格未记录')}_${String(root.created_at).slice(0, 10).replaceAll('-', '')}${suffix}.${format === 'csv' ? 'csv' : 'txt'}`
  const base = String(useRuntimeConfig().public?.traceBaseUrl || 'https://www.nz315.cn/trace?code=')
  const csv = (value: unknown) => '"' + String(value ?? '').replaceAll('"', '""') + '"'
  const typeLabel: Record<string, string> = { '1': '持有人生产', '2': '委托加工', '3': '委托分装' }
  async function* emit() {
    yield format === 'csv' ? '\uFEFFsn,农药名称,登记证号,生产企业,生产类型,规格码,生成时间,绑定状态,登记类别,登记证后6位,自定义段\r\n' : '\uFEFF'
    let cursor = 0
    while (true) {
      const rows = await query<any[]>(`SELECT c.id,c.code,c.status FROM trace_code c WHERE ${selected.sql} AND c.enterprise_id=? AND c.id>? ORDER BY c.id LIMIT 5000`, [...selected.values, root.enterprise_id, cursor])
      if (!rows.length) break
      yield rows.map(code => format === 'txt' ? code.code : format === 'urls' ? base + code.code : [code.code, csv(meta?.name), csv(meta?.registration_no), csv(meta?.company_name), csv(typeLabel[String(code.code).slice(7, 8)] || ''), csv(String(code.code).slice(8, 11)), csv(String(root.created_at).slice(0, 19)), Number(code.status) === 2 ? '已绑定' : '未绑定', String(code.code).slice(0, 1), String(code.code).slice(1, 7), String(code.code).slice(11)].join(',')).join(format === 'csv' ? '\r\n' : '\n') + (format === 'csv' ? '\r\n' : '\n')
      cursor = Number(rows[rows.length - 1].id)
      if (rows.length < 5000) break
    }
  }
  setResponseHeaders(event, { 'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="codes.${format === 'csv' ? 'csv' : 'txt'}"; filename*=UTF-8''${encodeURIComponent(fileName)}`, 'Cache-Control': 'no-store' })
  await logOperation(event, { module: '码库管理', action: '导出留档码', content: JSON.stringify({ ...scope, fileName: root.file_name, format, count: total }) })
  return sendStream(event, Readable.from(emit()))
}
