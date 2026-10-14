import { requireBackendUser } from '../../../../utils/auth'
import { previewUsageSelection } from '../../../../utils/usage-batch-bulk'
export default defineEventHandler(async event => previewUsageSelection(await requireBackendUser(event), (await readBody(event))?.selection))
