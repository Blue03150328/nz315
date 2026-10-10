import { requireWritableUser } from '../../../../../utils/auth'
import { startCollection } from '../../../../../utils/production-collection'
export default defineEventHandler(async event => {
  const user = await requireWritableUser(event)
  return startCollection(user, Number(getRouterParam(event, 'id')), await readBody(event) || {})
})
