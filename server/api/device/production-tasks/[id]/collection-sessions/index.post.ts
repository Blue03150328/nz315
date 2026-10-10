import { requireProductionDevice } from '../../../../../utils/production-device-auth'
import { startCollection } from '../../../../../utils/production-collection'
export default defineEventHandler(async event => { const user=await requireProductionDevice(event); return startCollection(user,Number(getRouterParam(event,'id')),await readBody(event)||{}) })
