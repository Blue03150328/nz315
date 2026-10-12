'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
// 网站根目录采用 ESM；按浏览器脚本方式加载，避免 require 得到空模块。
const sandbox = {};
vm.runInNewContext(fs.readFileSync(require.resolve('../app/src/main/assets/www/core.js'), 'utf8'), sandbox);
const core = sandbox.ProductionCore;
const a = '10000001001000000000000000000001', b = '10000001001000000000000000000002';
const server = 'https://www.nz315.cn';

test('扫码支持32位码、网址和前导零，拒绝双参数及非法结构', () => {
  assert.equal(core.codeOf('  ' + a + '\r\n'), a);
  assert.equal(core.codeOf(server + '/trace?code=' + a), a);
  assert.equal(core.codeOf('00000000000000000000000000000001'), '00000000000000000000000000000001');
  for (const raw of [a + '1', 'abc', server + '/trace?code=' + a + '&code=' + b, 'javascript:alert(1)']) assert.throws(() => core.codeOf(raw));
});
test('保留完整码的半截网址、任意域名和参数名均按相同码去重', () => {
  const code = '12418181066011752260421351054166';
  for (const value of ['.jilinhengda.com/q.do?i=' + code, 'http://cx.jilinhengda.com/q.do?i=' + code, '随便的域名/?47=' + code, '?code=' + code + '&again=' + code]) assert.equal(core.codeOf(value), code);
  assert.throws(() => core.codeOf('?i=' + code.slice(1)));
});
const fields = { productId: 1, name: '早班', lineName: '一号线', batchNo: 'A001', produceDate: '2026-10-10', expireDate: '2027-10-10', qualityCertNo: 'CERT-001', qcResult: 1, kind: 'task', sourceId: 7, quantity: 500 };
test('草稿按数量领用确定唯一来源，不附带手工码清单', () => {
  const task = core.draft(fields); assert.equal(task.sourceTaskId, 7); assert.equal(task.quantity, 500); assert.equal(task.sourceUploadBatchId, undefined); assert.equal(task.content, undefined);
  const upload = core.draft({ ...fields, kind: 'upload' }); assert.equal(upload.sourceUploadBatchId, 7); assert.equal(upload.sourceTaskId, undefined);
});
test('生产资料校验真实日期、先后顺序、质检、来源和整数数量', () => {
  for (const patch of [{ lineName: '' }, { productId: 0 }, { sourceId: 0 }, { quantity: 0 }, { quantity: 10001 }, { quantity: 1.5 }, { produceDate: '2026-02-30' }, { expireDate: '2025-01-01' }, { qcResult: 0 }]) assert.throws(() => core.draft({ ...fields, ...patch }));
});
