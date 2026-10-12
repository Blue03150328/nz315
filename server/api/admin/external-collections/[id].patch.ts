import { requireWritableUser } from '../../../utils/auth'
import { updateExternalCollection } from '../../../utils/external-collection-admin'
export default defineEventHandler(async event => updateExternalCollection(await requireWritableUser(event), String(getRouterParam(event, 'id')), await readBody(event) || {}))
