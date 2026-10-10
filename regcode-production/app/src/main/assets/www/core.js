(function (root) {
  'use strict';
  function fail(message) { throw new Error(message); }
  function codeOf(raw) {
    let text = String(raw || '').trim();
    try { text = decodeURIComponent(text); } catch (_) { /* 网址可不完整，保留原文。 */ }
    const codes = [...new Set(text.match(/(?<![0-9])[0-9]{32}(?![0-9])/g) || [])];
    if (codes.length === 1) return codes[0];
    fail(codes.length > 1 ? '扫码内容包含多个追溯码，无法确定产品' : '未找到完整的32位追溯码');
  }
  function isoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function draft(fields) {
    for (const [key, label, max] of [['name', '任务名称', 100], ['lineName', '生产线', 100], ['batchNo', '生产批号', 64], ['qualityCertNo', '质量合格证号', 100]]) {
      if (!String(fields[key] || '').trim() || String(fields[key]).trim().length > max) fail('请填写' + max + '字以内的' + label);
    }
    if (!Number.isSafeInteger(Number(fields.productId)) || Number(fields.productId) <= 0) fail('请从搜索结果中选择产品');
    if (!isoDate(fields.produceDate) || !isoDate(fields.expireDate) || fields.expireDate < fields.produceDate) fail('请选择有效日期，有效期不能早于生产日期');
    if (fields.qcResult !== 1) fail('请确认本批产品质检合格');
    if (!Number.isSafeInteger(Number(fields.quantity)) || Number(fields.quantity) < 1 || Number(fields.quantity) > 10000) fail('领用数量应为1至10000的整数');
    if (!['upload', 'task'].includes(fields.kind) || !Number.isSafeInteger(Number(fields.sourceId)) || Number(fields.sourceId) <= 0) fail('请选择领用码来源');
    const result = { productId: Number(fields.productId), name: fields.name.trim(), lineName: fields.lineName.trim(), batchNo: fields.batchNo.trim(), qualityCertNo: fields.qualityCertNo.trim(), produceDate: fields.produceDate, expireDate: fields.expireDate, qcResult: 1, quantity: Number(fields.quantity) };
    result[fields.kind === 'task' ? 'sourceTaskId' : 'sourceUploadBatchId'] = Number(fields.sourceId);
    return result;
  }
  const api = { codeOf, draft };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ProductionCore = api;
})(typeof window === 'undefined' ? globalThis : window);
