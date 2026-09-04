// POST /api/admin/codes/import —— 追溯码入库（PRD 5.5.3：绑定产品；可选绑定批次 → 三要素齐全置为已绑定）
import { query, execute } from '../../../utils/db'
import { sendMessage } from '../../../utils/notify'
import { requireBackendUser } from '../../../utils/auth'
import { cleanLine, validateCode } from '../../../utils/code-validator'

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

  // 加载校验上下文（企业内；结构校验与 parse 同口径——import 是公共接口，
  // 若只查重不校验结构，客户端可绕过 parse 直接灌入任意字符串/错构码，污染追溯码表）
  const [prodCond, prodParams] = fid ? [' AND enterprise_id = ?', [fid]] : ['', []]
  const products = await query<any[]>('SELECT id, registration_no FROM product WHERE status = 1' + prodCond, prodParams)
  const regLast6Map = new Map<string, number>()
  for (const p of products) regLast6Map.set(String(p.registration_no).slice(-6), Number(p.id))
  const specs = await query<any[]>('SELECT spec_code FROM product_spec WHERE status = 1' + prodCond, prodParams)
  const specCodeSet = new Set(specs.map((s: any) => String(s.spec_code)))
  const existingRows = await query<any[]>('SELECT code FROM trace_code WHERE 1=1' + prodCond, prodParams)
  const existingSet = new Set(existingRows.map((r: any) => String(r.code)))

  // 逐条结构校验 + 系统内去重（与 parse 的 validateBatch 同一口径）
  const cleaned: string[] = []
  let skippedInvalid = 0
  for (const raw of codes) {
    const code = cleanLine(raw)
    if (!code) { skippedInvalid++; continue }
    const chk = validateCode(code, { regLast6Map, specCodeSet, existingSet })
    if (!chk.valid) { skippedInvalid++; continue }
    // 码结构匹配的产品须与所选产品一致（防止跨产品导入错码）
    if (Number(chk.matchedProductId) !== productId) { skippedInvalid++; continue }
    cleaned.push(code)
  }
  const finalCodes = cleaned
  if (finalCodes.length === 0) throw createError({ statusCode: 400, statusMessage: skippedInvalid ? '码格式/归属校验未通过，无可导入（校验与解析页同口径）' : '所有码均已在系统中，无可导入' })

  // 批量插入（绑定批次则三要素冗余 + 状态=已绑定）；分块 5000/批防 max_allowed_packet 超限
  const status = batchInfo ? 2 : 1
  const CHUNK = 5000
  let inserted = 0
  for (let i = 0; i < finalCodes.length; i += CHUNK) {
    const chunk = finalCodes.slice(i, i + CHUNK)
    const values: any[] = []
    const valuePlaceholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',')
    for (const code of chunk) {
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
    inserted += Number(result.affectedRows || 0)
  }

  // 站内消息：导入完成通知（PRD 5.11 上传完成）
  await sendMessage({
    enterpriseId, type: 'upload_done',
    title: '生产采集导入完成',
    content: '成功导入 ' + inserted + ' 条追溯码（' + (status === 2 ? '已绑定批次' : '已生成') + '）',
    link: '/admin/codes',
  })

  return {
    ok: true,
    imported: inserted,
    skippedInvalid: skippedInvalid,
    skippedDup: codes.length - inserted - skippedInvalid,
    batchId: batchId || null,
    status: status === 2 ? '已绑定' : '已生成',
  }
})