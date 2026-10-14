import {requireBackendUser} from '../../../utils/auth'
import {productionLineOptions} from '../../../utils/production-line-management'
export default defineEventHandler(async event=>productionLineOptions(await requireBackendUser(event)))
