import { requireWritableUser } from '../../../utils/auth'
import { getPool } from '../../../utils/db'
import { readProductImport } from '../../../utils/product-import-input'
import { importProducts } from '../../../utils/product-import'
import { logOperation } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const parts = await readMultipartFormData(event).catch(() => undefined)
  const files = parts?.filter(part => part.filename !== undefined) || []
  if (files.length !== 1 || !files[0]?.data.length) throw createError({ statusCode: 400, statusMessage: '请选择一个产品 Excel 文件' })
  const file = files[0]
  if (!/\.(xlsx|xls)$/i.test(file.filename || '')) throw createError({ statusCode: 400, statusMessage: '仅支持.xlsx或.xls文件' })
  if (file.data.length > 10 * 1024 * 1024) throw createError({ statusCode: 400, statusMessage: '文件过大（上限10MB）' })
  const fid = user.role === 'platform_admin'
    ? Number(parts?.find(part => !part.filename && part.name === 'enterpriseId')?.data.toString().trim())
    : Number(user.enterprise_id)
  if (!Number.isSafeInteger(fid) || fid <= 0) throw createError({ statusCode: 400, statusMessage: '请选择产品归属企业' })
  const rows = readProductImport(file.data)
  const conn = await getPool().getConnection()
  let result
  try { result = await importProducts(conn, fid, rows) } finally { conn.release() }
  await logOperation(event, { module: '产品管理', action: '批量导入产品', content: JSON.stringify({
    enterpriseId: fid, fileName: file.filename, success: result.success, createdSpecs: result.createdSpecs,
    failed: result.failed, warningCount: result.warnings.length,
    firstErrors: result.errors.slice(0, 10).map(({ row, value, reason }) => ({ row, value, reason })),
  }) })
  return result
})
