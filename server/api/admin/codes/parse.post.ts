// POST /api/admin/codes/parse —— 追溯码文件解析校验（PRD 5.5.2）
// 输入：{ content: string（文件文本，每行一个码）} 或 { codes: string[] }
import { MAX_CODES_PER_WRITE, WRITE_QUANTITY_ERROR } from '#shared/utils/code-limits'
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
  if (rawLines.length > MAX_CODES_PER_WRITE) throw createError({ statusCode: 400, statusMessage: WRITE_QUANTITY_ERROR })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id

  // 加载校验上下文（企业内）
  // 条件前缀必须用 ' AND ...'（两处 SQL 基底已含 WHERE：WHERE status = 1 / WHERE 1=1），
  // 误用 ' WHERE ...' 会拼出双重 WHERE 语法错误 → 厂家账号解析 500（2026-09-04 实测修复）
  const [prodCond, prodParams] = fid ? [' AND enterprise_id = ?', [fid]] : ['', []]
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
    // 全部有效码清单（导入接口入参来源）——必须随响应返回，否则前端只能拿到前 20 条 preview，
    // 导入时构造不出完整码数组（2026-09-04 修复：此前页面误依赖未返回的 results 字段，导入必败）
    validCodes: batch.results.filter(r => r.valid).map(r => r.code),
    preview: batch.results.slice(0, 20).map(r => ({
      code: r.code, valid: r.valid, reason: r.reason, matchedProductId: r.matchedProductId,
    })),
  }
})