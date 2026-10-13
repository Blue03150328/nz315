import { requireWritableUser } from '../../../../../utils/auth'
import { validScopeId } from '../../../../../utils/code-scope'
import { flagCodeScope, remainingScope } from '../../../../../utils/code-scope-management'
import { logOperation } from '../../../../../utils/audit'
export default defineEventHandler(async event => {
  const user = await requireWritableUser(event), body = await readBody(event) || {}
  const selection = { uploadBatchId: validScopeId(getRouterParam(event, 'id')), remaining: remainingScope(body.scope ?? getQuery(event).scope) }
  const result = await flagCodeScope(user, selection, body)
  await logOperation(event, { module: '码库管理', action: (selection.remaining ? '剩余码' : '整批') + result.flagLabel, content: JSON.stringify(result) })
  return result
})
