import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import type { AuthUser } from './auth'
import { query } from './db'
import { externalBatchRow, externalFail, externalScope, externalTransaction, requireExternalCollectionSchema } from './external-collection'
import { externalCollectionId, externalCsvRow, externalMetadataInput } from '../../shared/utils/external-collection-input'

const beijing = (field: string) => `DATE_FORMAT(TIMESTAMPADD(SECOND,28800-TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),NOW()),${field}),'%Y-%m-%d %H:%i:%s.%f')`
const columns = `b.*,e.name AS enterprise_name,sp.spec_name AS linked_spec_name,${beijing('b.created_at')} AS created_at,${beijing('b.completed_at')} AS completed_at`
const joins = ' FROM external_collection_batch b JOIN enterprise e ON e.id=b.enterprise_id LEFT JOIN product p ON p.id=b.product_id LEFT JOIN product_spec sp ON sp.id=p.spec_id'

function paging(input: Record<string, any>) {
  const page = Math.max(1, Math.min(1000000, Number.parseInt(String(input.page || 1), 10) || 1))
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(String(input.pageSize || 20), 10) || 20))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

/** 模糊查询按文字查找，用户输入的百分号或下划线不当作通配符。 */
function pattern(value: unknown) {
  const valueText = typeof value === 'string' ? value.trim().slice(0, 200) : ''
  return valueText ? '%' + valueText.replace(/[!%_]/g, character => '!' + character) + '%' : ''
}

function filter(user: AuthUser, input: Record<string, any>) {
  const clauses: string[] = ["b.state <> 'deleted'"], params: any[] = []
  if (user.role !== 'platform_admin') { clauses.push('b.enterprise_id=?'); params.push(user.enterprise_id) }
  else if (input.enterpriseId !== undefined && input.enterpriseId !== '') {
    const id = Number(input.enterpriseId)
    if (!Number.isSafeInteger(id) || id < 1) externalFail('企业筛选无效', 400)
    clauses.push('b.enterprise_id=?'); params.push(id)
  }
  if (input.state) {
    if (!['active', 'completed'].includes(String(input.state))) externalFail('采集状态无效', 400)
    clauses.push('b.state=?'); params.push(input.state)
  }
  for (const [field, column] of [['lineName', 'line_name_snapshot'], ['workerNo', 'worker_no'], ['deviceName', 'device_name_snapshot'], ['batchNo', 'batch_no']] as const) {
    const value = pattern(input[field])
    if (value) { clauses.push(`b.${column} LIKE ? ESCAPE '!'`); params.push(value) }
  }
  if (input.productId !== undefined && input.productId !== '') {
    const productId = Number(input.productId)
    if (!Number.isSafeInteger(productId) || productId < 1) externalFail('产品筛选无效', 400)
    clauses.push('b.product_id=?'); params.push(productId)
  }
  for (const key of ['dateFrom', 'dateTo']) {
    if (!input[key]) continue
    const value = String(input[key])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) externalFail('日期筛选无效', 400)
    // 查询输入为北京时间，换算到当前数据库会话时区后比较，保留日期索引可用。
    clauses.push(`b.created_at ${key === 'dateFrom' ? '>=' : '<'} TIMESTAMPADD(SECOND,TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),NOW())-28800,?)`)
    params.push(key === 'dateFrom' ? value + ' 00:00:00' : new Date(Date.parse(value) + 86400000).toISOString().slice(0, 10) + ' 00:00:00')
  }
  if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) externalFail('开始日期不能晚于结束日期', 400)
  const keyword = pattern(input.keyword)
  if (keyword) {
    clauses.push("(CONVERT(b.id USING utf8mb4) LIKE ? ESCAPE '!' OR b.product_name_snapshot LIKE ? ESCAPE '!' OR b.batch_no LIKE ? ESCAPE '!' OR b.worker_no LIKE ? ESCAPE '!' OR b.line_name_snapshot LIKE ? ESCAPE '!')")
    params.push(keyword, keyword, keyword, keyword, keyword)
  }
  return { clauses, params }
}

export async function listExternalCollections(user: AuthUser, input: Record<string, any>) {
  await requireExternalCollectionSchema()
  const { page, pageSize, offset } = paging(input), { clauses, params } = filter(user, input)
  if (input.batchId) {
    const batch = await externalCollectionBatch(user, String(input.batchId))
    clauses.push('b.id=?'); params.push(batch.id)
  }
  const rawCode = pattern(input.rawCode)
  if (rawCode) {
    // 按码原文定位所属批次，不因同批多条命中而重复展示或改变实际码数。
    clauses.push("EXISTS (SELECT 1 FROM external_trace_code c WHERE c.batch_id=b.id AND c.raw_code LIKE ? ESCAPE '!')")
    params.push(rawCode)
  }
  const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''
  const [count] = await query<any[]>("SELECT COUNT(*) AS total,COALESCE(SUM(b.state='completed'),0) AS completed_total" + joins + where, params)
  const rows = await query<any[]>(`SELECT ${columns}${joins}${where} ORDER BY b.created_at DESC,b.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset])
  const selectionFilters = Object.fromEntries(['keyword', 'batchNo', 'rawCode', 'lineName', 'deviceName', 'workerNo', 'state', 'dateFrom', 'dateTo', 'batchId', 'productId'].filter(key => input[key] !== undefined && input[key] !== '').map(key => [key, input[key]]))
  return { rows: rows.map(externalBatchRow), total: Number(count.total), completedTotal: Number(count.completed_total), page, pageSize, selectionFilters }
}

export async function externalCollectionBatch(user: AuthUser, id: string) {
  let batchId: string
  try { batchId = externalCollectionId(id) } catch (error) { return externalFail((error as Error).message, 400) }
  const [batch] = await query<any[]>(`SELECT ${columns}${joins} WHERE b.id=?`, [batchId])
  externalScope(user, batch)
  if (batch.state === 'deleted') externalFail('外部采集批次已删除', 404)
  return externalBatchRow(batch)
}

export async function externalCollectionDetail(user: AuthUser, id: string, input: Record<string, any>) {
  await requireExternalCollectionSchema()
  const batch = await externalCollectionBatch(user, id), { page, pageSize, offset } = paging(input)
  const rows = await query<any[]>('SELECT id,raw_code,sequence_no,captured_at,received_at FROM external_trace_code WHERE batch_id=? ORDER BY sequence_no LIMIT ? OFFSET ?', [batch.id, pageSize, offset])
  return { batch, rows, total: Number(batch.accepted_count), page, pageSize }
}

export async function listExternalCodes(user: AuthUser, input: Record<string, any>) {
  await requireExternalCollectionSchema()
  // 码库关键词只匹配扫码原文，批次资料筛选在生产记录入口提供。
  const { clauses, params } = filter(user, { ...input, keyword: '' }), { page, pageSize, offset } = paging(input)
  if (input.batchId) {
    let batchId: string
    try { batchId = externalCollectionId(input.batchId) } catch (error) { return externalFail((error as Error).message, 400) }
    await externalCollectionBatch(user, batchId)
    clauses.push('c.batch_id=?'); params.push(batchId)
  }
  const keyword = pattern(input.keyword)
  if (keyword) { clauses.push("c.raw_code LIKE ? ESCAPE '!'"); params.push(keyword) }
  const from = ' FROM external_trace_code c JOIN external_collection_batch b ON b.id=c.batch_id JOIN enterprise e ON e.id=c.enterprise_id'
  const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''
  const [count] = await query<any[]>('SELECT COUNT(*) AS total' + from + where, params)
  const rows = await query<any[]>(`SELECT c.id,c.batch_id,c.enterprise_id,c.raw_code,c.sequence_no,c.captured_at,c.received_at,b.line_name_snapshot AS line_name,b.worker_no,e.name AS enterprise_name${from}${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset])
  return { rows, total: Number(count.total), page, pageSize }
}

/** 已完成批次只从业务列表移除，保留码原文和设备收据防止重复采集、旧批重建。 */
export async function deleteExternalCollection(user: AuthUser, id: string) {
  await requireExternalCollectionSchema()
  if (user.role === 'viewer' || user.device_id) externalFail('只读账号或采集设备不能删除采集批次', 403)
  let batchId: string
  try { batchId = externalCollectionId(id) } catch (error) { return externalFail((error as Error).message, 400) }
  return externalTransaction(async conn => {
    const [[batch]] = await conn.query<any[]>('SELECT * FROM external_collection_batch WHERE id=? FOR UPDATE', [batchId])
    externalScope(user, batch)
    if (batch.state === 'deleted') return { ok: true }
    if (batch.state !== 'completed') externalFail('请先在设备完成本次采集，再删除采集批次')
    await conn.execute("UPDATE external_collection_batch SET state='deleted' WHERE id=?", [batchId])
    await conn.execute('INSERT INTO operation_log(enterprise_id,user_id,module,action,content,result) VALUES (?,?,?,?,?,1)', [batch.enterprise_id, user.id, '外部生产记录', '删除', JSON.stringify({ batchId, lineName: batch.line_name_snapshot, workerNo: batch.worker_no, codeCount: batch.accepted_count })])
    return { ok: true }
  })
}

/** 手填产品名只落本批快照；不会新增产品或改动内部生产批次。 */
export async function updateExternalCollection(user: AuthUser, id: string, body: Record<string, any>) {
  await requireExternalCollectionSchema()
  if (user.role === 'viewer' || user.device_id) externalFail('只读账号或采集设备不能修改生产资料', 403)
  let batchId: string, input: ReturnType<typeof externalMetadataInput>
  try { batchId = externalCollectionId(id); input = externalMetadataInput(body) } catch (error) { return externalFail((error as Error).message, 400) }
  return externalTransaction(async conn => {
    const [[batch]] = await conn.query<any[]>('SELECT * FROM external_collection_batch WHERE id=? FOR UPDATE', [batchId])
    externalScope(user, batch)
    if (batch.state !== 'completed') externalFail('请先在设备完成本次采集，再填写生产资料')
    let productName = input.productName
    if (input.productId) {
      const [[product]] = await conn.query<any[]>('SELECT id,name,enterprise_id,status FROM product WHERE id=?', [input.productId])
      if (!product || Number(product.enterprise_id) !== Number(batch.enterprise_id) || Number(product.status) !== 1) externalFail('产品不存在、已停用或不属于本批企业', 400)
      productName = product.name
    }
    const before = { productId: batch.product_id, productName: batch.product_name_snapshot, batchNo: batch.batch_no, produceDate: batch.produce_date, productionQuantity: batch.production_quantity }
    const after = { ...input, productName }
    await conn.execute('UPDATE external_collection_batch SET product_id=?,product_name_snapshot=?,batch_no=?,produce_date=?,production_quantity=?,metadata_updated_at=NOW(3) WHERE id=?', [input.productId, productName, input.batchNo, input.produceDate, input.productionQuantity, batchId])
    // 生产资料与审计共用事务，审计失败不会留下无记录的修改。
    await conn.execute('INSERT INTO operation_log(enterprise_id,user_id,module,action,content,result) VALUES (?,?,?,?,?,1)', [batch.enterprise_id, user.id, '外部生产记录', '修改', JSON.stringify({ batchId, before, after })])
    const [[row]] = await conn.query<any[]>('SELECT * FROM external_collection_batch WHERE id=?', [batchId])
    return { ok: true, batch: externalBatchRow(row) }
  })
}

/** 固定完成批次的码清单不可再新增，按序号分段读取避免一次载入数万原文。 */
export async function exportExternalCollection(user: AuthUser, id: string, format: unknown) {
  await requireExternalCollectionSchema()
  if (format !== 'csv' && format !== 'txt') externalFail('请选择CSV或TXT导出格式', 400)
  const batch = await externalCollectionBatch(user, id)
  if (batch.state !== 'completed') externalFail('请先完成本次采集，再导出完整码清单')
  async function* chunks() {
    if (format === 'csv') yield Buffer.from('\uFEFF溯源码\r\n', 'utf8')
    let sequence = 0
    while (true) {
      const rows = await query<any[]>('SELECT raw_code,sequence_no FROM external_trace_code WHERE batch_id=? AND sequence_no>? ORDER BY sequence_no LIMIT 1000', [batch.id, sequence])
      if (!rows.length) break
      yield Buffer.from(rows.map(row => format === 'csv' ? externalCsvRow(row.raw_code) : row.raw_code + '\r\n').join(''), 'utf8')
      sequence = Number(rows[rows.length - 1].sequence_no)
    }
  }
  const safe = (value: unknown) => String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 50)
  const filename = ['外码采集', safe(batch.enterprise_name), String(batch.created_at).slice(0, 10), safe(batch.worker_no), batch.accepted_count + '条', batch.id.slice(0, 8)].join('_') + '.' + format
  return { stream: Readable.from(chunks()), filename, contentType: format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8' }
}

/** 多选及当前查询结果全选共用企业和筛选边界，只能导出已完成批次。 */
async function externalExportSelection(user: AuthUser, selection: any) {
  await requireExternalCollectionSchema()
  let ids: string[] = [], excluded: string[] = []
  try {
    if (selection?.all === true) {
      if (!selection.filters || typeof selection.filters !== 'object' || Array.isArray(selection.filters) || selection.ids?.length || (selection.excludeIds !== undefined && !Array.isArray(selection.excludeIds))) throw Error('全选范围无效')
      excluded = (selection.excludeIds || []).map(externalCollectionId)
    } else {
      if (!Array.isArray(selection?.ids) || !selection.ids.length) throw Error('请选择已完成的采集批次')
      ids = [...new Set<string>(selection.ids.map(externalCollectionId))]
    }
  } catch (error) { return externalFail((error as Error).message, 400) }
  const input = selection.all === true ? selection.filters : {}, { clauses, params } = filter(user, input)
  clauses.push("b.state='completed'")
  if (ids.length) { clauses.push('b.id IN (?)'); params.push(ids) }
  if (excluded.length) { clauses.push('b.id NOT IN (?)'); params.push(excluded) }
  if (input.batchId) { clauses.push('b.id=?'); params.push(externalCollectionId(input.batchId)) }
  const raw = pattern(input.rawCode)
  if (raw) { clauses.push("EXISTS (SELECT 1 FROM external_trace_code c WHERE c.batch_id=b.id AND c.raw_code LIKE ? ESCAPE '!')"); params.push(raw) }
  const rows = await query<any[]>('SELECT b.id,b.accepted_count' + joins + ' WHERE ' + clauses.join(' AND ') + ' ORDER BY b.id', params)
  if (!rows.length || (ids.length && rows.length !== ids.length)) externalFail('所选批次不存在、尚未完成或不属于本企业', 404)
  const previewHash = createHash('sha256').update(JSON.stringify(rows.map(row => [row.id, Number(row.accepted_count)]))).digest('hex')
  return { rows, previewHash }
}

export async function previewExternalExport(user: AuthUser, selection: any) {
  const result = await externalExportSelection(user, selection)
  return { selection, previewHash: result.previewHash, batchCount: result.rows.length, codeTotal: result.rows.reduce((n, row) => n + Number(row.accepted_count), 0) }
}

export async function exportExternalSelection(user: AuthUser, body: any) {
  if (!['csv', 'txt'].includes(body?.format)) externalFail('请选择CSV或TXT导出格式', 400)
  const selected = await externalExportSelection(user, body.selection)
  if (selected.previewHash !== body.previewHash) externalFail('所选批次已变化，请重新预览并确认导出范围', 409)
  async function* chunks() {
    if (body.format === 'csv') yield '\uFEFF溯源码\r\n'
    for (const batch of selected.rows) {
      let sequence = 0
      while (true) {
        const rows = await query<any[]>('SELECT raw_code,sequence_no FROM external_trace_code WHERE batch_id=? AND sequence_no>? ORDER BY sequence_no LIMIT 1000', [batch.id, sequence])
        if (!rows.length) break
        yield rows.map(row => body.format === 'csv' ? externalCsvRow(row.raw_code) : row.raw_code + '\r\n').join('')
        sequence = Number(rows.at(-1).sequence_no)
      }
    }
  }
  return { stream: Readable.from(chunks()), filename: `外部溯源码_${selected.rows.length}批_${Date.now()}.${body.format}`, contentType: body.format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8' }
}
