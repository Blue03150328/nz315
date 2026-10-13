import { requireWritableUser } from '../../../utils/auth'
import { deleteExternalCollection } from '../../../utils/external-collection-admin'

export default defineEventHandler(async event => deleteExternalCollection(await requireWritableUser(event), String(getRouterParam(event, 'id'))))
