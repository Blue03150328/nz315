import { requireBackendUser } from '../../../utils/auth'
import { previewExternalExport } from '../../../utils/external-collection-admin'
export default defineEventHandler(async event => previewExternalExport(await requireBackendUser(event), (await readBody(event))?.selection))
