import { requireBackendUser } from '../../utils/auth'
import { productionTasks } from '../../utils/production-task'
export default defineEventHandler(async event => {
  const user = await requireBackendUser(event)
  const page = Math.max(1, Math.floor(Number(getQuery(event).page) || 1))
  return productionTasks(user, page)
})
