import {requireBackendUser} from '../../../utils/auth'
import {productionLineOverview} from '../../../utils/production-line-management'
export default defineEventHandler(async event=>productionLineOverview(await requireBackendUser(event),getQuery(event)))
