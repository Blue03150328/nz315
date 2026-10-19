import {test} from 'node:test';import assert from 'node:assert/strict';import {register} from 'node:module';register('./_ts-loader.mjs',import.meta.url);
const {specExportValues,SPEC_EXPORT_HEADERS}=await import('../shared/utils/spec-transfer.ts');
const {parseSpecification}=await import('../shared/utils/specification.ts');
test('标准规格单列导出数量来自数据库，保持500克×20瓶格式',()=>{assert.deepEqual(SPEC_EXPORT_HEADERS,['规格']);assert.deepEqual(specExportValues({net_content:500,content_unit:'克',pack_unit:'瓶',pack_quantity:20}),['500克×20瓶'])});
test('外部截图两种规格归一且数量不丢失',()=>{assert.equal(parseSpecification('20毫升/瓶x20').name,'20毫升×20瓶');assert.equal(parseSpecification('130克/瓶x40').quantity,40)});
test('单列导出不改动原记录，原结构缺失可按标准旧名称解析',()=>{const r={spec_name:'500毫升/瓶x10',pack_quantity:1};assert.deepEqual(specExportValues(r),['500毫升×1瓶']);assert.equal(r.spec_name,'500毫升/瓶x10')});
