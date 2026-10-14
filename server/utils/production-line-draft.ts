/** 只清理无产品/批次/领用码、无任何设备会话或上传的预建任务，初始人员安排和日志保留。 */
export const emptyLineDraftSql=`t.status='active' AND t.workflow='line-team' AND t.product_id IS NULL AND t.batch_id IS NULL AND t.source_upload_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM production_task_code c WHERE c.task_id=t.id)
 AND NOT EXISTS(SELECT 1 FROM worker_run r WHERE r.task_id=t.id)
 AND NOT EXISTS(SELECT 1 FROM production_collection_session s WHERE s.task_id=t.id)
 AND NOT EXISTS(SELECT 1 FROM production_collection_upload u WHERE u.task_id=t.id)`
