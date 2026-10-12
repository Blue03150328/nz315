import { requireWritableUser } from '../../../../utils/auth'
import { scanProductionCode } from '../../../../utils/production-task'
export default defineEventHandler(async event => {
  const user = await requireWritableUser(event)
  return scanProductionCode(user, Number(getRouterParam(event, 'id')), await readBody(event) || {})
})
