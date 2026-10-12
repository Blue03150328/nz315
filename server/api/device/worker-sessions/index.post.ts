import { requireProductionDevice } from '../../../utils/production-device-auth'
import { openWorkerSession } from '../../../utils/worker-production'
export default defineEventHandler(async event=>{ const user=await requireProductionDevice(event); return openWorkerSession(user,await readBody(event)||{}) })
