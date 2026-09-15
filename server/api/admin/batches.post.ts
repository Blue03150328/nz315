// POST /api/admin/batches —— 新建生产批号（PRD 5.6）
import { query, execute } from '../../utils/db'
import { requireWritableUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const body = await readBody(event) || {}

  const productId = Number(body.productId)
  const batchNo = String(body.batchNo || '').trim()
  const produceDate = String(body.produceDate || '').trim()
  const qualityCertNo = String(body.qualityCertNo || '').trim()
  const expireDate = String(body.expireDate || '').trim()
  const qcResult = body.qcResult === 0 ? 0 : 1
  const qcReportNo = String(body.qcReportNo || '').trim()
  const quantity = Number(body.quantity || 0)

  if (!Number.isInteger(productId) || productId <= 0) throw createError({ statusCode: 400, statusMessage: '请选择关联产品' })
  if (!batchNo) throw createError({ statusCode: 400, statusMessage: '请输入生产批次号' })
  if (!produceDate) throw createError({ statusCode: 400, statusMessage: '请选择生产日期（须与产品标签喷码一致）' })
  if (!qualityCertNo) throw createError({ statusCode: 400, statusMessage: '请输入质量合格证号' })
  if (!expireDate) throw createError({ statusCode: 400, statusMessage: '请选择有效期至' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [prod] = await query<any[]>(
    'SELECT id, enterprise_id FROM product WHERE id = ? AND status = 1' + (fid ? ' AND enterprise_id = ?' : ''),
    fid ? [productId, fid] : [productId])
  if (!prod) throw createError({ statusCode: 400, statusMessage: '产品不存在或已停用' })

  // 同产品下批次号不可重复（PRD 5.6 规则1）
  const [dup] = await query<any[]>('SELECT id FROM batch WHERE product_id = ? AND batch_no = ? LIMIT 1', [productId, batchNo])
  if (dup) throw createError({ statusCode: 400, statusMessage: '该产品下批次号已存在' })

  const enterpriseId = fid || Number(prod.enterprise_id)
  const result = await execute(
    'INSERT INTO batch (enterprise_id, product_id, batch_no, produce_date, quality_cert_no, expire_date, qc_result, qc_report_no, quantity) VALUES (?,?,?,?,?,?,?,?,?)',
    [enterpriseId, productId, batchNo, produceDate, qualityCertNo, expireDate, qcResult, qcReportNo || null, quantity]
  )
  return { ok: true, id: result.insertId }
})