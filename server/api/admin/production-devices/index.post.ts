import { requireBackendUser } from '../../../utils/auth'
import { addDevice, activationServer } from '../../../utils/production-devices'
export default defineEventHandler(async event => {
  const user = await requireBackendUser(event)
  return addDevice(user, await readBody(event) || {}, activationServer(event))
})
