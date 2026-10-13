import { requireBackendUser } from '../../../../../utils/auth'
import { validScopeId } from '../../../../../utils/code-scope'
import { usageBatchCorrectionPreview } from '../../../../../utils/code-usage-batches'
export default defineEventHandler(async event => usageBatchCorrectionPreview(await requireBackendUser(event), validScopeId(getRouterParam(event, 'id'))))
