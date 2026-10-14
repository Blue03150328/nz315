import {requireWritableUser} from '../../../utils/auth'
import {saveProductionLine} from '../../../utils/production-line-management'
export default defineEventHandler(async event=>saveProductionLine(await requireWritableUser(event),await readBody(event)||{},true))
