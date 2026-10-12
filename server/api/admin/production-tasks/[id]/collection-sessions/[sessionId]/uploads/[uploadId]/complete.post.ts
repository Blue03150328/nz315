import { requireWritableUser } from '../../../../../../../../utils/auth'
import { completeProductionUpload } from '../../../../../../../../utils/production-uploads'
export default defineEventHandler(async event => completeProductionUpload(await requireWritableUser(event), Number(getRouterParam(event, 'id')), String(getRouterParam(event, 'sessionId')), String(getRouterParam(event, 'uploadId')), await readBody(event) || {}))
