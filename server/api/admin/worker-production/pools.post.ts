import { requireBackendUser } from '../../../utils/auth'
import { assignWorkerPool } from '../../../utils/worker-production'
export default defineEventHandler(async event=>{ const user=await requireBackendUser(event); return assignWorkerPool(user,await readBody(event)||{}) })
