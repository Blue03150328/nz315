import { requireBackendUser } from '../../../../utils/auth'
import { exportUsageSelection } from '../../../../utils/usage-batch-bulk'
import { logOperation } from '../../../../utils/audit'
export default defineEventHandler(async event => {
  const user = await requireBackendUser(event), body = await readBody(event) || {}
  const result = await exportUsageSelection(user, body)
  setResponseHeaders(event, { 'Content-Type': body.format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="codes.txt"; filename*=UTF-8''${encodeURIComponent(result.filename)}`, 'Cache-Control': 'no-store' })
  await logOperation(event, { module: '码库管理', action: '批量导出', content: JSON.stringify({ count: result.count, format: body.format, previewHash: body.previewHash }) })
  return sendStream(event, result.stream)
})
