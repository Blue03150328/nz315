import { requireWritableUser } from '../../../../utils/auth'
import { flagUsageSelection } from '../../../../utils/usage-batch-bulk'
export default defineEventHandler(async event => flagUsageSelection(await requireWritableUser(event), await readBody(event) || {}))
