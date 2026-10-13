import {requireProductionDevice} from '../../utils/production-device-auth'
import {workerDownloadUser} from '../../utils/worker-production'
import {query} from '../../utils/db'
import {teamScope} from '../../utils/production-team'
export default defineEventHandler(async event=>{
 const body=await readBody(event)||{},device=await requireProductionDevice(event),user=await workerDownloadUser(device,String(body.grant||'')),id=Number(body.taskId)
 const [task]=await query<any[]>('SELECT * FROM production_task WHERE id=?',[id]);teamScope(user,task)
 if(task.workflow==='line-team'){const [member]=await query<any[]>('SELECT user_id FROM production_task_member WHERE task_id=? AND user_id=?',[id,user.id]);if(!member)throw createError({statusCode:403,statusMessage:'未安排在这条生产线上'})}
 const [counts]=await query<any[]>("SELECT COUNT(*) AS total,SUM(state='used') AS collected FROM production_task_code WHERE task_id=?",[id])
 return {ok:true,taskId:id,name:task.name,lineName:task.line_name,total:Number(counts.total),collected:Number(counts.collected)||0,status:task.status}
})
