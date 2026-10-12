import { requireBackendUser } from '../../utils/auth'
import { listExternalCodes } from '../../utils/external-collection-admin'
export default defineEventHandler(async event => listExternalCodes(await requireBackendUser(event), getQuery(event)))
