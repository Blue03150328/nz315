import { requireProductionDevice } from '../../../utils/production-device-auth'
import { leaderRecordDetail } from '../../../utils/worker-records'
export default defineEventHandler(async event=>{const device=await requireProductionDevice(event);setHeader(event,'Cache-Control','no-store');return leaderRecordDetail(device,await readBody(event)||{})})
