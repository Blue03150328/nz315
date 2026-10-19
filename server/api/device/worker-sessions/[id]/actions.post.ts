import { requireProductionDevice } from '../../../../utils/production-device-auth'
import { appendWorkerActions } from '../../../../utils/worker-records'
export default defineEventHandler(async event=>appendWorkerActions(await requireProductionDevice(event),String(getRouterParam(event,'id')),await readBody(event)||{}))
