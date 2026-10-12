import { requireBackendUser } from '../../../utils/auth'
import { changeDevice, activationServer } from '../../../utils/production-devices'
export default defineEventHandler(async event => {
  const user = await requireBackendUser(event)
  return changeDevice(user, Number(getRouterParam(event,'id')), await readBody(event) || {}, activationServer(event))
})
