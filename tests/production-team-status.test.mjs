import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {parseEnv} from 'node:util'
import {teamDisplayStatusSql} from '../server/utils/production-team-status.ts'

// 仅用只读CTE构造数据，不读写真实业务表；按需开启真实MySQL语法与筛选验证。
test('生产任务展示状态与筛选一致，已结束和历史任务优先', {skip:process.env.NZ315_LIVE_STATUS_TEST!=='1'}, async()=>{
 const mysql=await import('mysql2/promise')
 const env=parseEnv(fs.readFileSync(process.env.NZ315_TEST_ENV||'.env','utf8'))
 const db=await mysql.createConnection({host:env.DB_HOST,port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD})
 const fixtures=`WITH
 tasks AS (
  SELECT 1 id,'line-team' workflow,'active' status UNION ALL
  SELECT 2,'line-team','active' UNION ALL SELECT 3,'line-team','active' UNION ALL
  SELECT 4,'line-team','active' UNION ALL SELECT 5,'line-team','completed' UNION ALL
  SELECT 6,'legacy','active' UNION ALL SELECT 7,'line-team','active' UNION ALL
  SELECT 8,'line-team','active' UNION ALL SELECT 9,'line-team','active' UNION ALL SELECT 10,'line-team','active'
 ),
 worker_run AS (SELECT 2 id,2 task_id UNION ALL SELECT 4,4 UNION ALL SELECT 7,7 UNION ALL SELECT 8,8 UNION ALL SELECT 9,9 UNION ALL SELECT 10,10),
 worker_session AS (SELECT 2 id,2 run_id,'active' state UNION ALL SELECT 4,4,'active' UNION ALL SELECT 7,7,'completed' UNION ALL SELECT 8,8,'active' UNION ALL SELECT 9,9,'active' UNION ALL SELECT 10,10,'active'),
 production_task_code AS (SELECT 3 task_id,'used' state UNION ALL SELECT 4,'used' UNION ALL SELECT 7,'used'),
 worker_event AS (SELECT 8 session_id,'external' classification,'saved' result_state UNION ALL SELECT 9,'external','duplicate' UNION ALL SELECT 10,'external','exception')`
 try{
  // 无设备且零码、设备参与但零码、有码但无设备、设备与码均有、零码已结束、历史、设备已结束会话。
  const [rows]=await db.query(`${fixtures} SELECT t.id,${teamDisplayStatusSql} AS display_status FROM tasks t ORDER BY t.id`)
  assert.deepEqual(rows.map(r=>r.display_status),['not_started','not_started','not_started','active','completed','history','active','active','not_started','not_started'])
  for(const [status,ids] of [['not_started',[1,2,3,9,10]],['active',[4,7,8]],['completed',[5]],['history',[6]]]){
   const [filtered]=await db.query(`${fixtures} SELECT t.id FROM tasks t WHERE (${teamDisplayStatusSql})=? ORDER BY t.id`,[status])
   assert.deepEqual(filtered.map(r=>r.id),ids)
  }
 }finally{await db.end()}
})
