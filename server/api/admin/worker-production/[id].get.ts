import { requireBackendUser } from '../../../utils/auth'
import { workerDetails } from '../../../utils/worker-production'
export default defineEventHandler(async event=>{ const user=await requireBackendUser(event); return workerDetails(user,String(getRouterParam(event,'id')),getQuery(event)) })
