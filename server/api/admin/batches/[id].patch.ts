// 生产批次整体更正：产品→批次→码同一事务，仅同步明确修改的字段。
import { getPool, query } from '../../../utils/db'
import { requireWritableUser } from '../../../utils/auth'
import { productionPatch } from '../../../utils/production-patch'
import { assertCodesCorrectable } from '../../../utils/binding-guard'
import { refreshUploadSnapshots } from '../../../utils/upload-snapshot'
import { logOperation } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的批次ID' })
  const body = await readBody(event) || {}
  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const scope = fid ? ' AND enterprise_id = ?' : ''
  const [seed] = await query<any[]>('SELECT product_id FROM batch WHERE id = ?' + scope, [id, ...(fid ? [fid] : [])])
  if (!seed) throw createError({ statusCode: 404, statusMessage: '批次不存在' })
  let patch: Record<string, string | number>
  try { patch = productionPatch(body) } catch (e) { throw createError({ statusCode: 400, statusMessage: (e as Error).message }) }
  const conn = await getPool().getConnection()
  let audit: any
  try {
    await conn.beginTransaction()
    await conn.query('SELECT id FROM product WHERE id = ? FOR UPDATE', [seed.product_id])
    const [tasks] = await conn.query<any[]>('SELECT id FROM production_task WHERE batch_id = ? LIMIT 1', [id])
    if (tasks.length) throw createError({ statusCode: 409, statusMessage: '该批次已有生产任务，生产资料已锁定，不能整体更改' })
    const [[batch]] = await conn.query<any[]>('SELECT * FROM batch WHERE id = ?' + scope + ' FOR UPDATE', [id, ...(fid ? [fid] : [])])
    if (!batch || Number(batch.product_id) !== Number(seed.product_id)) throw createError({ statusCode: 409, statusMessage: '批次归属已变化，请刷新后重试' })
    const [codes] = await conn.query<any[]>('SELECT id, upload_batch_id, abnormal_flag FROM trace_code WHERE batch_id = ? ORDER BY id FOR UPDATE', [id])
    assertCodesCorrectable(codes)
    const batchNo = String(body.batchNo ?? '').trim() || batch.batch_no
    const produceDate = patch.produce_date ?? String(batch.produce_date ?? '').slice(0, 10)
    const cert = patch.quality_cert_no ?? batch.quality_cert_no
    const expiry = patch.expire_date ?? batch.expire_date
    const qc = patch.qc_result ?? batch.qc_result
    const report = String(body.qcReportNo ?? '').trim() || batch.qc_report_no
    const quantity = body.quantity === undefined ? Number(batch.quantity) : Number(body.quantity)
    if (!batchNo || !produceDate || !cert) throw createError({ statusCode: 400, statusMessage: '批号、生产日期、质量合格证号均为必填' })
    if (!Number.isInteger(quantity) || quantity < 0) throw createError({ statusCode: 400, statusMessage: '生产数量须为非负整数' })
    const [[dup]] = await conn.query<any[]>('SELECT id FROM batch WHERE product_id = ? AND batch_no = ? AND id <> ?', [batch.product_id, batchNo, id])
    if (dup) throw createError({ statusCode: 400, statusMessage: '该产品下批次号已存在' })
    await conn.execute('UPDATE batch SET batch_no = ?, produce_date = ?, quality_cert_no = ?, expire_date = ?, qc_result = ?, qc_report_no = ?, quantity = ? WHERE id = ?', [batchNo, produceDate, cert, expiry, qc, report, quantity, id])
    // 批次未修改的字段不能覆盖各码原有修正值。
    const codePatch = { ...patch, ...(String(body.batchNo ?? '').trim() ? { batch_no: batchNo } : {}) }
    if (Object.keys(codePatch).length) await conn.execute('UPDATE trace_code SET ' + Object.keys(codePatch).map(key => key + ' = ?').join(', ') + ' WHERE batch_id = ?', [...Object.values(codePatch), id])
    await refreshUploadSnapshots(conn, codes.map(c => Number(c.upload_batch_id)))
    audit = { count: codes.length, before: batch, after: { batchNo, produceDate, qualityCertNo: cert, expireDate: expiry, qcResult: qc, qcReportNo: report, quantity } }
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
  await logOperation(event, { module: '生产批次', action: '整批更正', content: JSON.stringify(audit) })
  return { ok: true }
})
