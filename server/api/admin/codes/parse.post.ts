// POST /api/admin/codes/parse —— 追溯码文件解析校验（PRD 5.5.2）
// 输入：{ content: string（文件文本，每行一个码）} 或 { codes: string[] }
import { MAX_CODES_PER_WRITE, WRITE_QUANTITY_ERROR } from '#shared/utils/code-limits'
import { requireBackendUser } from '../../../utils/auth'
import { validateImportRows } from '../../../utils/import-validation'
import { loadImportContext } from '../../../utils/import-context'

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

  const fid = user.role === 'platform_admin' ? undefined : Number(user.enterprise_id)
  const { context, products } = await loadImportContext(rawLines, fid)
  const batch = validateImportRows(rawLines, context)
  // 产品名映射
  const productNameMap = new Map(products.map((p: any) => [Number(p.id), p.name]))
  const productGroups = Object.entries(batch.productGroups).map(([pid, count]) => ({
    productId: Number(pid),
    productName: productNameMap.get(Number(pid)) || '未知产品',
    count,
  })).sort((a, b) => b.count - a.count)

  return {
    fileName: String(body.fileName || ''),
    total: batch.total,
    validCount: batch.accepted.length,
    invalidCount: batch.invalid + batch.duplicate,
    reasonCount: batch.reasonCount,
    productGroups,
    // API 调用方可取完整有效码；上传页面直接提交原文件，不重复传回大数组。
    validCodes: body.includeCodes === false ? undefined : batch.accepted,
    preview: batch.preview.map(r => ({
      lineNumber: r.lineNumber, code: r.code, valid: r.valid, reason: r.reason, matchedProductId: r.matchedProductId,
    })),
  }
})
