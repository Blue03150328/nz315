// 使用独立测试记录验证真实 API 与 MySQL；结束后仅清理本脚本创建的记录。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).flatMap(line => {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); return m ? [[m[1], m[2].replace(/^['"]|['"]$/g, '')]] : [];
}));
const db = await mysql.createConnection({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true });
const base = process.env.TEST_BASE_URL || 'http://localhost:3100';
const run = 'TEST-PROD-' + Date.now();
const fileIds = [], codeIds = [], batchIds = [], codes = [], userIds = [];
let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks++; console.log('通过：' + message); };
async function api(path, body, cookie, method = 'POST', expected = 200) {
  const response = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  assert.equal(response.status, expected, path + '：' + (data.statusMessage || JSON.stringify(data)));
  return data;
}
async function login(username) {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'admin123' }) });
  assert.equal(r.status, 200, '演示账号登录失败');
  return r.headers.get('set-cookie').split(';')[0];
}
try {
  const admin = await login('admin');
  const [products] = await db.query("SELECT p.* FROM product p JOIN enterprise e ON e.id=p.enterprise_id WHERE p.status=1 AND e.status=1 AND e.renew_expire>=CURDATE() ORDER BY p.id LIMIT 1");
  const product = products[0]; assert.ok(product, '需要一个有效演示产品');
  const [br] = await db.execute('INSERT INTO batch (enterprise_id,product_id,batch_no,produce_date,quality_cert_no,expire_date,qc_result,quantity) VALUES (?,?,?,?,?,?,1,10)', [product.enterprise_id, product.id, run, '2026-09-01', 'TEST-CERT', '2028-09-01']);
  const batchId = br.insertId; batchIds.push(batchId);
  for (let i = 0; i < 3; i++) {
    const [fr] = await db.execute('INSERT INTO upload_batch (enterprise_id,file_name,product_id,batch_id,batch_no) VALUES (?,?,?,?,?)', [product.enterprise_id, run + '-' + i, product.id, i < 2 ? batchId : null, i < 2 ? run : null]);
    fileIds.push(fr.insertId);
    const code = '1' + String(Date.now()) + String(i) + crypto.randomInt(100000, 999999) + '0'.repeat(11); assert.equal(code.length, 32); codes.push(code);
    const [cr] = await db.execute('INSERT INTO trace_code (enterprise_id,code,product_id,batch_id,status,abnormal_flag,upload_batch_id,production_override,produce_date,quality_cert_no) VALUES (?,?,?,?,?,0,?,?,?,?)', [product.enterprise_id, code, product.id, i < 2 ? batchId : null, i < 2 ? 2 : 1, fr.insertId, i === 1 ? null : '{}', i === 1 ? '2026-08-30' : null, i === 1 ? 'LEGACY-CERT' : null]);
    codeIds.push(cr.insertId);
  }
  const endpoint = file => '/api/admin/codes/upload-batches/' + file;
  const body = { productId: product.id, groupBatchId: batchId, reason: '隔离验证：文件范围更正', changes: { produceDate: { action: 'set', value: '2026-09-02' }, expireDate: { action: 'clear' } } };
  const beforeB = await api('/api/trace?code=' + codes[1], null, null, 'GET');
  const [[snapshotB]] = await db.query('SELECT * FROM trace_code WHERE id=?', [codeIds[1]]);
  const preview = await api(endpoint(fileIds[0]) + '/correct/preview', body, admin);
  ok(preview.targetCount === 1, '预览精确限定文件 A');
  const command = { ...body, previewToken: preview.previewToken, requestKey: crypto.randomUUID() };
  const corrected = await api(endpoint(fileIds[0]) + '/correct', command, admin);
  ok(corrected.status === 'applied' && corrected.corrected === 1, '总部更正执行成功');
  const repeated = await api(endpoint(fileIds[0]) + '/correct', command, admin);
  ok(repeated.operationId === corrected.operationId, '重复提交不重复执行');
  const afterB = await api('/api/trace?code=' + codes[1], null, null, 'GET');
  assert.deepEqual(afterB.batch, beforeB.batch);
  const [[afterBatch]] = await db.query('SELECT * FROM batch WHERE id=?', [batchId]);
  ok(afterBatch.produce_date === '2026-09-01', '文件修正不更新共享生产批次');
  const [[rowB]] = await db.query('SELECT * FROM trace_code WHERE id=?', [codeIds[1]]);
  for (const key of ['batch_id','production_override','produce_date','quality_cert_no','expire_date','qc_result','status','abnormal_flag']) assert.deepEqual(rowB[key], snapshotB[key]);
  ok(true, '文件 B 的生产数据和扫码生产信息完全不变');
  const resultA = await api('/api/trace?code=' + codes[0], null, null, 'GET');
  ok(resultA.batch.produceDate === '2026-09-02' && resultA.batch.expireDate === '', '码级日期生效且清空有效期不回退');
  await api(endpoint(fileIds[0]) + '/correct/preview', { ...body, batchId }, admin, 'POST', 400); ok(true, '修正接口拒绝换绑字段');
  await api(endpoint(fileIds[0]) + '/correct/preview', { ...body, changes: { produceDate: { action:'set', value:'2026-02-30' } } }, admin, 'POST', 400); ok(true, '不存在的日期被拒绝');
  const stale = await api(endpoint(fileIds[0]) + '/correct/preview', body, admin);
  await db.execute('UPDATE trace_code SET abnormal_flag=1 WHERE id=?', [codeIds[0]]);
  await api(endpoint(fileIds[0]) + '/correct', { ...body, previewToken: stale.previewToken, requestKey: crypto.randomUUID() }, admin, 'POST', 400);
  ok(true, '预览后冻结目标码，提交被拦截');
  await db.execute('UPDATE trace_code SET abnormal_flag=0 WHERE id=?', [codeIds[0]]);
  const bind = { productId: product.id, mode:'existing', batchId };
  const bp = await api(endpoint(fileIds[2]) + '/bind/preview', bind, admin);
  const bound = await api(endpoint(fileIds[2]) + '/bind', { ...bind, previewToken:bp.previewToken, requestKey:crypto.randomUUID() }, admin);
  ok(bound.bound === 1, '已有批次首次绑定成功');
  await api(endpoint(fileIds[2]) + '/bind/preview', bind, admin, 'POST', 400); ok(true, '已绑定码不能再次首次绑定');
  const edit = { batchNo:run, produceDate:'2026-09-03', qualityCertNo:'PUBLIC-NEW', expireDate:'2028-09-01', qcResult:1, qcReportNo:'', quantity:10, reason:'隔离验证：公共资料更正' };
  const ep = await api('/api/admin/batches/' + batchId + '/preview', edit, admin);
  ok(ep.uploadCount === 3 && ep.targetCount === 3, '公共编辑预览完整跨文件影响');
  await api('/api/admin/batches/' + batchId, { ...edit, previewToken:ep.previewToken, requestKey:crypto.randomUUID() }, admin, 'PATCH');
  const aa = await api('/api/trace?code=' + codes[0], null, null, 'GET');
  const bb = await api('/api/trace?code=' + codes[1], null, null, 'GET');
  const cc = await api('/api/trace?code=' + codes[2], null, null, 'GET');
  ok(aa.batch.produceDate === '2026-09-02' && bb.batch.produceDate === '2026-08-30' && cc.batch.produceDate === '2026-09-03', '公共更新保留人工及历史覆盖，新绑定码跟随公共值');
  const tenant = await login('lvfeng');
  const me = await api('/api/auth/me', null, tenant, 'GET');
  if (Number(me.user.enterprise_id) === Number(product.enterprise_id)) {
    const tenantBody = { ...body, changes: { qualityCertNo:{ action:'set', value:'TENANT-CERT' } } };
    const tp = await api(endpoint(fileIds[0]) + '/correct/preview', tenantBody, tenant);
    const application = await api(endpoint(fileIds[0]) + '/correct', { ...tenantBody, previewToken:tp.previewToken, requestKey:crypto.randomUUID() }, tenant);
    ok(application.status === 'pending', '厂家更正提交审批，未直接修改');
    await api('/api/admin/production-operations/' + application.operationId + '/review', { action:'approve' }, tenant, 'POST', 403);
    const reviewed = await api('/api/admin/production-operations/' + application.operationId + '/review', { action:'approve' }, admin);
    ok(reviewed.status === 'applied', '仅总部能够审批并执行');
    const publicEdit = { ...edit, quantity:12, reason:'公共资料审批验证' };
    const publicPreview = await api('/api/admin/batches/' + batchId + '/preview', publicEdit, tenant);
    const publicRequestKey = crypto.randomUUID();
    await api('/api/admin/batches/' + batchId, {...publicEdit,previewToken:publicPreview.previewToken,requestKey:publicRequestKey}, tenant, 'PATCH');
    const [[publicRequest]] = await db.query('SELECT id,status FROM production_operation WHERE request_key=?',[publicRequestKey]);
    ok(publicRequest.status === 'pending', '厂家公共资料更正进入审批');
    await api('/api/admin/production-operations/' + publicRequest.id + '/review',{action:'approve'},admin);
    const [[publicBatch]] = await db.query('SELECT quantity FROM batch WHERE id=?',[batchId]);
    ok(publicBatch.quantity === 12, '总部审批执行公共资料更正');
    const rejectPreview = await api(endpoint(fileIds[0]) + '/correct/preview', tenantBody, tenant);
    const rejectedApplication = await api(endpoint(fileIds[0]) + '/correct', {...tenantBody,previewToken:rejectPreview.previewToken,requestKey:crypto.randomUUID()},tenant);
    await api('/api/admin/production-operations/' + rejectedApplication.operationId + '/review',{action:'reject',reason:'测试驳回'},admin);
    const rejection = await api('/api/admin/production-operations/' + rejectedApplication.operationId,null,tenant,'GET');
    ok(rejection.status === 'rejected' && rejection.result.reason === '测试驳回', '驳回原因保存且不执行修改');
  }
  const list = await api('/api/admin/codes/upload-batches?fileName=' + run, null, admin, 'GET');
  ok(list.rows.length === 3 && list.rows.every(r => r.batch_no === run), '码库当前批号按关联码汇总');
  const details = await api('/api/admin/codes?uploadBatchId=' + fileIds[0], null, admin, 'GET');
  ok(details.rows[0].produce_date === '2026-09-02', '码明细读取码级更正值');
  const operations = await api('/api/admin/production-operations', null, admin, 'GET');
  ok(operations.rows.length > 0, '更正记录与审批列表可读取');
  // 同一个受控测试码重置后验证新建模式，不接触用户原有数据。
  await db.execute('UPDATE trace_code SET status=1,batch_id=NULL,production_override=NULL WHERE id=?', [codeIds[2]]);
  const newBinding = { productId:product.id, mode:'new', newBatch:{ batchNo:run + '-NEW', produceDate:'2026-09-01', qualityCertNo:'NEW-CERT' } };
  const np = await api(endpoint(fileIds[2]) + '/bind/preview', newBinding, admin);
  const nc = { ...newBinding, previewToken:np.previewToken, requestKey:crypto.randomUUID() };
  const newlyBound = await api(endpoint(fileIds[2]) + '/bind', nc, admin);
  batchIds.push(newlyBound.batchId);
  ok(newlyBound.batchCreated && newlyBound.bound === 1, '新建批次与首次绑定同次完成');
  const newRepeat = await api(endpoint(fileIds[2]) + '/bind', nc, admin);
  ok(newRepeat.batchId === newlyBound.batchId, '新建绑定重试不产生重复批次');
  await db.execute('UPDATE trace_code SET status=1,batch_id=NULL WHERE id=?', [codeIds[2]]);
  await api(endpoint(fileIds[2]) + '/bind/preview', { ...newBinding, newBatch:{...newBinding.newBatch, qualityCertNo:'CONFLICT'} }, admin, 'POST', 409);
  ok(true, '相同批号资料冲突拒绝覆盖');
  await api(endpoint(fileIds[2]) + '/bind/preview', { ...newBinding, newBatch:{...newBinding.newBatch, qcResult:0} }, admin, 'POST', 400);
  ok(true, '新建质检不合格批次禁止绑定');
  const np2 = await api(endpoint(fileIds[2]) + '/bind/preview', newBinding, admin);
  const concurrent = { ...newBinding, previewToken:np2.previewToken, requestKey:crypto.randomUUID() };
  const two = await Promise.all([api(endpoint(fileIds[2]) + '/bind', concurrent, admin),api(endpoint(fileIds[2]) + '/bind', concurrent, admin)]);
  ok(two[0].operationId === two[1].operationId, '并发重复提交只执行一次');
  const normalBody = { ...body, changes:{ qualityCertNo:{action:'inherit'} } };
  const stale2 = await api(endpoint(fileIds[0]) + '/correct/preview', normalBody, admin);
  await db.execute("UPDATE batch SET qc_report_no='并发变更' WHERE id=?", [batchId]);
  await api(endpoint(fileIds[0]) + '/correct', { ...normalBody, previewToken:stale2.previewToken, requestKey:crypto.randomUUID() }, admin, 'POST', 409);
  ok(true, '预览后公共资料变更拒绝旧提交');
  await db.execute('UPDATE batch SET qc_result=0 WHERE id=?', [batchId]);
  await api(endpoint(fileIds[0]) + '/correct/preview', { ...body, changes:{qcResult:{action:'set',value:1}} }, admin, 'POST', 400);
  ok(true, '码级合格不能覆盖公共批次不合格');
  await db.execute('UPDATE batch SET qc_result=1 WHERE id=?', [batchId]);
  const restore = await api(endpoint(fileIds[0]) + '/correct/preview', normalBody, admin);
  await api(endpoint(fileIds[0]) + '/correct', { ...normalBody, previewToken:restore.previewToken, requestKey:crypto.randomUUID() }, admin);
  const restored = await api('/api/trace?code=' + codes[0], null, null, 'GET');
  ok(restored.batch.qualityCertNo === 'PUBLIC-NEW', '恢复使用批次资料生效');
  const [[adminUser]] = await db.query("SELECT password FROM user WHERE username='admin'");
  const [ur] = await db.execute('INSERT INTO user (enterprise_id,username,password,name,role,status) VALUES (?,?,?,?,?,1)', [product.enterprise_id, run, adminUser.password, '隔离只读测试','viewer']);
  userIds.push(ur.insertId);
  const viewer = await login(run);
  await api(endpoint(fileIds[0]) + '/correct/preview', body, viewer, 'POST', 403); ok(true, '只读账号后端拒绝修正');
  await api(endpoint(fileIds[0]) + '/bind/preview', bind, viewer, 'POST', 403); ok(true, '只读账号后端拒绝绑定');
  await api('/api/admin/codes/' + codeIds[0] + '/correct', {batchId}, admin, 'POST', 410); ok(true, '旧单码换绑入口已停用');
  const [otherEnterprise] = await db.query('SELECT id FROM enterprise WHERE id<>? LIMIT 1',[product.enterprise_id]);
  if (otherEnterprise.length) {
    const [foreignFile] = await db.execute('INSERT INTO upload_batch (enterprise_id,file_name) VALUES (?,?)',[otherEnterprise[0].id,run+'-FOREIGN']);
    fileIds.push(foreignFile.insertId);
    await api(endpoint(foreignFile.insertId) + '/binding-context',null,tenant,'GET',404);
    ok(true,'企业账号不能读取其他企业的上传文件');
  }
  const [[spec]] = await db.query('SELECT spec_code FROM product_spec WHERE id=?',[product.spec_id]);
  const importCode = (product.registration_no.startsWith('WP') ? '2' : '1') + product.registration_no.slice(-6) + String(product.production_type || 1) + spec.spec_code + String(Date.now()) + crypto.randomInt(10000000,99999999);
  assert.equal(importCode.length,32);
  const importBody = { codes:[importCode],productId:product.id,fileName:run+'-IMPORT',batchNo:run,produceDate:'2026-09-03',qualityCertNo:'PUBLIC-NEW' };
  await api('/api/admin/codes/import',{...importBody,qualityCertNo:'CONFLICT'},admin,'POST',409);
  const [[none]] = await db.query('SELECT COUNT(*) AS c FROM trace_code WHERE code=?',[importCode]);
  ok(none.c === 0,'生产采集资料冲突不插码、不覆盖批次');
  const imported = await api('/api/admin/codes/import',importBody,admin);
  fileIds.push(imported.uploadBatchId);codes.push(importCode);
  const [[importedCode]] = await db.query('SELECT id,production_override FROM trace_code WHERE code=?',[importCode]);codeIds.push(importedCode.id);
  ok(imported.imported === 1 && imported.batchId === batchId && JSON.stringify(importedCode.production_override) === '{}','生产采集共用批次校验，新码跟随公共资料');
  for (const path of ['/admin/codes', endpoint(fileIds[0]).replace('/api','') + '/bind', endpoint(fileIds[0]).replace('/api','') + '/correct', '/admin/codes/production-operations', '/admin/batches']) {
    const response = await fetch(base + path, { headers:{cookie:admin} });
    ok(response.status === 200 && !(await response.text()).includes('Internal Server Error'), '页面渲染正常：' + path);
  }
  console.log('生产工作流验证全部完成，共 ' + checks + ' 项');

} finally {
  if (fileIds.length) {
    const placeholders = fileIds.map(() => '?').join(',');
    const [operations] = await db.query("SELECT id FROM production_operation WHERE (kind IN ('bind','correct') AND scope_id IN (" + placeholders + ")) OR (kind='batch' AND scope_id=?)", [...fileIds, batchIds[0] || 0]);
    for (const o of operations) await db.execute('DELETE FROM production_change WHERE operation_id=?', [o.id]);
    for (const o of operations) await db.execute('DELETE FROM production_operation WHERE id=?', [o.id]);
    for (const code of codes) {
      await db.execute('DELETE FROM scan_log WHERE code=?', [code]);
    }
    for (const id of codeIds) await db.execute('DELETE FROM risk_alert WHERE code_id=?', [id]);
    for (const id of codeIds) await db.execute('DELETE FROM trace_code WHERE id=?', [id]);
    for (const id of fileIds) await db.execute('DELETE FROM upload_batch WHERE id=?', [id]);
    for (const id of batchIds) await db.execute('DELETE FROM batch WHERE id=?', [id]);
    await db.execute('DELETE FROM message WHERE content LIKE ?',['%'+run+'%']);
  }
  for (const id of userIds) { await db.execute('DELETE FROM operation_log WHERE user_id=?',[id]); await db.execute('DELETE FROM user WHERE id=?',[id]); }
  await db.end();
}
