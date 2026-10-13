import { requireBackendUser } from '../../utils/auth'
import { listExternalCollections } from '../../utils/external-collection-admin'
export default defineEventHandler(async event => listExternalCollections(await requireBackendUser(event), getQuery(event)))
