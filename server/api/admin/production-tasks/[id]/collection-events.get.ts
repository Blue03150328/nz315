import { requireBackendUser } from '../../../../utils/auth'
import { collectionAnomalies } from '../../../../utils/production-collection'
export default defineEventHandler(async event => {
  const user = await requireBackendUser(event)
  const page = Number(getQuery(event).page || 1)
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw createError({ statusCode: 400, statusMessage: '页码无效' })
  return collectionAnomalies(user, Number(getRouterParam(event, 'id')), page)
})
