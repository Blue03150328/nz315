import { requireWritableUser } from '../../utils/auth'
import { createProductionTask } from '../../utils/production-task'
export default defineEventHandler(async event => {
  const user = await requireWritableUser(event)
  return createProductionTask(user, await readBody(event) || {})
})
