import { requireProductionDevice } from '../../../../utils/production-device-auth'
import { syncWorkerEvents } from '../../../../utils/worker-production'
export default defineEventHandler(async event=>{ const user=await requireProductionDevice(event); return syncWorkerEvents(user,String(getRouterParam(event,'id')),await readBody(event)||{}) })
