import { requireWritableUser } from '../../../../../utils/auth'
import { validScopeId } from '../../../../../utils/code-scope'
import { flagCodeScope } from '../../../../../utils/code-scope-management'
import { logOperation } from '../../../../../utils/audit'
export default defineEventHandler(async event => {
  const result = await flagCodeScope(await requireWritableUser(event), { usageBatchId: validScopeId(getRouterParam(event, 'id')) }, await readBody(event) || {})
  await logOperation(event, { module: '码库管理', action: '子批次' + result.flagLabel, content: JSON.stringify(result) })
  return result
})
