import { requireProductionDevice } from '../../../../../../../../utils/production-device-auth'
import { completeProductionUpload } from '../../../../../../../../utils/production-uploads'
export default defineEventHandler(async event => completeProductionUpload(await requireProductionDevice(event), Number(getRouterParam(event, 'id')), String(getRouterParam(event, 'sessionId')), String(getRouterParam(event, 'uploadId')), await readBody(event) || {}))
