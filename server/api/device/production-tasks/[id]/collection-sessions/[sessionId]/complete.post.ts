import { requireProductionDevice } from '../../../../../../utils/production-device-auth'
import { completeCollection } from '../../../../../../utils/production-collection'
export default defineEventHandler(async event => { const user=await requireProductionDevice(event); return completeCollection(user,Number(getRouterParam(event,'id')),String(getRouterParam(event,'sessionId')),await readBody(event)||{}) })
