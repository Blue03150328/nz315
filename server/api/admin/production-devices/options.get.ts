import { requireBackendUser } from '../../../utils/auth'
import { deviceOptions, activationServer } from '../../../utils/production-devices'
export default defineEventHandler(async event => {
  const user = await requireBackendUser(event)
  return deviceOptions(user)
})
