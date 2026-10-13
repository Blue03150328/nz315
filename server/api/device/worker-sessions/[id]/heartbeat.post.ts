import {requireProductionDevice} from '../../../../utils/production-device-auth'
import {workerHeartbeat} from '../../../../utils/worker-production'
export default defineEventHandler(async event=>workerHeartbeat(await requireProductionDevice(event),String(getRouterParam(event,'id')),await readBody(event)||{}))
