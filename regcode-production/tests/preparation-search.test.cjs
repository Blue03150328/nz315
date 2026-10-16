'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const sandbox={};
vm.runInNewContext(fs.readFileSync(require.resolve('../app/src/main/assets/worker/production-preparation.js'),'utf8'),sandbox);
const search=sandbox.WorkerPreparation;

test('产品关键词支持跨字段、多词、全角及大小写，保留原ID和资料',()=>{
  const product={id:208,name:'杀虫剂',trademark:'金丝鸟',content:'10%',dosage:'悬浮剂',spec_name:'500毫升×10瓶',registration_no:'PD20260001'};
  for(const keyword of ['杀虫','金丝鸟','500毫升','悬浮','10%','pd20260001','  金丝鸟　５００　ＰＤ２０２６ ',''])assert.equal(search.productMatches(product,keyword),true,keyword);
  for(const keyword of ['金丝鸟 200毫升','PD20260002','不存在'])assert.equal(search.productMatches(product,keyword),false,keyword);
  assert.equal(product.id,208);assert.equal(product.registration_no,'PD20260001');
  assert.equal(search.productMatches({id:1},'undefined'),false);
  assert.equal(search.productMatches({name:'<产&品>'},'<产&品>'),true);
});

test('大量缓存完整筛选且不截断，产线去重后按关键词匹配',()=>{
  const products=Array.from({length:1250},(_,i)=>({id:i+1,name:'产品'+(i+1),spec_name:i%2?'200毫升':'500毫升'}));
  assert.deepEqual(products.filter(p=>search.productMatches(p,'产品1250 200')).map(p=>p.id),[1250]);
  assert.equal(products.filter(p=>search.productMatches(p,'')).length,1250);
  const lines=search.lines([{line_name:'A区一号线'},{line_name:'B区二号线'},{line_name:'A区一号线'},{}]);
  assert.equal(lines.length,2);assert.equal(lines.filter(name=>search.matches(name,' ａ区 一号 '))[0],'A区一号线');
  assert.equal(search.matches('A区一号线','A区 二号'),false);
});
