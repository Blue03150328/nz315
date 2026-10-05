// 本机验收会创建带唯一名称的测试批次和报告，结束时仅按本轮编号清理。
import fs from 'node:fs';import mysql from 'mysql2/promise';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
if (process.env.NZ315_ADMIN_FLOW_LIVE !== '1') { console.log('本机接口验收默认跳过，设置 NZ315_ADMIN_FLOW_LIVE=1 后运行'); process.exit(0) }
const env=Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}));
if(!['127.0.0.1','localhost','::1'].includes(env.DB_HOST))throw Error('仅允许本机数据库');
const conn=await mysql.createConnection({host:env.DB_HOST,port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,dateStrings:true});
const base='http://127.0.0.1:3100';const tag='__测试导入_'+Date.now();const reportIds=[];const batchIds=[];const uploadIds=[];
const login=async username=>{const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'admin123'})});assert.equal(r.status,200,await r.text());return r.headers.get('set-cookie').split(';')[0];};
const cookie=await login('admin');
const call=async(path,body,auth=cookie)=>{const r=await fetch(base+path,{signal:AbortSignal.timeout(20000),method:body?'POST':'GET',headers:{cookie:auth,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json();if(r.status>=400)throw Error(path+': '+r.status+' '+j.statusMessage);return j;};
try{
 const [[p]]=await conn.query('SELECT p.id, p.enterprise_id, p.registration_no, s.spec_code FROM product p JOIN product_spec s ON s.id=p.spec_id WHERE p.status=1 AND s.status=1 LIMIT 1');assert.ok(p);
 const code='1'+String(p.registration_no).slice(-6)+'1'+p.spec_code+String(Date.now()).padStart(21,'0');
 const body={content:'sn,农药名称\n'+code+'\n'+code+'\nbad\n',productId:p.id,batchNo:tag,produceDate:'2026-10-05',qualityCertNo:tag,fileName:tag+'.txt',requestKey:randomUUID()};
 const parse=await call('/api/admin/codes/parse',{content:body.content});assert.equal(parse.validCount,1);assert.equal(parse.preview[2].lineNumber,4);
 const results=await Promise.all(Array.from({length:12},()=>call('/api/admin/codes/import',body)));const r=results[0];reportIds.push(r.reportId);if(r.batchCreated)batchIds.push(r.batchId);if(r.uploadBatchId)uploadIds.push(r.uploadBatchId);console.log('部分失败结果',r.imported,r.skippedDup,r.skippedInvalid);assert.equal(r.imported,1);assert.equal(r.skippedDup,1);assert.equal(r.skippedInvalid,1);assert.equal(new Set(results.map(x=>x.reportId)).size,1);
 const [[written]]=await conn.query('SELECT COUNT(*) AS total FROM trace_code WHERE code=?',[code]);assert.equal(written.total,1);
 const details=await call('/api/admin/import-reports/'+r.reportId+'/rejections');assert.equal(details.total,2);assert.equal(details.rows[1].lineNumber,4);
 const report=await call('/api/admin/import-reports/'+r.reportId);assert.equal(report.imported,1);assert.equal(report.notificationState,'sent');
 const [[messages]]=await conn.query('SELECT COUNT(*) AS total FROM message WHERE link=?',['/admin/import-reports/'+r.reportId]);assert.equal(messages.total,1);
 const csv=await fetch(base+'/api/admin/import-reports/'+r.reportId+'/download',{headers:{cookie}});assert.equal(csv.status,200);assert.match(await csv.text(),/原始行号/);
 const changed=await fetch(base+'/api/admin/codes/import',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({...body,content:'bad'})});assert.equal(changed.status,409);
 const failed=await call('/api/admin/codes/import',{...body,content:'bad\nwrong',requestKey:randomUUID()});reportIds.push(failed.reportId);assert.equal(failed.imported,0);assert.equal(failed.uploadBatchId,null);assert.equal(failed.skippedInvalid,2);
 const conflict=await call('/api/admin/codes/import',{...body,content:String(BigInt(code) + 1n),qualityCertNo:'不一致',requestKey:randomUUID()});reportIds.push(conflict.reportId);assert.equal(conflict.ok,false);assert.equal(conflict.notWritten,1);assert.equal(conflict.imported,0);
 const progress=await call('/api/admin/onboarding?enterpriseId='+p.enterprise_id);assert.equal(progress.enterpriseId,p.enterprise_id);assert.equal(progress.bindingReady,true);
 const viewer=await login('viewer');const denied=await fetch(base+'/api/admin/codes/import',{method:'POST',headers:{cookie:viewer,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(denied.status,403);
 const [[viewerRow]]=await conn.query("SELECT enterprise_id FROM `user` WHERE username='viewer'");const other=await call('/api/admin/onboarding?enterpriseId=999999',undefined,viewer);assert.equal(other.enterpriseId,viewerRow.enterprise_id);
 const [[otherProduct]]=await conn.query('SELECT id FROM product WHERE enterprise_id <> ? AND status=1 LIMIT 1',[viewerRow.enterprise_id]);
 if(otherProduct){
  const otherReport=await call('/api/admin/codes/import',{...body,content:'bad',productId:otherProduct.id,requestKey:randomUUID()});reportIds.push(otherReport.reportId);
  for(const suffix of ['', '/rejections', '/download']){const forbidden=await fetch(base+'/api/admin/import-reports/'+otherReport.reportId+suffix,{headers:{cookie:viewer}});assert.equal(forbidden.status,404);}
 } else { throw Error('缺少跨企业权限验收产品样本') }

 const anonymous=await fetch(base+'/api/admin/import-reports/'+r.reportId);assert.equal(anonymous.status,401);
 for(const path of ['/admin','/admin/collection','/admin/import-reports/'+r.reportId,'/admin/codes?uploadBatchId='+r.uploadBatchId,'/admin/alerts?status=0']){const ssr=await fetch(base+path,{headers:{cookie}});assert.equal(ssr.status,200);const text=await ssr.text();assert.ok(!text.includes('Internal Server Error'));}
 console.log('PASS：解析行号、部分/全部失败、并发幂等、冲突回滚、下载、角色权限、引导范围、SSR页面');
}finally{
 const [remainingReports]=await conn.query('SELECT id FROM import_report WHERE file_name=?',[tag+'.txt']);for(const row of remainingReports)if(!reportIds.includes(row.id))reportIds.push(row.id);
 const [remainingUploads]=await conn.query('SELECT id,batch_id FROM upload_batch WHERE file_name=?',[tag+'.txt']);for(const row of remainingUploads){if(!uploadIds.includes(row.id))uploadIds.push(row.id);if(!batchIds.includes(row.batch_id))batchIds.push(row.batch_id);}
 for(const id of reportIds){await conn.query('DELETE FROM message WHERE link=?',['/admin/import-reports/'+id]);await conn.query('DELETE FROM import_rejection WHERE report_id=?',[id]);await conn.query('DELETE FROM import_report WHERE id=?',[id]);}
 for(const id of uploadIds){await conn.query('DELETE FROM trace_code WHERE upload_batch_id=?',[id]);await conn.query('DELETE FROM upload_batch WHERE id=? AND file_name=?',[id,tag+'.txt']);}
 for(const id of batchIds)await conn.query('DELETE FROM batch WHERE id=? AND batch_no=?',[id,tag]);
 await conn.end();console.log('本轮测试业务数据已按记录编号清理');
}
