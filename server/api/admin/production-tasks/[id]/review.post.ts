import { requireWritableUser } from '../../../../utils/auth'
import { reviewProductionTask } from '../../../../utils/production-task'
export default defineEventHandler(async event => {
  const user = await requireWritableUser(event)
  return reviewProductionTask(user, Number(getRouterParam(event, 'id')), await readBody(event) || {})
})
