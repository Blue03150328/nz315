// POST /api/admin/codes/parse —— 追溯码文件解析校验（PRD 5.5.2）
// 输入：{ content: string（文件文本，每行一个码）} 或 { codes: string[] }
import { query } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'
import { cleanLine, validateBatch } from '../../../utils/code-validator'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const body = await readBody(event) || {}

  let rawLines: string[] = []
  if (Array.isArray(body.codes)) {
    rawLines = body.codes.map((c: any) => String(c))
  } else if (typeof body.content === 'string') {
    rawLines = body.content.split(/\r?\n/)
  } else {
    throw createError({ statusCode: 400, statusMessage: '请上传码文件或粘贴码文本' })
  }
  if (rawLines.length === 0) throw createError({ statusCode: 400, statusMessage: '文件为空' })
  if (rawLines.length > 100000) throw createError({ statusCode: 400, statusMessage: '单次最多 10 万条码' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id

  // 加载校验上下文（企业内）
  const [prodCond, prodParams] = fid ? [' WHERE enterprise_id = ?', [fid]] : ['', []]
  const products = await query<any[]>('SELECT id, registration_no, name FROM product WHERE status = 1' + prodCond, prodParams)
  const regLast6Map = new Map<string, number>()
  for (const p of products) {
    const last6 = String(p.registration_no).slice(-6)
    regLast6Map.set(last6, Number(p.id))
  }
  const specs = await query<any[]>('SELECT spec_code FROM product_spec WHERE status = 1' + prodCond, prodParams)
  const specCodeSet = new Set(specs.map((s: any) => String(s.spec_code)))
  const existingRows = await query<any[]>('SELECT code FROM trace_code WHERE 1=1' + prodCond, prodParams)
  const existingSet = new Set(existingRows.map((r: any) => String(r.code)))

  const batch = validateBatch(rawLines, { regLast6Map, specCodeSet, existingSet })

  // 产品名映射
  const productNameMap = new Map(products.map((p: any) => [Number(p.id), p.name]))
  const productGroups = Object.entries(batch.productGroups).map(([pid, count]) => ({
    productId: Number(pid),
    productName: productNameMap.get(Number(pid)) || '未知产品',
    count,
  }))

  return {
    fileName: String(body.fileName || ''),
    total: batch.total,
    validCount: batch.validCount,
    invalidCount: batch.invalidCount,
    reasonCount: batch.reasonCount,
    productGroups,
    preview: batch.results.slice(0, 20).map(r => ({
      code: r.code, valid: r.valid, reason: r.reason, matchedProductId: r.matchedProductId,
    })),
  }
})