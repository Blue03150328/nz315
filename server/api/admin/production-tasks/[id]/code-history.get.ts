import { requireBackendUser } from '../../../../utils/auth'
import { productionCodeHistory } from '../../../../utils/production-task'
export default defineEventHandler(async event => productionCodeHistory(await requireBackendUser(event), Number(getRouterParam(event, 'id')), Number(getQuery(event).codeId)))
