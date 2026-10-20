import XLSX from 'xlsx'
import { query } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'
import { productFilters } from '../../../utils/product-filter'
import { logOperation } from '../../../utils/audit'
import { PRODUCT_EXPORT_HEADERS, productExportValues } from '#shared/utils/product-export'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const { whereSql, params } = productFilters(user, q)
  const products = await query<any[]>(
    `SELECT p.id, p.produce_type, p.registration_no, p.name, p.trademark, s.spec_code,
            s.spec_name, s.net_content, s.content_unit, s.pack_unit, s.pack_quantity
     FROM product p LEFT JOIN product_spec s ON s.id = p.spec_id ` + whereSql + ' ORDER BY p.id DESC LIMIT 50001', params)
  if (products.length > 50000) throw createError({ statusCode: 400, statusMessage: '导出超过50000条，请缩小产品筛选范围后重试' })
  // 显式按原药行id排序，确保同一产品的1～3列位置稳定，不依赖JSON聚合的隐式顺序。
  const originals = products.length ? await query<any[]>(
    'SELECT product_id, reg_no FROM product_original WHERE product_id IN (?) ORDER BY product_id, id',
    [products.map(row => row.id)]) : []
  const byProduct = new Map<number, string[]>()
  for (const row of originals) {
    const id = Number(row.product_id)
    const items = byProduct.get(id) || []
    items.push(String(row.reg_no ?? ''))
    byProduct.set(id, items)
  }
  const overflow = products.find(row => (byProduct.get(Number(row.id))?.length || 0) > 3)
  if (overflow) throw createError({ statusCode: 400, statusMessage: '产品「' + String(overflow.name).slice(0, 60) + '」原药超过3条，请先核对后导出，避免遗漏' })
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([PRODUCT_EXPORT_HEADERS,
    ...products.map(row => productExportValues(row, byProduct.get(Number(row.id)) || []))])
  ws['!cols'] = [{ wch: 18 }, { wch: 22 }, { wch: 36 }, { wch: 14 }, { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 60 }]
  ws['!autofilter'] = { ref: 'A1:H' + (products.length + 1) }
  XLSX.utils.book_append_sheet(wb, ws, '产品导出')
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(event, 'Content-Disposition', "attachment; filename=products.xlsx; filename*=UTF-8''" + encodeURIComponent('产品批量导出.xlsx'))
  setHeader(event, 'Cache-Control', 'no-store')
  await logOperation(event, { module: '产品管理', action: '批量导出产品', content: JSON.stringify({ count: products.length, filters: q }) })
  return buffer
})
