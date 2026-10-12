import {requireBackendUser} from '../../../utils/auth'
import {teamTasks} from '../../../utils/production-team'
export default defineEventHandler(async event=>teamTasks(await requireBackendUser(event),getQuery(event)))
