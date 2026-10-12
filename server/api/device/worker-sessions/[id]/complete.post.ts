import { requireProductionDevice } from '../../../../utils/production-device-auth'
import { finishWorkerSession } from '../../../../utils/worker-production'
export default defineEventHandler(async event=>{ const user=await requireProductionDevice(event); return finishWorkerSession(user,String(getRouterParam(event,'id')),await readBody(event)||{}) })
