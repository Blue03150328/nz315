import XLSX from 'xlsx'
import { query } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'
import { specFilters } from '../../../utils/spec-filter'
import { logOperation } from '../../../utils/audit'
import { SPEC_EXPORT_HEADERS, SPEC_DETAIL_HEADERS, specExportValues, specDetailValues } from '#shared/utils/spec-transfer'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  const { whereSql, params } = await specFilters(user, q)
  const rows = await query<any[]>(
    'SELECT s.*, e.name AS enterprise_name FROM product_spec s LEFT JOIN enterprise e ON e.id = s.enterprise_id '
      + whereSql + ' ORDER BY s.id DESC LIMIT 50001', params)
  if (rows.length > 50000) throw createError({ statusCode: 400, statusMessage: '导出超过50000条，请缩小筛选范围后重试' })
  const wb = XLSX.utils.book_new()
  const values = rows.map(specExportValues)
  const invalid = values.findIndex(value => !value[0])
  if (invalid >= 0) throw createError({ statusCode: 400, statusMessage: '规格「' + String(rows[invalid].spec_name).slice(0, 60) + '」缺少可识别的净含量或包装数量，请先补全后导出' })
  const ws = XLSX.utils.aoa_to_sheet([SPEC_EXPORT_HEADERS, ...values])
  ws['!cols'] = [{ wch: 40 }]
  ws['!autofilter'] = { ref: 'A1:A' + (rows.length + 1) }
  XLSX.utils.book_append_sheet(wb, ws, '规格导出')
  const details = XLSX.utils.aoa_to_sheet([SPEC_DETAIL_HEADERS, ...rows.map(specDetailValues)])
  details['!cols'] = [{ wch: 32 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 40 }]
  XLSX.utils.book_append_sheet(wb, details, '规格明细')
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(event, 'Content-Disposition', "attachment; filename=specifications.xlsx; filename*=UTF-8''" + encodeURIComponent('规格导出.xlsx'))
  setHeader(event, 'Cache-Control', 'no-store')
  await logOperation(event, { module: '规格管理', action: '导出规格', content: JSON.stringify({ count: rows.length, filters: q }) })
  return buffer
})
