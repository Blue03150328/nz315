import { requireWritableUser } from '../../../../utils/auth'
import { endProductionTask } from '../../../../utils/production-task'
export default defineEventHandler(async event => {
  const user = await requireWritableUser(event)
  return endProductionTask(user, Number(getRouterParam(event, 'id')))
})
