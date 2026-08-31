// PATCH /api/admin/batches/:id —— 编辑批次（PRD 5.6）
import { query, execute } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw createError({ statusCode: 400, statusMessage: '无效的批次ID' })
  const body = await readBody(event) || {}

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [batch] = await query<any[]>(
    'SELECT * FROM batch WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''), fid ? [id, fid] : [id])
  if (!batch) throw createError({ statusCode: 404, statusMessage: '批次不存在' })

  const batchNo = String(body.batchNo || '').trim()
  const produceDate = String(body.produceDate || '').trim()
  const qualityCertNo = String(body.qualityCertNo || '').trim()
  const expireDate = String(body.expireDate || '').trim()
  const quantity = Number(body.quantity || 0)
  if (!batchNo || !produceDate || !qualityCertNo || !expireDate) {
    throw createError({ statusCode: 400, statusMessage: '批号/生产日期/合格证号/有效期至 均为必填' })
  }

  // 批号唯一（排除自身）
  const [dup] = await query<any[]>(
    'SELECT id FROM batch WHERE product_id = ? AND batch_no = ? AND id <> ? LIMIT 1',
    [batch.product_id, batchNo, id])
  if (dup) throw createError({ statusCode: 400, statusMessage: '该产品下批次号已存在' })

  await execute(
    'UPDATE batch SET batch_no = ?, produce_date = ?, quality_cert_no = ?, expire_date = ?, qc_result = ?, qc_report_no = ?, quantity = ? WHERE id = ?',
    [batchNo, produceDate, qualityCertNo, expireDate, body.qcResult === 0 ? 0 : 1, String(body.qcReportNo || '').trim() || null, quantity, id]
  )
  return { ok: true }
})
