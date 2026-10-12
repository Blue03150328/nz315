import {requireBackendUser} from '../../../utils/auth'
import {teamOptions} from '../../../utils/production-team'
export default defineEventHandler(async event=>teamOptions(await requireBackendUser(event),String(getQuery(event).keyword||'')))
