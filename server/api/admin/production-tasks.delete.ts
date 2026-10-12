import { requireWritableUser } from '../../utils/auth'
import { deleteProductionTasks } from '../../utils/production-task-delete'

export default defineEventHandler(async event => {
  const user = await requireWritableUser(event)
  const body = await readBody(event)
  return deleteProductionTasks(user, body?.ids)
})
