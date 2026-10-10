import { requireBackendUser } from '../../../utils/auth'
import { listDevices, activationServer } from '../../../utils/production-devices'
export default defineEventHandler(async event => {
  const user = await requireBackendUser(event)
  return listDevices(user)
})
