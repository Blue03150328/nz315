import { requireProductionDevice, assertDeviceTask } from '../../../utils/production-device-auth'
import { productionTaskDetail } from '../../../utils/production-task'
import { getPool } from '../../../utils/db'
export default defineEventHandler(async event => {
  const user=await requireProductionDevice(event), id=Number(getRouterParam(event,'id'))
  const result=await productionTaskDetail(user,id,'',1)
  await assertDeviceTask(getPool(),user,result.task)
  return { task: result.task }
})
