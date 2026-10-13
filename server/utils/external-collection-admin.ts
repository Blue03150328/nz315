import { Readable } from 'node:stream'
import type { AuthUser } from './auth'
import { query } from './db'
import { externalBatchRow, externalFail, externalScope, externalTransaction, requireExternalCollectionSchema } from './external-collection'
import { externalCollectionId, externalCsvRow, externalMetadataInput } from '../../shared/utils/external-collection-input'

const columns = 'b.*,e.name AS enterprise_name'
const joins = ' FROM external_collection_batch b JOIN enterprise e ON e.id=b.enterprise_id'

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
  const clauses: string[] = [], params: any[] = []
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
  for (const [field, column] of [['lineName', 'line_name_snapshot'], ['workerNo', 'worker_no']] as const) {
    const value = pattern(input[field])
    if (value) { clauses.push(`b.${column} LIKE ? ESCAPE '!'`); params.push(value) }
  }
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
  const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''
  const [count] = await query<any[]>('SELECT COUNT(*) AS total' + joins + where, params)
  const rows = await query<any[]>(`SELECT ${columns}${joins}${where} ORDER BY b.created_at DESC,b.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset])
  return { rows: rows.map(externalBatchRow), total: Number(count.total), page, pageSize }
}

export async function externalCollectionBatch(user: AuthUser, id: string) {
  let batchId: string
  try { batchId = externalCollectionId(id) } catch (error) { return externalFail((error as Error).message, 400) }
  const [batch] = await query<any[]>(`SELECT ${columns}${joins} WHERE b.id=?`, [batchId])
  externalScope(user, batch)
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
