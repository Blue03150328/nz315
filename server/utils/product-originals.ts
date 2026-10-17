import { PRODUCT_MAX_ORIGINALS } from '#shared/utils/product-import'

export function parseProductOriginals(input: unknown) {
  if (!Array.isArray(input) || !input.length) throw createError({ statusCode: 400, statusMessage: '原药信息至少保留 1 行' })
  if (input.length > PRODUCT_MAX_ORIGINALS) throw createError({ statusCode: 400, statusMessage: '原药最多填写3种' })
  const rows = input.map(row => ({
    ingredient: String(row?.ingredient || '').trim(),
    regNo: String(row?.regNo || '').trim(),
    company: String(row?.company || '').trim(),
  })).filter(row => row.ingredient || row.regNo || row.company)
  if (!rows.length) throw createError({ statusCode: 400, statusMessage: '原药信息至少保留 1 行有效记录' })
  for (const row of rows) {
    if (!row.regNo || !row.company) throw createError({ statusCode: 400, statusMessage: '原药登记证号与原药生产企业名称需同时填写' })
    if (row.ingredient.length > 120 || row.regNo.length > 40 || row.company.length > 255) throw createError({ statusCode: 400, statusMessage: '原药有效成分最多120字、登记证号最多40字、生产企业最多255字' })
  }
  return rows
}
