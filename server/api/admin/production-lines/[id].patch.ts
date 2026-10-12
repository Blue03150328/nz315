import {requireWritableUser} from '../../../utils/auth'
import {updateTeamTask} from '../../../utils/production-team'
export default defineEventHandler(async event=>updateTeamTask(await requireWritableUser(event),Number(getRouterParam(event,'id')),await readBody(event)||{}))
