import { requireProductionDevice } from '../../../utils/production-device-auth'
import { startExternalCollection } from '../../../utils/external-collection'
export default defineEventHandler(async event => startExternalCollection(await requireProductionDevice(event), await readBody(event) || {}))
