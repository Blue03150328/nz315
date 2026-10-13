import { requireBackendUser } from '../../../../../utils/auth'
import { validScopeId } from '../../../../../utils/code-scope'
import { exportCodeScope } from '../../../../../utils/code-scope-management'
export default defineEventHandler(async event => exportCodeScope(event, await requireBackendUser(event), { usageBatchId: validScopeId(getRouterParam(event, 'id')) }, String(getQuery(event).format || 'txt')))
