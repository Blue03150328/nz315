'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {spawn}=require('node:child_process');
const assets=path.resolve(__dirname,'../app/src/main/assets/www');
const workerAssets=path.resolve(__dirname,'../app/src/main/assets/worker');
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
// 真实浏览器只连接隔离静态页面，模拟原生桥；持久队列与HTTP协议由JVM测试分别验证。
const fixture=`(function(){'use strict';
const context={server:'https://www.nz315.cn',enterpriseId:1,deviceId:2,enterpriseName:'隔离厂家',lineName:'一号流水线'},q={ok:true,batch:null,selection:null,deviceContext:context,deviceBlocked:false,queueCounts:{waiting:0},batchCounts:{pending:0,completed:0},counts:{},recent:[]};
const events=[],archived=[],online=!new URLSearchParams(location.search).has('offline');let armed=false,sequence=0;
window.__workerHistory=[];window.__requests=[];window.__captured=[];window.__nativeCalls=[];window.__archived=archived;window.__registrationRequired=new URLSearchParams(location.search).has('deleted');window.__unconfirmed=false;
window.Native={settings:()=>JSON.stringify({server:context.server,mode:'broadcast',stripTerminator:true}),requestId:()=>crypto.randomUUID(),deviceInfo:()=>JSON.stringify({hasCredential:true,registered:true}),queue:()=>JSON.stringify({ok:true,session:null}),capturing:value=>{armed=value;},externalQueue:()=>JSON.stringify(q),resumeUpload(){},confirmed(){},rejected(){},exit(){},exportBackup(){window.__backup=true;},openWorkerApp(){location.href='/worker/index.html';},openLegacyApp(){location.href='/index.html?history=1';},
request(id,method,url){window.__requests.push(url);setTimeout(()=>window.NzApi.receive(id,online?{status:200,body:url==='/api/device/context'?{ok:true,device:{id:2,enterprise_id:1,line_name:context.lineName},user:{id:0,device_id:2,enterprise_id:1,role:'code_admin',name:'隔离厂家'}}:{rows:[],total:0}}:{status:0,error:'隔离断网'}),0);},
prepareExternal(worker){worker=worker.trim();if(!worker||worker.length>64)return JSON.stringify({ok:false,error:'请填写64字以内的工号'});q.selection={...context,workerNo:worker};return JSON.stringify(q);},
collectExternal(raw){window.__nativeCalls.push('external');if(!armed)return JSON.stringify({ok:false,error:'已暂停'});if(!q.batch||q.batch.state!=='open')return JSON.stringify({ok:false,error:'旧采集已结束，请从生产扫码开始新采集'});window.__captured.push(raw);if(!q.batch||q.batch.state!=='open'){sequence=0;q.batch={id:crypto.randomUUID(),state:'open',worker_no:q.selection.workerNo};q.counts={collected:0,accepted:0,localDuplicates:0,duplicates:0,rejected:0};q.recent=[];}const localKind=events.includes(raw)?'duplicate':'valid';events.push(raw);q.counts[localKind==='valid'?'collected':'localDuplicates']++;q.queueCounts.waiting++;const event={eventId:crypto.randomUUID(),sequence:++sequence,rawCode:raw,capturedAt:new Date().toISOString(),localKind};q.recent.unshift({event,localKind,receipt:null});return JSON.stringify({ok:true,event});},
collect(){throw new Error('外部采集不能调用内部码解析');},finishExternal(){if(!q.batch||q.batch.state!=='open')return JSON.stringify({...q,finishRequested:false});q.batch.state='sealed';archived.push(q.batch.id);q.batchCounts.pending++;return JSON.stringify({...q,finishRequested:true});},uploadExternal:()=>JSON.stringify({ok:true,message:'正在补传'}),configure:()=>'',};
window.__resumeLegacy=()=>{q.batch={id:'legacy-open',state:'open',worker_no:'001'};q.counts={collected:0,accepted:0,localDuplicates:0,duplicates:0,rejected:0};};
window.WorkerNative={scanning(value){armed=value;},snapshot:()=>JSON.stringify({ok:true,identity:new URLSearchParams(location.search).has('worker')?{id:1,name:'隔离工人',username:'001',enterpriseId:1,role:new URLSearchParams(location.search).has('operator')?'production_operator':'line_leader'}:null,device:{enterpriseName:context.enterpriseName,name:'隔离设备'},registrationRequired:window.__registrationRequired,unconfirmedWork:window.__unconfirmed,cache:window.__workerCache||{id:'ready'},allWaiting:0,message:'隔离测试',history:[],run:window.__workerRun||null,counts:{},recent:[],openRuns:window.__openRuns||[],products:window.__workerProducts||[{id:1,name:"已入库产品甲",registration_no:"PD00000001",spec_name:"200毫升"},{id:2,name:"已入库产品乙",registration_no:"PD00000002",spec_name:"500毫升"}],pools:window.__workerPools||[{task_id:9,product_id:1,task_name:"任务甲",line_name:"一号线",memberIds:[1]},{task_id:10,product_id:2,task_name:"任务乙",line_name:"二号线",memberIds:[1]}]}),backup(){window.__workerBackup=true;},recordTxt(id,scope){window.__workerTxt=id;window.__workerTxtScope=scope;},txt(id){window.__workerTxt=id;},upload(){},call(id,action,raw){if(action==='recordDetail'){setTimeout(()=>WorkerApi.receive(id,{ok:true,record:window.__workerHistory.find(r=>r.id===JSON.parse(raw).sessionId),events:[{sequence:1,kind:'valid',rawCode:'https://example.test/?full=0001',capturedAt:'2026-10-16T01:00:00.000Z'}],actions:[{kind:'start',capturedAt:'2026-10-16T01:00:00.000Z'}],total:1,page:1}),0);return;}if(action==='history'||action==='records'){setTimeout(()=>WorkerApi.receive(id,{ok:true,rows:window.__workerHistory}),0);return;}if(action!=='start')throw Error('此网页测试不提交其他业务');window.__lastWorkerStart=JSON.parse(raw);window.__workerRun={id:'mock-run',mode:'production',context:window.__lastWorkerStart};setTimeout(()=>WorkerApi.receive(id,{ok:true}),0);}};
})();`;
async function delay(ms){await new Promise(resolve=>setTimeout(resolve,ms));}
test('真实网页覆盖统一生产入口、旧批续传、原文、暂停与离线记录',{skip:!fs.existsSync(edge),timeout:45000},async()=>{
  const server=http.createServer((request,response)=>{
    const requested=new URL(request.url,'http://localhost').pathname.slice(1)||'index.html',worker=requested.startsWith('worker/'),name=worker?requested.slice(7):requested;
    if(name==='mock-native.js'){response.setHeader('Content-Type','text/javascript');response.end(fixture);return;}
    if(!(worker?['index.html','worker.js','worker.css','production-preparation.js','product-picker.js','product-picker.css']:['index.html','app.js','core.js','app.css','favicon.svg']).includes(name)){response.writeHead(404).end();return;}
    response.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'image/svg+xml');
    let data=fs.readFileSync(path.join(worker?workerAssets:assets,name));if(name==='index.html')data=data.toString().replace(worker?'<script src="worker.js">':'<script src="core.js">',worker?'<script src="/mock-native.js"></script><script src="worker.js">':'<script src="mock-native.js"></script><script src="core.js">');response.end(data);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'nz315-external-ui-')),browser=spawn(edge,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
  let ws;
  try{
    const active=path.join(profile,'DevToolsActivePort');for(let i=0;i<100&&!fs.existsSync(active);i++)await delay(50);assert.ok(fs.existsSync(active),'浏览器未启动调试接口');const port=Number(fs.readFileSync(active,'utf8').split(/\r?\n/)[0]);
    const target=await (await fetch('http://127.0.0.1:'+port+'/json/new?'+encodeURIComponent(origin+'/index.html'),{method:'PUT'})).json();ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
    let next=0;const requests=new Map(),errors=[];ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id&&requests.has(message.id)){requests.get(message.id)(message);requests.delete(message.id);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
    const command=(method,params={})=>new Promise(resolve=>{const id=++next;requests.set(id,resolve);ws.send(JSON.stringify({id,method,params}));});
    await command('Runtime.enable');
    const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.result.exceptionDetails)throw new Error(result.result.exceptionDetails.exception?.description||result.result.exceptionDetails.text);return result.result.result.value;};
    const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(25);}throw new Error('页面未进入预期状态：'+expression);};
    await wait('!!document.getElementById("externalEntry")');await evaluate('window.__resumeLegacy();document.getElementById("externalEntry").click()');await wait('!!document.getElementById("externalWorker")');
    assert.equal(await evaluate('document.getElementById("main").textContent.includes("一号流水线")'),true);
    await evaluate('document.getElementById("externalWorker").value="";document.getElementById("externalWorkerForm").dispatchEvent(new Event("submit",{cancelable:true}))');assert.equal(await evaluate('!!document.getElementById("externalWorker")'),true);
    await evaluate('document.getElementById("externalWorker").value="001";document.getElementById("externalWorkerForm").dispatchEvent(new Event("submit",{cancelable:true}));document.getElementById("externalToggle").click()');
    const raw=' https://outside.example/?code=00001&x=%2f&name=<script>甲😀</script> ';
    await evaluate('window.PDAScanAdapter.onScan('+JSON.stringify(raw)+')');assert.deepEqual(await evaluate('window.__captured'),[raw]);assert.equal(await evaluate('document.getElementById("externalRecent").textContent.includes('+JSON.stringify(raw)+')'),true);assert.equal(await evaluate('document.querySelector("#externalRecent script")===null'),true);
    const first=await evaluate('JSON.parse(Native.externalQueue()).batch.id');await evaluate('document.getElementById("externalFinish").click();window.PDAScanAdapter.onScan("0000002")');assert.equal(await evaluate('JSON.parse(Native.externalQueue()).batch.id'),first);assert.deepEqual(await evaluate('window.__archived'),[first]);
    await evaluate('window.App.lifecycle(false);window.PDAScanAdapter.onScan("暂停不能采集")');assert.equal(await evaluate('window.__captured.length'),1);await evaluate('window.App.lifecycle(true)');assert.equal(await evaluate('document.getElementById("externalToggle").textContent'), '开始连续采集');
    await evaluate('document.getElementById("externalBack").click()');await wait('!!document.getElementById("loginForm")');assert.equal(await evaluate('document.getElementById("main").textContent.includes("工人登录")'),true);
    assert.equal(await evaluate('document.getElementById("legacyEntry")===null'),true);await command('Page.navigate',{url:origin+'/index.html?history=1'});await wait('!!document.getElementById("legacyHistoryTitle")');assert.deepEqual(await evaluate('window.__requests'),[]);assert.equal(await evaluate('document.getElementById("activationCode")===null'),true);await evaluate('document.getElementById("legacyBackup").click()');assert.equal(await evaluate('window.__backup'),true);
    await command('Page.navigate',{url:origin+'/worker/index.html?worker=1'});await wait('!!document.getElementById("production")');assert.equal(await evaluate('document.getElementById("external")===null'),true);assert.equal(await evaluate('document.getElementById("legacyEntry")===null'),true);assert.equal(await evaluate('getComputedStyle(document.querySelector("header")).display'),'none');
    await evaluate('document.getElementById("production").click()');await wait('!!document.getElementById("product")');
    assert.equal(await evaluate('document.getElementById("product").options.length'),3);
    await wait('!!document.getElementById("productSearch")');
    assert.equal(await evaluate('document.getElementById("line").tagName'), 'SELECT');
    assert.equal(await evaluate('document.getElementById("lineSearch")===null'),true,'产线保持原版下拉选择');
    assert.equal(await evaluate('document.getElementById("product").hidden'),true);
    const tap=async selector=>{const point=await evaluate('(()=>{const b=document.querySelector('+JSON.stringify(selector)+');b.scrollIntoView({block:"center"});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
    await command('Emulation.setDeviceMetricsOverride',{width:360,height:640,deviceScaleFactor:1,mobile:true});
    await command('Emulation.setTouchEmulationEnabled',{enabled:true});
    await tap('#productPicker');await command('Input.insertText',{text:'500'});
    assert.equal(await evaluate('document.getElementById("productDialog").open'),true);
    assert.equal(await evaluate('document.querySelectorAll("#productOptions button").length'),1);
    assert.equal(await evaluate('document.getElementById("product").value'),'','输入关键词不自动选择产品');
    await tap('#productOptions button');assert.equal(await evaluate('document.getElementById("product").value'),'2');
    assert.equal(await evaluate('document.getElementById("notice").hidden'),true,'选择产品不会触发开工按钮');
    assert.equal(await evaluate('document.getElementById("productPicker").textContent.includes("产品乙")'),true);
    await evaluate('document.getElementById("batchNo").value="保留批号";document.getElementById("produceDate").value="2026-10-01";document.getElementById("expireDate").value="2027-10-01"');
    await tap('#productPicker');await command('Input.insertText',{text:'不存在'});
    assert.equal(await evaluate('document.querySelectorAll("#productOptions button").length'),0);
    assert.equal(await evaluate('document.getElementById("productSelected").textContent.includes("产品乙")'),true);
    await tap('#productCancel');await delay(30);
    assert.equal(await evaluate('document.getElementById("notice").hidden'),true,'取消弹窗不误点开工');
    assert.equal(await evaluate('document.getElementById("productPicker").textContent.includes("产品乙")'),true,'取消后保留实际已选产品');
    assert.deepEqual(await evaluate('["product","batchNo","produceDate","expireDate"].map(id=>document.getElementById(id).value)'),['2','保留批号','2026-10-01','2027-10-01']);
    await tap('#productPicker');await command('Input.insertText',{text:'PD00000002'});await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter'});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter'});
    assert.equal(await evaluate('document.getElementById("batchNo").value'),'保留批号','重选同一产品不重置资料');
    assert.equal(await evaluate('document.getElementById("notice").hidden'),true,'输入回车只选择产品');
    await tap('#productPicker');await command('Input.insertText',{text:'不存在'});await tap('#productClear');
    assert.equal(await evaluate('document.querySelectorAll("#productOptions button").length'),2);
    await evaluate('window.App.back()');assert.equal(await evaluate('document.getElementById("productDialog").open'),false);
    assert.equal(await evaluate('!!document.getElementById("batchNo")'),true,'返回键只关闭产品弹窗');
    await tap('#productPicker');await evaluate('window.App.lifecycle(false);window.App.lifecycle(true)');
    assert.equal(await evaluate('document.getElementById("productDialog").open'),false);
    await tap('#productPicker');await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape'});
    assert.equal(await evaluate('document.getElementById("productDialog").open'),false);
    await tap('#productPicker');await command('Emulation.setDeviceMetricsOverride',{width:320,height:360,deviceScaleFactor:1,mobile:true});await delay(100);
    assert.equal(await evaluate('(()=>{const r=document.getElementById("productDialog").getBoundingClientRect(),l=document.getElementById("productOptions").getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.width<=innerWidth&&l.height>30;})()'),true,'软键盘缩小视口后搜索与候选仍可见');
    await tap('#productCancel');await command('Emulation.setDeviceMetricsOverride',{width:360,height:640,deviceScaleFactor:1,mobile:true});
    await evaluate('window.__workerProducts=Array.from({length:1250},(_,i)=>({id:i+1,name:i===1249?"<特殊&产品>":"测试产品"+(i+1),trademark:i%2?"金丝鸟":"甲商标",registration_no:"PD"+String(i+1).padStart(8,"0"),spec_name:i%2?"500毫升":"200毫升"}));window.__workerCache={id:"many-products"}');await delay(1100);
    await tap('#productPicker');await command('Input.insertText',{text:' 金丝鸟　５００　ｐｄ００００１２５０ '});
    assert.equal(await evaluate('document.querySelectorAll("#productOptions button").length'),1);
    assert.equal(await evaluate('document.getElementById("productOptions").textContent.includes("<特殊&产品>")'),true);
    assert.equal(await evaluate('document.querySelector("#productOptions script")===null'),true);
    if(process.env.NZ315_UI_SHOTS){fs.mkdirSync(process.env.NZ315_UI_SHOTS,{recursive:true});const shot=await command('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.NZ315_UI_SHOTS,'product-dialog.png'),Buffer.from(shot.result.data,'base64'));}
    await tap('#productOptions button');assert.equal(await evaluate('document.getElementById("product").value'),'1250');
    await tap('#productPicker');await command('Input.insertText',{text:'金丝鸟 500'});
    await evaluate('window.__workerProducts.push({id:1251,name:"新产品",trademark:"金丝鸟",spec_name:"500毫升"});window.__workerCache={id:"product-update"}');await delay(1100);
    assert.equal(await evaluate('document.getElementById("productSearch").value'),'金丝鸟 500');
    assert.equal(await evaluate('document.getElementById("productCount").textContent.includes("匹配 626 / 1251")'),true);
    await tap('#productCancel');await evaluate('window.__workerProducts=undefined;window.__openRuns=[{mode:"production",context:{productId:1,lineName:"原批产线",batchNo:"原批号",produceDate:"2026-10-01",expireDate:"2028-10-01"}}];window.__workerCache={id:"original-run"}');await delay(1100);
    assert.equal(await evaluate('document.getElementById("product").value'),'','缓存移除的已选ID失效');
    await tap('#productPicker');await command('Input.insertText',{text:'PD00000001'});await tap('#productOptions button');
    assert.equal(await evaluate('document.getElementById("line").disabled'),true);
    await tap('#productPicker');await command('Input.insertText',{text:'产品乙'});await tap('#productCancel');
    assert.deepEqual(await evaluate('["product","line","batchNo","produceDate","expireDate"].map(id=>document.getElementById(id).value)'),['1','原批产线','原批号','2026-10-01','2028-10-01']);
    await evaluate('window.__openRuns=[];window.__workerProducts=[];window.__workerCache={id:"empty-products"}');await delay(1100);
    await tap('#productPicker');assert.equal(await evaluate('document.querySelectorAll("#productOptions button").length'),0);
    assert.equal(await evaluate('document.getElementById("productCount").textContent.includes("暂无产品")'),true);
    await tap('#productCancel');await evaluate('window.__workerProducts=undefined;window.__workerCache={id:"restored-products"}');await delay(1100);
    await evaluate('document.getElementById("product").value="2";document.getElementById("product").dispatchEvent(new Event("change"));document.getElementById("line").value="二号线";document.getElementById("batchNo").value="B2";document.getElementById("produceDate").value="2026-10-13";document.getElementById("expireDate").value="2027-10-13";document.getElementById("start").click();document.querySelector("button[value=yes]").click()');
    await wait('!!document.getElementById("toggle")');assert.equal(await evaluate('window.__lastWorkerStart.productId'),2);assert.equal(await evaluate('window.__lastWorkerStart.stockWorkflow'),true);assert.equal(await evaluate('window.__lastWorkerStart.unifiedScan'),true);assert.equal(await evaluate('window.__lastWorkerStart.taskId'),0);assert.equal(await evaluate('window.__lastWorkerStart.autoLine'),true);assert.equal(await evaluate('window.__lastWorkerStart.lineName'),'二号线');
    await evaluate('window.App.back();window.App.back()');
    await evaluate('window.__workerHistory=[{id:"r1",identity:{name:"老王",username:"001",deviceName:"测试设备"},mode:"production",context:{productName:"甲牌产品",trademark:"金丝鸟",batchNo:"ABC-01",lineName:"三号线",produceDate:"2026-10-15",lineWorkflow:true},summary:{collected:6}},{id:"r2",identity:{name:"老刘",username:"002"},mode:"external",context:{},summary:{collected:2}}]');await evaluate('document.getElementById("history").click()');await wait('!document.getElementById("backup").disabled');assert.equal(await evaluate('document.getElementById("legacyEntry")===null'),true);await evaluate('document.getElementById("backup").click()');assert.equal(await evaluate('window.__workerBackup'),true);for(const word of ['金丝','abc','三号','2026-10-15','甲牌 ABC']){await evaluate('document.getElementById("historySearch").value='+JSON.stringify(word)+';document.getElementById("historySearch").dispatchEvent(new Event("input"))');assert.equal(await evaluate('document.querySelectorAll(".record-card").length'),1);}await evaluate('document.querySelector("[data-detail]").click()');await wait('!!document.getElementById("detailExport")');assert.equal(await evaluate('document.querySelector(".record-events pre").textContent'),'https://example.test/?full=0001');await evaluate('document.getElementById("detailExport").click()');assert.equal(await evaluate('window.__workerTxt'),'r1');await evaluate('document.getElementById("detailBack").click()');await wait('!document.getElementById("backup").disabled');await evaluate('document.getElementById("historySearch").value="不存在";document.getElementById("historySearch").dispatchEvent(new Event("input"))');assert.equal(await evaluate('document.getElementById("historyList").textContent'),'没有匹配的记录');await evaluate('document.getElementById("historyClear").click()');assert.equal(await evaluate('document.querySelectorAll(".record-card").length'),2);
    await evaluate('document.getElementById("historyBack").click();window.__registrationRequired=true;window.__unconfirmed=true');await wait('!!document.getElementById("activationInput")');
    assert.equal(await evaluate('document.getElementById("companyLabel").textContent'),'农资315 · 设备激活');
    assert.equal(await evaluate('document.getElementById("deviceLabel").textContent'),'设备未登记');
    assert.equal(await evaluate('document.getElementById("main").textContent.includes("未上传记录")'),true);
    await evaluate('document.getElementById("activationHistory").click()');await wait('!document.getElementById("backup").disabled');await evaluate('document.getElementById("backup").click()');
    assert.equal(await evaluate('window.__workerBackup'),true);await delay(1200);assert.equal(await evaluate('!!document.getElementById("backup")'),true);
    await command('Page.navigate',{url:origin+'/worker/index.html?deleted=1'});await wait('!!document.getElementById("activationInput")');
    assert.equal(await evaluate('document.getElementById("loginForm")===null'),true);
    await command('Page.navigate',{url:origin+'/index.html?history=1&offline=1'});await wait('!!document.getElementById("legacyHistoryTitle")');assert.deepEqual(await evaluate('window.__requests'),[]);assert.equal(await evaluate('document.getElementById("activationCode")===null'),true);await command('Page.navigate',{url:origin+'/index.html?offline=1'});await wait('!!document.getElementById("verifyDevice")');await evaluate('[...document.querySelectorAll("button")].find(x=>x.textContent==="外部采集（可离线）").click()');await wait('!!document.getElementById("loginForm")');assert.equal(await evaluate('document.getElementById("externalWorker")===null'),true);await command('Page.navigate',{url:origin+'/worker/index.html?worker=1&operator=1'});await wait('!!document.getElementById("product")');assert.equal(await evaluate('document.getElementById("history")===null'),true);assert.equal(await evaluate('document.getElementById("cachedProducts")===null'),true);assert.equal(await evaluate('document.getElementById("legacyEntry")===null'),true);
    await evaluate('window.__workerPools=[];window.__workerCache={id:"loading"};document.getElementById("back").click();document.querySelector("button[value=cancel]").click()');
    // A newly downloaded snapshot must refresh BOTH product and line dropdowns.
    await command('Page.reload');await wait('!!document.getElementById("line")');await evaluate('window.__workerPools=[];window.__workerCache={id:"empty"}');await delay(1100);assert.equal(await evaluate('document.getElementById("line").options.length'),1);
    await evaluate('window.__workerPools=[{line_name:"新下载产线"}];window.__workerCache={id:"fresh"}');await wait('document.getElementById("line").options.length===2');assert.equal(await evaluate('document.getElementById("line").options[1].textContent'),'新下载产线');assert.deepEqual(errors,[]);
  }finally{
    if(ws)ws.close();browser.kill();await new Promise(resolve=>server.close(resolve));
    // 仅删除本测试创建、位于系统临时目录的独立浏览器目录。
    const resolved=path.resolve(profile);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));for(let i=0;i<20;i++){try{fs.rmSync(resolved,{recursive:true,force:true});break;}catch(_){await delay(100);}}
  }
});
