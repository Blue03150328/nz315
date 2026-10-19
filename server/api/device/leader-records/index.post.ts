import { requireProductionDevice } from '../../../utils/production-device-auth'
import { leaderRecords } from '../../../utils/worker-records'
export default defineEventHandler(async event=>{const device=await requireProductionDevice(event);setHeader(event,'Cache-Control','no-store');return leaderRecords(device,await readBody(event)||{})})
