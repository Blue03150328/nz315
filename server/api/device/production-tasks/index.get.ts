import { requireProductionDevice } from '../../../utils/production-device-auth'
import { productionTasks } from '../../../utils/production-task'
export default defineEventHandler(async event => productionTasks(await requireProductionDevice(event), Math.max(1,Math.floor(Number(getQuery(event).page)||1))))
