import { requireProductionDevice } from '../../../../../../../utils/production-device-auth'
import { startProductionUpload } from '../../../../../../../utils/production-uploads'
export default defineEventHandler(async event => startProductionUpload(await requireProductionDevice(event), Number(getRouterParam(event, 'id')), String(getRouterParam(event, 'sessionId')), await readBody(event) || {}))
