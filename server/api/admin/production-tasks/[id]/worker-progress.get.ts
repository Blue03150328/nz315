import { requireBackendUser } from '../../../../utils/auth'
import { lineWorkerProgress } from '../../../../utils/line-production'
export default defineEventHandler(async event=>lineWorkerProgress(await requireBackendUser(event),Number(getRouterParam(event,'id')),getQuery(event)))
