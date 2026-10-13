import test from 'node:test';import assert from 'node:assert/strict';
import '../regcode-production/app/src/main/assets/worker/production-preparation.js';
test('准备页默认当天和两年后，闰日回退至月底',()=>{assert.deepEqual(WorkerPreparation.defaults(new Date(2026,9,13)),{produceDate:'2026-10-13',expireDate:'2028-10-13'});assert.equal(WorkerPreparation.defaults(new Date(2024,1,29)).expireDate,'2026-02-28')});
test('同名产品以商标含量剂型规格证号区分，空值不显示undefined',()=>{const product={name:'相同成分',content:'10%',dosage:'悬浮剂',spec_name:'100毫升',registration_no:'PD123456'};assert.notEqual(WorkerPreparation.label({...product,trademark:'甲牌'}),WorkerPreparation.label({...product,trademark:'乙牌'}));assert.equal(WorkerPreparation.label(product),'相同成分 · 10% · 悬浮剂 · 100毫升 · PD123456')});
test('下拉生产线来自缓存并去重，不依赖员工名单或设备固定生产线',()=>{assert.deepEqual(WorkerPreparation.lines([{line_name:'一号线',memberIds:[999]},{line_name:'一号线'},{line_name:'二号线'},{}]),['一号线','二号线'])});
