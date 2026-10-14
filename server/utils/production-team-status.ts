// 仅计算列表展示状态，保留任务原状态供领用、编辑和结束守卫使用。
// 参与过的设备会话完成后仍算参与，不能因设备结束会话而退回“未开始”。
export const teamDisplayStatusSql = `CASE
 WHEN t.workflow<>'line-team' THEN 'history'
 WHEN t.status<>'active' THEN t.status
 WHEN NOT EXISTS(SELECT 1 FROM worker_session s JOIN worker_run r ON r.id=s.run_id WHERE r.task_id=t.id)
   OR NOT EXISTS(SELECT 1 FROM production_task_code d WHERE d.task_id=t.id AND d.state='used') THEN 'not_started'
 ELSE 'active' END`
