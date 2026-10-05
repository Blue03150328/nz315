import { requireImportReport } from '../../../../utils/import-report'
import { query } from '../../../../utils/db'
export default defineEventHandler(async event => {
  const report = await requireImportReport(event)
  const q = getQuery(event)
  const page = Math.max(1, Math.floor(Number(q.page) || 1))
  const pageSize = 20
  const rows = await query<any[]>('SELECT line_number AS lineNumber, code, reason_code AS reasonCode, reason FROM import_rejection WHERE report_id = ? ORDER BY line_number LIMIT ? OFFSET ?', [report.reportId, pageSize, (page - 1) * pageSize])
  return { rows, page, pageSize, total: (report.skippedInvalid || 0) + (report.skippedDup || 0) }
})
