import { requireWritableUser } from '../../../utils/auth'
import { editProductionTask } from '../../../utils/production-task'
export default defineEventHandler(async event => editProductionTask(await requireWritableUser(event), Number(getRouterParam(event, 'id')), await readBody(event) || {}))
