// POST /api/admin/codes/import —— 追溯码入库（PRD 5.5.3：绑定产品；可选绑定批次 → 三要素齐全置为已绑定）
import { query, execute } from '../../../utils/db'
import { sendMessage } from '../../../utils/notify'
import { requireBackendUser } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const body = await readBody(event) || {}
  const codes: string[] = (Array.isArray(body.codes) ? body.codes : []).map((c: any) => String(c))
  const productId = Number(body.productId)
  const batchId = body.batchId ? Number(body.batchId) : null

  if (codes.length === 0) throw createError({ statusCode: 400, statusMessage: '没有可导入的码' })
  if (codes.length > 100000) throw createError({ statusCode: 400, statusMessage: '单次最多 10 万条码' })
  if (!Number.isInteger(productId) || productId <= 0) throw createError({ statusCode: 400, statusMessage: '请选择关联产品' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [prod] = await query<any[]>(
    'SELECT id, enterprise_id FROM product WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
    fid ? [productId, fid] : [productId])
  if (!prod) throw createError({ statusCode: 400, statusMessage: '产品不存在' })
  const enterpriseId = Number(prod.enterprise_id)

  // 批次校验（可选绑定）
  let batchInfo: any = null
  if (batchId) {
    const [b] = await query<any[]>(
      'SELECT * FROM batch WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
      fid ? [batchId, fid] : [batchId])
    if (!b) throw createError({ statusCode: 400, statusMessage: '批次不存在' })
    if (Number(b.product_id) !== productId) throw createError({ statusCode: 400, statusMessage: '批次与产品不匹配' })
    batchInfo = b
  }

  // 去重检查（导入时再次校验）
  const placeholders = codes.map(() => '?').join(',')
  const dupRows = await query<any[]>(
    'SELECT code FROM trace_code WHERE code IN (' + placeholders + ')', codes)
  const dupSet = new Set(dupRows.map((r: any) => String(r.code)))
  const finalCodes = codes.filter(c => !dupSet.has(c))
  if (finalCodes.length === 0) throw createError({ statusCode: 400, statusMessage: '所有码均已在系统中，无可导入' })

  // 批量插入（绑定批次则三要素冗余 + 状态=已绑定）
  const status = batchInfo ? 2 : 1
  const values: any[] = []
  const valuePlaceholders = finalCodes.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',')
  for (const code of finalCodes) {
    values.push(
      enterpriseId, code, productId,
      batchId || null,
      batchInfo ? batchInfo.produce_date : null,
      batchInfo ? batchInfo.batch_no : null,
      batchInfo ? batchInfo.quality_cert_no : null,
      status, 0, null,
    )
  }
  const result = await execute(
    'INSERT INTO trace_code (enterprise_id, code, product_id, batch_id, produce_date, batch_no, quality_cert_no, status, abnormal_flag, abnormal_reason) VALUES ' + valuePlaceholders,
    values)

  // 站内消息：导入完成通知（PRD 5.11 上传完成）
  await sendMessage({
    enterpriseId, type: 'upload_done',
    title: '生产采集导入完成',
    content: '成功导入 ' + finalCodes.length + ' 条追溯码（' + (status === 2 ? '已绑定批次' : '已生成') + '）',
    link: '/admin/codes',
  })

  return {
    ok: true,
    imported: finalCodes.length,
    skippedDup: codes.length - finalCodes.length,
    batchId: batchId || null,
    status: status === 2 ? '已绑定' : '已生成',
  }
})