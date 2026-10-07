// 生成留档：与上传共用校验；同产品锁内重新查重，重复提交不创建空记录。
import { MAX_CODES_PER_WRITE, WRITE_QUANTITY_ERROR } from '#shared/utils/code-limits'
import { getPool } from '../../../utils/db'
import { requireWritableUser } from '../../../utils/auth'
import { logOperation } from '../../../utils/audit'
import { loadImportContext } from '../../../utils/import-context'
import { validateImportRows } from '../../../utils/import-validation'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const body = await readBody(event) || {}
  const codes: string[] = (Array.isArray(body.codes) ? body.codes : []).map(String)
  const productId = Number(body.productId)
  if (!codes.length) throw createError({ statusCode: 400, statusMessage: '没有可入库的码' })
  if (codes.length > MAX_CODES_PER_WRITE) throw createError({ statusCode: 400, statusMessage: WRITE_QUANTITY_ERROR })
  if (!Number.isInteger(productId) || productId <= 0) throw createError({ statusCode: 400, statusMessage: '请选择关联产品' })
  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  if (user.role !== 'platform_admin' && !fid) throw createError({ statusCode: 403, statusMessage: '账号未关联企业' })
  const now = new Date()
  const fileName = '生成入库 ' + now.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16)
  const conn = await getPool().getConnection()
  let result: any
  try {
    await conn.beginTransaction()
    const [[prod]] = await conn.query<any[]>('SELECT id, enterprise_id FROM product WHERE id = ? AND status = 1' + (fid ? ' AND enterprise_id = ?' : '') + ' FOR UPDATE', [productId, ...(fid ? [fid] : [])])
    if (!prod) throw createError({ statusCode: 400, statusMessage: '产品不存在或不属于本企业' })
    const { context } = await loadImportContext(codes, Number(prod.enterprise_id), conn)
    const validation = validateImportRows(codes, context, productId)
    let uploadBatchId: number | null = null
    let inserted = 0
    if (validation.accepted.length) {
      const [ub]: any = await conn.execute('INSERT INTO upload_batch (enterprise_id, file_name, product_id, batch_id, batch_no, produce_date, quality_cert_no, created_by) VALUES (?,?,?,NULL,NULL,NULL,NULL,?)', [prod.enterprise_id, fileName, productId, user.id])
      uploadBatchId = Number(ub.insertId)
      for (let i = 0; i < validation.accepted.length; i += 5000) {
        const chunk = validation.accepted.slice(i, i + 5000)
        const values = chunk.flatMap(code => [prod.enterprise_id, code, productId, uploadBatchId])
        const [r]: any = await conn.execute('INSERT INTO trace_code (enterprise_id, code, product_id, upload_batch_id, status, abnormal_flag) VALUES ' + chunk.map(() => '(?,?,?,?,1,0)').join(','), values)
        inserted += Number(r.affectedRows)
      }
    }
    result = { ok: true, imported: inserted, skippedInvalid: validation.invalid, skippedDup: validation.duplicate,
      duplicateFile: validation.reasonCount['文件内重复码'] || 0, duplicateDatabase: validation.reasonCount['重复码'] || 0,
      ignored: validation.ignored, total: validation.total, reasonCount: validation.reasonCount, uploadBatchId, fileName, status: '已生成',
      message: inserted ? '留档完成' : (validation.invalid ? '未新增，码格式或产品归属校验未通过' : '未新增，均已存在或重复') }
    await conn.commit()
  } catch (e: any) {
    await conn.rollback()
    if (e?.statusCode) throw e
    console.error('[stock-in] 入库事务失败:', e?.message || e)
    throw createError({ statusCode: 500, statusMessage: '入库失败，数据未写入，请重试' })
  } finally { conn.release() }
  await logOperation(event, { module: '码库管理', action: '追溯码生成入库', content: JSON.stringify({ productId, ...result }) })
  return result
})