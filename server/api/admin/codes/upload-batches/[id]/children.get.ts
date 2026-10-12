import { requireBackendUser } from '../../../../../utils/auth'
import { validScopeId } from '../../../../../utils/code-scope'
import { usageBatchChildren } from '../../../../../utils/code-usage-batches'
export default defineEventHandler(async event => {
  const q = getQuery(event), page = Math.max(1, Math.trunc(Number(q.page) || 1)), pageSize = Math.min(100, Math.max(1, Math.trunc(Number(q.pageSize) || 10)))
  return usageBatchChildren(await requireBackendUser(event), validScopeId(getRouterParam(event, 'id')), page, pageSize)
})
