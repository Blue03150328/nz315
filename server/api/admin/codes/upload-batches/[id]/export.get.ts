import { requireBackendUser } from '../../../../../utils/auth'
import { validScopeId } from '../../../../../utils/code-scope'
import { exportCodeScope, remainingScope } from '../../../../../utils/code-scope-management'
export default defineEventHandler(async event => exportCodeScope(event, await requireBackendUser(event), { uploadBatchId: validScopeId(getRouterParam(event, 'id')), remaining: remainingScope(getQuery(event).scope) }, String(getQuery(event).format || 'txt')))
