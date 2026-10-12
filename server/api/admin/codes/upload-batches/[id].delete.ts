import { requireWritableUser } from '../../../../utils/auth'
import { validScopeId } from '../../../../utils/code-scope'
import { deleteCodeScope, remainingScope } from '../../../../utils/code-scope-management'
import { logOperation } from '../../../../utils/audit'
export default defineEventHandler(async event => {
  const selection = { uploadBatchId: validScopeId(getRouterParam(event, 'id')), remaining: remainingScope(getQuery(event).scope) }
  const result = await deleteCodeScope(await requireWritableUser(event), selection)
  await logOperation(event, { module: '码库管理', action: selection.remaining ? '删除剩余码' : '删除上传批次', content: JSON.stringify(result) })
  return result
})
