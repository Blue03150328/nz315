import type { AuthUser } from './auth'
/** 列表、预览与事务使用相同的上传范围前置条件。 */
export function uploadCorrectionBlock(user:AuthUser,row:any):string|null{
 if(user.role==='viewer'||(Number(row.task_created_by)!==user.id&&!['platform_admin','enterprise_admin'].includes(user.role)))return '仅管理员或任务创建人可以修正本次上传'
 if(row.task_status==='active'||!row.ended_at)return '请先在后台结束关联生产任务'
 if(row.upload_state!=='completed')return '请先完成本次上传'
 if(row.source_kind==='worker'){
  if(row.worker_session_state!=='completed'||row.run_state!=='sealed'||row.final_sequence==null||Number(row.final_sequence)!==Number(row.last_sequence))return '请先在设备结束这次采集并同步完整结束标记'
 }else if(row.legacy_session_state!=='completed')return '请先结束这次设备采集并完成同步'
 if(!Number(row.code_total))return '本次上传没有可修正的码'
 if(Number(row.voided_count))return '本次上传含已作废码，不能修正'
 if(Number(row.frozen_count))return '本次上传含冻结码，请先恢复正常'
 return null
}
