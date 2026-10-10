import { requireWritableUser } from '../../../../../../utils/auth'
import { syncCollection } from '../../../../../../utils/production-collection'
export default defineEventHandler(async event => {
  const user = await requireWritableUser(event)
  return syncCollection(user, Number(getRouterParam(event, 'id')), String(getRouterParam(event, 'sessionId')), await readBody(event) || {})
})
