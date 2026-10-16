import { requireProductionDevice } from '../../../utils/production-device-auth'
import { leaderRecordExport } from '../../../utils/worker-records'
export default defineEventHandler(async event=>{const device=await requireProductionDevice(event);setHeader(event,'Cache-Control','no-store');return leaderRecordExport(device,await readBody(event)||{})})
