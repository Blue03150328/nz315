// 本机验收使用唯一名称创建测试批次，结束时仅清理本轮数据。
import mysql from 'mysql2/promise'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
if (process.env.NZ315_ADMIN_FLOW_LIVE !== '1') { console.log('本机接口验收默认跳过，设置 NZ315_ADMIN_FLOW_LIVE=1 后运行'); process.exit(0) }
const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i=l.indexOf('='); return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')] }))
if (!['127.0.0.1','localhost','::1'].includes(env.DB_HOST)) throw Error('仅允许本机数据库')
const db = await mysql.createConnection({host:env.DB_HOST,port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,dateStrings:true})
const base='http://127.0.0.1:3100'; const tag='__测试导入_'+Date.now(); const fileName=tag+'.txt'
const login=async username=>{ const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'admin123'})}); assert.equal(r.status,200); return r.headers.get('set-cookie').split(';')[0] }
try {
 const cookie=await login('admin')
 const request=(path,body,auth=cookie)=>fetch(base+path,{signal:AbortSignal.timeout(20000),method:body?'POST':'GET',headers:{cookie:auth,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})
 const call=async(path,body,auth)=>{const r=await request(path,body,auth);assert.equal(r.status,200,path);return r.json()}
 const [[p]]=await db.query('SELECT p.id,p.enterprise_id,p.registration_no,s.spec_code FROM product p JOIN product_spec s ON s.id=p.spec_id WHERE p.status=1 AND s.status=1 LIMIT 1');assert.ok(p)
 const code='1'+String(p.registration_no).slice(-6)+'1'+p.spec_code+String(Date.now()).padStart(21,'0')
 const body={content:'sn,农药名称\n'+code+'\n'+code+'\nbad\n',productId:p.id,batchNo:tag,produceDate:'2026-10-05',qualityCertNo:tag,fileName}
 const parse=await call('/api/admin/codes/parse',{content:body.content});assert.equal(parse.validCount,1);assert.equal(parse.preview[2].lineNumber,4)
 const results=await Promise.all(Array.from({length:12},()=>call('/api/admin/codes/import',body)))
 assert.ok(results.every(r=>r.ok&&r.total===r.imported+r.skippedDup+r.skippedInvalid+r.notWritten))
 assert.equal(results.reduce((n,r)=>n+r.imported,0),1)
 const success=results.find(r=>r.imported===1);assert.equal(success.skippedDup,1);assert.equal(success.skippedInvalid,1)
 assert.ok(results.filter(r=>r!==success).every(r=>r.uploadBatchId===null&&r.skippedDup===2))
 const [[written]]=await db.query('SELECT COUNT(*) AS total FROM trace_code WHERE code=?',[code]);assert.equal(written.total,1)
 const [[uploads]]=await db.query('SELECT COUNT(*) AS total FROM upload_batch WHERE file_name=?',[fileName]);assert.equal(uploads.total,1)
 const [[messages]]=await db.query('SELECT COUNT(*) AS total FROM message WHERE link=?',['/admin/codes?uploadBatchId='+success.uploadBatchId]);assert.equal(messages.total,1)
 const failed=await call('/api/admin/codes/import',{...body,content:'bad\nwrong'});assert.equal(failed.imported,0);assert.equal(failed.uploadBatchId,null);assert.equal(failed.skippedInvalid,2)
 const conflict=await call('/api/admin/codes/import',{...body,content:String(BigInt(code)+1n),qualityCertNo:'不一致'});assert.equal(conflict.ok,false);assert.equal(conflict.notWritten,1);assert.equal(conflict.imported,0)
 const progress=await call('/api/admin/onboarding?enterpriseId='+p.enterprise_id);assert.equal(progress.bindingReady,true)
 const viewer=await login('viewer');assert.equal((await request('/api/admin/codes/import',body,viewer)).status,403)
 const [[viewerRow]]=await db.query("SELECT enterprise_id FROM `user` WHERE username='viewer'");const own=await call('/api/admin/onboarding?enterpriseId=999999',undefined,viewer);assert.equal(own.enterpriseId,viewerRow.enterprise_id)
 const factory=await login('lvfeng');const {user}=await call('/api/auth/me',undefined,factory)
 const [[otherProduct]]=await db.query('SELECT id FROM product WHERE enterprise_id <> ? AND status=1 LIMIT 1',[user.enterprise_id]);assert.ok(otherProduct)
 assert.equal((await request('/api/admin/codes/import',{...body,productId:otherProduct.id},factory)).status,400)
 assert.equal((await request('/api/admin/codes/import',body,'')).status,401)
 for(const path of ['/api/admin/import-reports','/api/admin/import-reports/1','/api/admin/import-reports/1/rejections','/api/admin/import-reports/1/download','/admin/import-reports'])assert.equal((await request(path)).status,404,'已移除路由：'+path)
 for(const path of ['/admin','/admin/collection','/admin/codes?uploadBatchId='+success.uploadBatchId,'/admin/alerts?status=0']){const r=await request(path);assert.equal(r.status,200);const html=await r.text();assert.ok(!html.includes('Internal Server Error'));assert.ok(!html.includes('导入报告'))}
 console.log('PASS：解析、部分/全部失败、12并发只入库一次、单次通知、冲突回滚、跨企业与只读权限、移除路由、SSR页面')
} finally {
 const [uploads]=await db.query('SELECT id FROM upload_batch WHERE file_name=?',[fileName])
 for(const row of uploads){await db.query('DELETE FROM message WHERE link=?',['/admin/codes?uploadBatchId='+row.id]);await db.query('DELETE FROM trace_code WHERE upload_batch_id=?',[row.id]);await db.query('DELETE FROM upload_batch WHERE id=? AND file_name=?',[row.id,fileName])}
 await db.query('DELETE FROM batch WHERE batch_no=? AND quality_cert_no=?',[tag,tag]);await db.end();console.log('本轮测试业务数据已清理')
}
