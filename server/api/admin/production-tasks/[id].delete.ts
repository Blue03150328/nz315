import { requireWritableUser } from '../../../utils/auth'
import { deleteProductionTasks } from '../../../utils/production-task-delete'

export default defineEventHandler(async event => {
  const user = await requireWritableUser(event)
  const id = getRouterParam(event, 'id') || ''
  if (!/^[1-9]\d*$/.test(id)) throw createError({ statusCode: 400, statusMessage: '任务编号无效' })
  return deleteProductionTasks(user, [Number(id)])
})
