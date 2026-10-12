import { requireProductionDevice } from '../../../../utils/production-device-auth'
import { finishWorkerRun } from '../../../../utils/worker-production'
export default defineEventHandler(async event=>{ const user=await requireProductionDevice(event); return finishWorkerRun(user,String(getRouterParam(event,'id')),await readBody(event)||{}) })
