import { requireBackendUser } from '../../../utils/auth'
import { productionTaskDetail } from '../../../utils/production-task'
export default defineEventHandler(async event => {
  const user = await requireBackendUser(event)
  const q = getQuery(event)
  return productionTaskDetail(user, Number(getRouterParam(event, 'id')), String(q.state || ''), Math.max(1, Math.floor(Number(q.page) || 1)))
})
