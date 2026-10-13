import { requireBackendUser } from '../../../../utils/auth'
import { exportWorkerTxt,workerDownloadUser } from '../../../../utils/worker-production'
export default defineEventHandler(async event=>{const user=await requireBackendUser(event);const id=String(getRouterParam(event,'id'));const text=await exportWorkerTxt(user,id,String(getQuery(event).classification||'all'));setHeader(event,'Content-Type','text/plain; charset=utf-8');setHeader(event,'Content-Disposition','attachment; filename=external-'+id+'.txt');setHeader(event,'Cache-Control','no-store');return text})
