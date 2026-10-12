import { requireWritableUser } from '../../../../utils/auth'
import { validScopeId } from '../../../../utils/code-scope'
import { deleteCodeScope } from '../../../../utils/code-scope-management'
import { logOperation } from '../../../../utils/audit'
export default defineEventHandler(async event => {
  const result = await deleteCodeScope(await requireWritableUser(event), { usageBatchId: validScopeId(getRouterParam(event, 'id')) })
  await logOperation(event, { module: '码库管理', action: '删除子批次', content: JSON.stringify(result) })
  return result
})
