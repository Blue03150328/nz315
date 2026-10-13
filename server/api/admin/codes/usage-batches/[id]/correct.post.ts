import { requireWritableUser } from '../../../../../utils/auth'
import { validScopeId } from '../../../../../utils/code-scope'
import { correctUsageBatchProduction } from '../../../../../utils/code-usage-batches'
import { logOperation } from '../../../../../utils/audit'
export default defineEventHandler(async event => {
  const result = await correctUsageBatchProduction(await requireWritableUser(event), validScopeId(getRouterParam(event, 'id')), await readBody(event) || {})
  if (!result.duplicate) await logOperation(event, { module: '码库管理', action: '本次上传更正生产资料', content: JSON.stringify(result) })
  return result
})
