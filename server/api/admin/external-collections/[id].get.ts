import { requireBackendUser } from '../../../utils/auth'
import { externalCollectionDetail } from '../../../utils/external-collection-admin'
export default defineEventHandler(async event => externalCollectionDetail(await requireBackendUser(event), String(getRouterParam(event, 'id')), getQuery(event)))
