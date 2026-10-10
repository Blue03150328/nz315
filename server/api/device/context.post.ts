import { requireProductionDevice } from '../../utils/production-device-auth'
import { deviceContext } from '../../utils/production-devices'
export default defineEventHandler(async event => deviceContext(await requireProductionDevice(event),await readBody(event) || {}))
