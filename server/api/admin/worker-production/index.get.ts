import { requireBackendUser } from '../../../utils/auth'
import { workerAdminList } from '../../../utils/worker-production'
export default defineEventHandler(async event=>{ const user=await requireBackendUser(event); return workerAdminList(user,getQuery(event)) })
