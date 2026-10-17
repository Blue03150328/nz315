import { requireWritableUser } from '../../../utils/auth'
import { query } from '../../../utils/db'
import { fillProductTemplate } from '../../../utils/product-template'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const fid = user.role === 'platform_admin' ? Number(getQuery(event).enterpriseId) : Number(user.enterprise_id)
  if (!Number.isSafeInteger(fid) || fid <= 0) throw createError({ statusCode: 400, statusMessage: '请先选择产品归属企业，再下载本企业模板' })
  const [enterprise] = await query<any[]>('SELECT name FROM enterprise WHERE id = ?', [fid])
  if (!enterprise) throw createError({ statusCode: 400, statusMessage: '归属企业不存在' })
  const specs = await query<any[]>('SELECT spec_code, spec_name FROM product_spec WHERE enterprise_id = ? AND status = 1 ORDER BY spec_code', [fid])
  const source = await useStorage('assets:server').getItemRaw<Buffer>('product-import-template.xlsx')
  if (!source) throw createError({ statusCode: 503, statusMessage: '产品模板暂不可用，请稍后重试' })
  const buffer = fillProductTemplate(Buffer.from(source), specs, String(enterprise.name))
  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(event, 'Content-Disposition', "attachment; filename=product-import-template.xlsx; filename*=UTF-8''" + encodeURIComponent('产品导入模板.xlsx'))
  setHeader(event, 'Cache-Control', 'no-store')
  return buffer
})
