import { activateDevice } from '../../utils/production-devices'
import { allowRequest } from '../../utils/rate-limit'
import { clientIpOf } from '../../utils/audit'
export default defineEventHandler(async event => {
  if(!allowRequest('device-activate:'+clientIpOf(event),60,60000))throw createError({statusCode:429,statusMessage:'激活请求过于频繁，请稍后重试'})
  return activateDevice(await readBody(event) || {})
})
