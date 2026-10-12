import { requireWritableUser } from '../../../../utils/auth'
import { appendProductionTask } from '../../../../utils/production-task'
export default defineEventHandler(async event => appendProductionTask(await requireWritableUser(event), Number(getRouterParam(event, 'id')), await readBody(event) || {}))
