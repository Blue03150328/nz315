import { requireBackendUser } from '../../../../utils/auth'
import { deviceHistory, activationServer } from '../../../../utils/production-devices'
export default defineEventHandler(async event => {
  const user = await requireBackendUser(event)
  return deviceHistory(user, Number(getRouterParam(event,'id')))
})
