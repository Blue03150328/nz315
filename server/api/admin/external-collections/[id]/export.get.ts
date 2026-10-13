import { sendStream, setResponseHeader } from 'h3'
import { requireBackendUser } from '../../../../utils/auth'
import { exportExternalCollection } from '../../../../utils/external-collection-admin'
export default defineEventHandler(async event => {
  const result = await exportExternalCollection(await requireBackendUser(event), String(getRouterParam(event, 'id')), getQuery(event).format)
  setResponseHeader(event, 'Content-Type', result.contentType)
  setResponseHeader(event, 'Content-Disposition', 'attachment; filename="external-codes.' + String(getQuery(event).format) + '"; filename*=UTF-8\'\'' + encodeURIComponent(result.filename))
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return sendStream(event, result.stream)
})
