// POST /api/admin/codes/stock-in —— 追溯码生成入库留档（状态：已生成/未绑定）
// 2026-09-04 方案 A（用户决策）：让「已生成（未绑定）」状态恢复真实业务意义——
// 企业提前批量印刷码（生成页导出给印刷厂）后可先把码入库留档：可查、可扫码
// （展示产品信息+「尚未绑定生产信息」），生产时在码库管理按上传批次【修正】绑定批次。
// 与 import（生产采集，强制绑定）互为两条入库通道：import=绑定入库；stock-in=留档入库。
// 同一事务：建 upload_batch 行（文件维度，file_name=「生成入库 时间」）+ 分块插码（status=1）。
import { getPool, query } from '../../../utils/db'
import { requireWritableUser } from '../../../utils/auth'
import { logOperation } from '../../../utils/audit'
import { cleanLine, validateCode } from '../../../utils/code-validator'

// 单批写入上限（与 import 同口径，防 max_allowed_packet 超限）
const CHUNK = 5000

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const body = await readBody(event) || {}
  const codes: string[] = (Array.isArray(body.codes) ? body.codes : []).map((c: any) => String(c))
  const productId = Number(body.productId)

  if (codes.length === 0) throw createError({ statusCode: 400, statusMessage: '没有可入库的码' })
  if (codes.length > 100000) throw createError({ statusCode: 400, statusMessage: '单次最多 10 万条码' })
  if (!Number.isInteger(productId) || productId <= 0) throw createError({ statusCode: 400, statusMessage: '请选择关联产品' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [prod] = await query<any[]>(
    'SELECT id, enterprise_id FROM product WHERE id = ?' + (fid ? ' AND enterprise_id = ?' : ''),
    fid ? [productId, fid] : [productId])
  if (!prod) throw createError({ statusCode: 400, statusMessage: '产品不存在' })
  const enterpriseId = Number(prod.enterprise_id)

  // 结构校验上下文（与 import/parse 同口径；企业过滤条件前缀必须 AND）
  const [prodCond, prodParams] = fid ? [' AND enterprise_id = ?', [fid]] : ['', []]
  const products = await query<any[]>('SELECT id, registration_no FROM product WHERE status = 1' + prodCond, prodParams)
  const regLast6Map = new Map<string, number>()
  for (const p of products) regLast6Map.set(String(p.registration_no).slice(-6), Number(p.id))
  const specs = await query<any[]>('SELECT spec_code FROM product_spec WHERE status = 1' + prodCond, prodParams)
  const specCodeSet = new Set(specs.map((s: any) => String(s.spec_code)))
  const existingRows = await query<any[]>('SELECT code FROM trace_code WHERE 1=1' + prodCond, prodParams)
  const existingSet = new Set(existingRows.map((r: any) => String(r.code)))

  // 逐条清洗 + 结构校验 + 查重 + 归属产品校验（生成码必结构正确，此校验防绕过接口直灌错码）
  const cleaned: string[] = []
  let skippedInvalid = 0
  let skippedDup = 0
  for (const raw of codes) {
    const cd = cleanLine(raw)
    if (!cd) { skippedInvalid++; continue }
    const chk = validateCode(cd, { regLast6Map, specCodeSet, existingSet })
    if (!chk.valid) {
      if (chk.reason === '重复码') skippedDup++
      else skippedInvalid++
      continue
    }
    if (Number(chk.matchedProductId) !== productId) { skippedInvalid++; continue }
    cleaned.push(cd)
  }
  const finalCodes = cleaned
  if (finalCodes.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: skippedInvalid ? '码格式/归属校验未通过，无可入库（与解析页同口径）' : '所有码均已在系统中，无可入库',
    })
  }

  // 上传批次行名：生成入库留档（与 import 的 fileName 同列，码库聚合列表按行展示）
  const now = new Date()
  const pad2 = (n: number) => String(n).padStart(2, '0')
  const fileName = '生成入库 ' + now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) + ' ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes())

  // 事务：upload_batch 建档 + 分块插码（status=1 已生成）
  const pool = getPool()
  const conn = await pool.getConnection()
  let uploadBatchId = 0
  let inserted = 0
  try {
    await conn.beginTransaction()
    const [ubRes] = await conn.execute(
      'INSERT INTO upload_batch (enterprise_id, file_name, product_id, batch_id, batch_no, produce_date, quality_cert_no, created_by) VALUES (?,?,?,NULL,NULL,NULL,NULL,?)',
      [enterpriseId, fileName, productId, user.id]) as unknown as [{ insertId: number }, unknown]
    uploadBatchId = Number(ubRes.insertId)

    for (let i = 0; i < finalCodes.length; i += CHUNK) {
      const chunk = finalCodes.slice(i, i + CHUNK)
      const values: any[] = []
      const valuePlaceholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',')
      for (const cd of chunk) {
        // enterprise_id, code, product_id, batch_id, produce_date, batch_no, quality_cert_no,
        // status(1已生成), abnormal_flag(0正常), abnormal_reason, upload_batch_id
        values.push(enterpriseId, cd, productId, null, null, null, null, 1, 0, null, uploadBatchId)
      }
      const [r] = await conn.execute(
        'INSERT INTO trace_code (enterprise_id, code, product_id, batch_id, produce_date, batch_no, quality_cert_no, status, abnormal_flag, abnormal_reason, upload_batch_id) VALUES ' + valuePlaceholders,
        values) as unknown as [{ affectedRows: number }, unknown]
      inserted += Number(r.affectedRows || 0)
    }
    await conn.commit()
  } catch (e: any) {
    await conn.rollback()
    console.error('[stock-in] 入库事务失败:', e?.message || e)
    throw createError({ statusCode: 500, statusMessage: '入库失败，数据未写入，请重试' })
  } finally {
    conn.release()
  }

  await logOperation(event, {
    module: '码库管理',
    action: '追溯码生成入库',
    content: JSON.stringify({ productId, imported: inserted, skippedInvalid, skippedDup, uploadBatchId, fileName }),
  })

  return {
    ok: true,
    imported: inserted,
    skippedInvalid,
    skippedDup,
    uploadBatchId,
    fileName,
    status: '已生成',
  }
})
