import { requireProductionDevice } from '../../../../utils/production-device-auth'
import { syncExternalCollection } from '../../../../utils/external-collection'
export default defineEventHandler(async event => syncExternalCollection(await requireProductionDevice(event), String(getRouterParam(event, 'id')), await readBody(event) || {}))
