import { requireWritableUser } from '../../../../utils/auth'
import { resolveLineException } from '../../../../utils/line-production'
export default defineEventHandler(async event=>resolveLineException(await requireWritableUser(event),Number(getRouterParam(event,'id')),await readBody(event)||{}))
