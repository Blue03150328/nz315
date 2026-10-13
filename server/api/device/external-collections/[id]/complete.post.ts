import { requireProductionDevice } from '../../../../utils/production-device-auth'
import { completeExternalCollection } from '../../../../utils/external-collection'
export default defineEventHandler(async event => completeExternalCollection(await requireProductionDevice(event), String(getRouterParam(event, 'id')), await readBody(event) || {}))
