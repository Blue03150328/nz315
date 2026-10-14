import {requireWritableUser} from '../../../utils/auth'
import {deleteProductionLines} from '../../../utils/production-line-management'
export default defineEventHandler(async event=>deleteProductionLines(await requireWritableUser(event),await readBody(event)||{}))
