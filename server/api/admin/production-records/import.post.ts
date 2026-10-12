import { requireWritableUser } from '../../../utils/auth'
import { importLineRecords } from '../../../utils/line-offline-import'
export default defineEventHandler(async event=>importLineRecords(await requireWritableUser(event),await readBody(event)||{}))
