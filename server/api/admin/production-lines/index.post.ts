import {requireWritableUser} from '../../../utils/auth'
import {createTeamTask} from '../../../utils/production-team'
export default defineEventHandler(async event=>createTeamTask(await requireWritableUser(event),await readBody(event)||{}))
