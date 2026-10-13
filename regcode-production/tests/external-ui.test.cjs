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
window.__captured=[];window.__nativeCalls=[];window.__archived=archived;window.__registrationRequired=new URLSearchParams(location.search).has('deleted');window.__unconfirmed=false;
window.Native={settings:()=>JSON.stringify({server:context.server,mode:'broadcast',stripTerminator:true}),requestId:()=>crypto.randomUUID(),deviceInfo:()=>JSON.stringify({hasCredential:true,registered:true}),queue:()=>JSON.stringify({ok:true,session:null}),capturing:value=>{armed=value;},externalQueue:()=>JSON.stringify(q),resumeUpload(){},confirmed(){},rejected(){},exit(){},exportBackup(){window.__backup=true;},openWorkerApp(){location.href='/worker/index.html';},openLegacyApp(){location.href='/index.html';},
request(id,method,url){setTimeout(()=>window.NzApi.receive(id,online?{status:200,body:url==='/api/device/context'?{ok:true,device:{id:2,enterprise_id:1,line_name:context.lineName},user:{id:0,device_id:2,enterprise_id:1,role:'code_admin',name:'隔离厂家'}}:{rows:[],total:0}}:{status:0,error:'隔离断网'}),0);},
prepareExternal(worker){worker=worker.trim();if(!worker||worker.length>64)return JSON.stringify({ok:false,error:'请填写64字以内的工号'});q.selection={...context,workerNo:worker};return JSON.stringify(q);},
collectExternal(raw){window.__nativeCalls.push('external');if(!armed)return JSON.stringify({ok:false,error:'已暂停'});window.__captured.push(raw);if(!q.batch||q.batch.state!=='open'){sequence=0;q.batch={id:crypto.randomUUID(),state:'open',worker_no:q.selection.workerNo};q.counts={collected:0,accepted:0,localDuplicates:0,duplicates:0,rejected:0};q.recent=[];}const localKind=events.includes(raw)?'duplicate':'valid';events.push(raw);q.counts[localKind==='valid'?'collected':'localDuplicates']++;q.queueCounts.waiting++;const event={eventId:crypto.randomUUID(),sequence:++sequence,rawCode:raw,capturedAt:new Date().toISOString(),localKind};q.recent.unshift({event,localKind,receipt:null});return JSON.stringify({ok:true,event});},
collect(){throw new Error('外部采集不能调用内部码解析');},finishExternal(){if(!q.batch||q.batch.state!=='open')return JSON.stringify({...q,finishRequested:false});q.batch.state='sealed';archived.push(q.batch.id);q.batchCounts.pending++;return JSON.stringify({...q,finishRequested:true});},uploadExternal:()=>JSON.stringify({ok:true,message:'正在补传'}),configure:()=>'',};
window.WorkerNative={scanning(value){armed=value;},snapshot:()=>JSON.stringify({ok:true,identity:new URLSearchParams(location.search).has('worker')?{id:1,name:'隔离工人'}:null,device:{enterpriseName:context.enterpriseName,name:'隔离设备'},registrationRequired:window.__registrationRequired,unconfirmedWork:window.__unconfirmed,allWaiting:0,message:'隔离测试',history:[],run:window.__workerRun||null,counts:{},recent:[],openRuns:[],products:[{id:1,name:"已入库产品甲",registration_no:"PD00000001",spec_name:"200毫升"},{id:2,name:"已入库产品乙",registration_no:"PD00000002",spec_name:"500毫升"}],pools:[{task_id:9,product_id:1,task_name:"任务甲",line_name:"一号线",memberIds:[1]}]}),backup(){window.__workerBackup=true;},upload(){},call(id,action,raw){if(action!=='start')throw Error('此网页测试不提交其他业务');window.__lastWorkerStart=JSON.parse(raw);window.__workerRun={id:'mock-run',mode:'production',context:window.__lastWorkerStart};setTimeout(()=>WorkerApi.receive(id,{ok:true}),0);}};
})();`;
async function delay(ms){await new Promise(resolve=>setTimeout(resolve,ms));}
test('真实网页覆盖双模式入口、工号、原文、固定批次、暂停与离线入口',{skip:!fs.existsSync(edge),timeout:30000},async()=>{
  const server=http.createServer((request,response)=>{
    const requested=new URL(request.url,'http://localhost').pathname.slice(1)||'index.html',worker=requested.startsWith('worker/'),name=worker?requested.slice(7):requested;
    if(name==='mock-native.js'){response.setHeader('Content-Type','text/javascript');response.end(fixture);return;}
    if(!(worker?['index.html','worker.js','worker.css']:['index.html','app.js','core.js','app.css','favicon.svg']).includes(name)){response.writeHead(404).end();return;}
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
    await wait('!!document.getElementById("externalEntry")');await evaluate('document.getElementById("externalEntry").click()');await wait('!!document.getElementById("externalWorker")');
    assert.equal(await evaluate('document.getElementById("main").textContent.includes("一号流水线")'),true);
    await evaluate('document.getElementById("externalWorkerForm").dispatchEvent(new Event("submit",{cancelable:true}))');assert.equal(await evaluate('!!document.getElementById("externalWorker")'),true);
    await evaluate('document.getElementById("externalWorker").value="001";document.getElementById("externalWorkerForm").dispatchEvent(new Event("submit",{cancelable:true}));document.getElementById("externalToggle").click()');
    const raw=' https://outside.example/?code=00001&x=%2f&name=<script>甲😀</script> ';
    await evaluate('window.PDAScanAdapter.onScan('+JSON.stringify(raw)+')');assert.deepEqual(await evaluate('window.__captured'),[raw]);assert.equal(await evaluate('document.getElementById("externalRecent").textContent.includes('+JSON.stringify(raw)+')'),true);assert.equal(await evaluate('document.querySelector("#externalRecent script")===null'),true);
    const first=await evaluate('JSON.parse(Native.externalQueue()).batch.id');await evaluate('document.getElementById("externalFinish").click();window.PDAScanAdapter.onScan("0000002")');assert.notEqual(await evaluate('JSON.parse(Native.externalQueue()).batch.id'),first);assert.deepEqual(await evaluate('window.__archived'),[first]);
    await evaluate('window.App.lifecycle(false);window.PDAScanAdapter.onScan("暂停不能采集")');assert.equal(await evaluate('window.__captured.length'),2);await evaluate('window.App.lifecycle(true)');assert.equal(await evaluate('document.getElementById("externalToggle").textContent'), '开始连续采集');
    await evaluate('document.getElementById("externalBack").click();document.getElementById("workerEntry").click()');await wait('!!document.getElementById("legacyEntry")');assert.equal(await evaluate('document.getElementById("main").textContent.includes("工人登录")'),true);
    await evaluate('document.getElementById("legacyEntry").click()');await wait('!!document.getElementById("externalEntry")');
    await command('Page.navigate',{url:origin+'/worker/index.html?worker=1'});await wait('!!document.getElementById("external")');assert.equal(await evaluate('document.getElementById("external").textContent'),'外码采集');assert.equal(await evaluate('document.getElementById("legacyEntry").textContent'),'外部原文采集与旧记录');
    await evaluate('document.getElementById("production").click()');await wait('!!document.getElementById("product")');
    assert.equal(await evaluate('document.getElementById("product").options.length'),3);
    await evaluate('document.getElementById("product").value="2";document.getElementById("product").dispatchEvent(new Event("change"));document.getElementById("batchNo").value="B2";document.getElementById("produceDate").value="2026-10-13";document.getElementById("expireDate").value="2027-10-13";document.getElementById("start").click();document.querySelector("button[value=yes]").click()');
    await wait('!!document.getElementById("toggle")');assert.equal(await evaluate('window.__lastWorkerStart.productId'),2);assert.equal(await evaluate('window.__lastWorkerStart.stockWorkflow'),true);assert.equal(await evaluate('window.__lastWorkerStart.taskId'),9);
    await evaluate('window.App.back();window.App.back()');
    await evaluate('document.getElementById("history").click()');assert.equal(await evaluate('!!document.getElementById("legacyEntry")'),true);await evaluate('document.getElementById("backup").click()');assert.equal(await evaluate('window.__workerBackup'),true);
    await evaluate('document.getElementById("historyBack").click();window.__registrationRequired=true;window.__unconfirmed=true');await wait('!!document.getElementById("activationInput")');
    assert.equal(await evaluate('document.getElementById("companyLabel").textContent'),'农资315 · 设备激活');
    assert.equal(await evaluate('document.getElementById("deviceLabel").textContent'),'设备未登记');
    assert.equal(await evaluate('document.getElementById("main").textContent.includes("未上传记录")'),true);
    await evaluate('document.getElementById("activationHistory").click();document.getElementById("backup").click()');
    assert.equal(await evaluate('window.__workerBackup'),true);await delay(1200);assert.equal(await evaluate('!!document.getElementById("backup")'),true);
    await command('Page.navigate',{url:origin+'/worker/index.html?deleted=1'});await wait('!!document.getElementById("activationInput")');
    assert.equal(await evaluate('document.getElementById("loginForm")===null'),true);
    await command('Page.navigate',{url:origin+'/index.html?offline=1'});await wait('!!document.getElementById("verifyDevice")');await evaluate('[...document.querySelectorAll("button")].find(x=>x.textContent==="外部采集（可离线）").click()');assert.equal(await evaluate('!!document.getElementById("externalWorker")'),true);assert.deepEqual(errors,[]);
  }finally{
    if(ws)ws.close();browser.kill();await new Promise(resolve=>server.close(resolve));
    // 仅删除本测试创建、位于系统临时目录的独立浏览器目录。
    const resolved=path.resolve(profile);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));for(let i=0;i<20;i++){try{fs.rmSync(resolved,{recursive:true,force:true});break;}catch(_){await delay(100);}}
  }
});
