import { requireBackendUser } from '../../../utils/auth'
import { exportExternalSelection } from '../../../utils/external-collection-admin'
export default defineEventHandler(async event => {
  const output = await exportExternalSelection(await requireBackendUser(event), await readBody(event) || {})
  setResponseHeaders(event, { 'Content-Type': output.contentType, 'Content-Disposition': `attachment; filename="external-codes.txt"; filename*=UTF-8''${encodeURIComponent(output.filename)}`, 'Cache-Control': 'no-store' })
  return sendStream(event, output.stream)
})
