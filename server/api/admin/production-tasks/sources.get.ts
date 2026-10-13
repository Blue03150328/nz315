import { requireBackendUser } from '../../../utils/auth'
import { productionSources } from '../../../utils/production-task'
export default defineEventHandler(async event => {
  const q = getQuery(event)
  return productionSources(await requireBackendUser(event), Number(q.productId || 0), Number(q.sourceUploadBatchId || 0))
})
