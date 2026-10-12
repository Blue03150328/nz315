import { requireBackendUser } from '../../../../utils/auth'
import { reviewWorkerRun } from '../../../../utils/worker-production'
export default defineEventHandler(async event=>{ const user=await requireBackendUser(event); return reviewWorkerRun(user,String(getRouterParam(event,'id')),await readBody(event)||{}) })
