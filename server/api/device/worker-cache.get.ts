import { requireProductionDevice } from '../../utils/production-device-auth'
import { workerCache } from '../../utils/worker-production'
export default defineEventHandler(async event=>{ const user=await requireProductionDevice(event); return workerCache(user,getQuery(event)) })
