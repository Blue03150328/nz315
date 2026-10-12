import { requireBackendUser } from '../../../utils/auth'
import { query } from '../../../utils/db'
export default defineEventHandler(async event=>{
  const user=await requireBackendUser(event),cond=user.role==='platform_admin'?'':' AND enterprise_id=?',params=user.role==='platform_admin'?[]:[user.enterprise_id]
  const rows=await query<any[]>(`SELECT DISTINCT enterprise_id,line_name FROM production_task WHERE line_name<>''${cond} UNION SELECT DISTINCT enterprise_id,line_name FROM production_device WHERE deleted_at IS NULL${cond} ORDER BY enterprise_id,line_name`,[...params,...params])
  return {rows}
})
