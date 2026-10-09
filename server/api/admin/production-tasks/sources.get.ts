import { requireBackendUser } from '../../../utils/auth'
import { productionSources } from '../../../utils/production-task'
export default defineEventHandler(async event => productionSources(await requireBackendUser(event), Number(getQuery(event).productId)))
