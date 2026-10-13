import { requireProductionDevice } from '../../../utils/production-device-auth'
import { workerCheck } from '../../../utils/worker-production'
export default defineEventHandler(async event=>{ const user=await requireProductionDevice(event); return workerCheck(user,String((await readBody(event)||{}).grant||'')) })
