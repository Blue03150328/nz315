import { Readable } from 'node:stream'
import { requireImportReport } from '../../../../utils/import-report'
import { query } from '../../../../utils/db'
import { csvCell } from '#shared/utils/import-csv'
export default defineEventHandler(async event => {
  const report = await requireImportReport(event)
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', 'attachment; filename="import-rejections-' + report.reportId + '.csv"')
  setHeader(event, 'Cache-Control', 'private, no-store')
  async function* lines() {
    yield '\uFEFF原始行号,追溯码或输入片段,原因代码,失败原因\r\n'
    let lastLine = 0
    while (true) {
      const rows = await query<any[]>('SELECT line_number, code, reason_code, reason FROM import_rejection WHERE report_id = ? AND line_number > ? ORDER BY line_number LIMIT 1000', [report.reportId, lastLine])
      if (!rows.length) break
      for (const row of rows) yield [row.line_number, row.code, row.reason_code, row.reason].map(csvCell).join(',') + '\r\n'
      lastLine = Number(rows[rows.length - 1].line_number)
    }
  }
  return sendStream(event, Readable.from(lines()))
})
