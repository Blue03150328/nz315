import { requireWritableUser } from '../../../../../../../utils/auth'
import { startProductionUpload } from '../../../../../../../utils/production-uploads'
export default defineEventHandler(async event => startProductionUpload(await requireWritableUser(event), Number(getRouterParam(event, 'id')), String(getRouterParam(event, 'sessionId')), await readBody(event) || {}))
