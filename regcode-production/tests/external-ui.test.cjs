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
collectExternal(raw){window.__nativeCalls.push('external');if(!armed)return JSON.stringify({ok:false,error:'已暂停'});if(!q.batch||q.batch.state!=='open')return JSON.stringify({ok:false,error:'旧采集已结束，请从生产扫码开始新采集'});window.__captured.push(raw);if(!q.batch||q.batch.state!=='open'){sequence=0;q.batch={id:crypto.randomUUID(),state:'open',worker_no:q.selection.workerNo};q.counts={collected:0,accepted:0,localDuplicates:0,duplicates:0,rejected:0};q.recent=[];}const localKind=events.includes(raw)?'duplicate':'valid';events.push(raw);q.counts[localKind==='valid'?'collected':'localDuplicates']++;q.queueCounts.waiting++;const event={eventId:crypto.randomUUID(),sequence:++sequence,rawCode:raw,capturedAt:new Date().toISOString(),localKind};q.recent.unshift({event,localKind,receipt:null});return JSON.stringify({ok:true,event});},
collect(){throw new Error('外部采集不能调用内部码解析');},finishExternal(){if(!q.batch||q.batch.state!=='open')return JSON.stringify({...q,finishRequested:false});q.batch.state='sealed';archived.push(q.batch.id);q.batchCounts.pending++;return JSON.stringify({...q,finishRequested:true});},uploadExternal:()=>JSON.stringify({ok:true,message:'正在补传'}),configure:()=>'',};
window.__resumeLegacy=()=>{q.batch={id:'legacy-open',state:'open',worker_no:'001'};q.counts={collected:0,accepted:0,localDuplicates:0,duplicates:0,rejected:0};};
window.WorkerNative={scanning(value){armed=value;},snapshot:()=>JSON.stringify({ok:true,identity:new URLSearchParams(location.search).has('worker')?{id:1,name:'隔离工人'}:null,device:{enterpriseName:context.enterpriseName,name:'隔离设备'},registrationRequired:window.__registrationRequired,unconfirmedWork:window.__unconfirmed,allWaiting:0,message:'隔离测试',history:[],run:window.__workerRun||null,cache:{id:window.__cacheId||'initial'},counts:{duplicates:window.__duplicates||0},recent:[],openRuns:window.__openRuns||[],products:window.__products||[{id:1,name:"已入库产品甲",registration_no:"PD00000001",spec_name:"200毫升"},{id:2,name:"已入库产品乙",registration_no:"PD00000002",spec_name:"500毫升"}],pools:window.__pools||[{task_id:9,product_id:1,task_name:"任务甲",line_name:"一号线",memberIds:[1]},{line_name:'二号线',memberIds:[999]}]}),collect(raw){window.__duplicates=(window.__duplicates||0)+1;return JSON.stringify({ok:true,event:{eventId:String(window.__duplicates),kind:'duplicate',rawCode:raw,reason:'重复扫码，保留记录但不重复计数。'.repeat(100)}});},backup(){window.__workerBackup=true;},upload(){},call(id,action,raw){if(action!=='start')throw Error('此网页测试不提交其他业务');window.__lastWorkerStart=JSON.parse(raw);window.__workerRun={id:'mock-run',mode:'production',context:window.__lastWorkerStart};setTimeout(()=>WorkerApi.receive(id,{ok:true}),0);}};
})();`;
async function delay(ms){await new Promise(resolve=>setTimeout(resolve,ms));}
test('真实网页覆盖统一生产入口、旧批续传、原文、暂停与离线记录',{skip:!fs.existsSync(edge),timeout:45000},async()=>{
  const server=http.createServer((request,response)=>{
    const requested=new URL(request.url,'http://localhost').pathname.slice(1)||'index.html',worker=requested.startsWith('worker/'),name=worker?requested.slice(7):requested;
    if(name==='mock-native.js'){response.setHeader('Content-Type','text/javascript');response.end(fixture);return;}
    if(!(worker?['index.html','worker.js','worker.css','production-preparation.js']:['index.html','app.js','core.js','app.css','favicon.svg']).includes(name)){response.writeHead(404).end();return;}
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
    await evaluate('document.getElementById("externalBack").click()');await wait('!!document.getElementById("legacyEntry")');assert.equal(await evaluate('document.getElementById("main").textContent.includes("工人登录")'),true);
    await evaluate('document.getElementById("legacyEntry").click()');await wait('!!document.getElementById("externalEntry")');
    await command('Page.navigate',{url:origin+'/worker/index.html?worker=1'});await wait('!!document.getElementById("production")');assert.equal(await evaluate('document.getElementById("external")===null'),true);assert.equal(await evaluate('document.getElementById("legacyEntry").textContent'),'历史记录与旧队列');
    await evaluate('document.getElementById("production").click()');await wait('!!document.getElementById("product")');
    assert.equal(await evaluate('document.getElementById("product").options.length'),3);
    // 使用实际触摸事件选择候选，不能只赋值绕过WebView下拉兼容问题。
    assert.equal(await evaluate('!!document.getElementById("linePicker")'),true,'提供不依赖datalist的产线选择按钮');
    const tap=async selector=>{const point=await evaluate('(()=>{const b=document.querySelector('+JSON.stringify(selector)+');b.scrollIntoView({block:"center"});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
    await command('Emulation.setDeviceMetricsOverride',{width:360,height:640,deviceScaleFactor:1,mobile:true});
    await command('Emulation.setTouchEmulationEnabled',{enabled:true});
    await tap('#linePicker');assert.equal(await evaluate('document.getElementById("lineOptions").hidden'),false);
    if(process.env.NZ315_UI_SHOTS){fs.mkdirSync(process.env.NZ315_UI_SHOTS,{recursive:true});const shot=await command('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.NZ315_UI_SHOTS,'line-picker.png'),Buffer.from(shot.result.data,'base64'));}
    await tap('#lineOptions button:nth-child(2)');assert.equal(await evaluate('document.getElementById("line").value'),'二号线');assert.equal(await evaluate('document.getElementById("lineLabel").textContent'),'二号线');
    assert.equal(await evaluate('document.getElementById("lineOptions").hidden'),true);
    await evaluate('document.getElementById("line").value="一";document.getElementById("line").dispatchEvent(new Event("input"))');assert.equal(await evaluate('document.querySelectorAll("#lineOptions button").length'),1);
    await evaluate('document.getElementById("line").value="自定义产线";document.getElementById("line").dispatchEvent(new Event("input"))');assert.equal(await evaluate('document.getElementById("lineLabel").textContent'),'自定义产线');
    await evaluate('window.__pools=[{line_name:"新产线"},{line_name:"新产线"},{line_name:"<产线&测试>"}];window.__cacheId="updated"');await delay(1100);
    assert.equal(await evaluate('document.getElementById("line").value'),'自定义产线');assert.equal(await evaluate('document.getElementById("lineLabel").textContent'),'自定义产线');
    await tap('.page-heading h1');await tap('#linePicker');assert.deepEqual(await evaluate('[...document.querySelectorAll("#lineOptions button")].map(b=>b.textContent)'),['新产线','<产线&测试>']);
    await tap('#lineOptions button:nth-child(2)');assert.equal(await evaluate('document.getElementById("line").value'),'<产线&测试>');
    // 大量缓存中的搜索不依赖联网，不改已选产线、产品或已填资料。
    await evaluate('window.__products=Array.from({length:1250},(_,i)=>({id:i+1,name:"测试产品"+(i+1),trademark:i%2?"金丝鸟":"甲商标",registration_no:"PD"+String(i+1).padStart(8,"0"),spec_name:i%2?"500毫升":"200毫升"}));window.__products[1249].name="<特殊&产品>";window.__pools=Array.from({length:350},(_,i)=>({line_name:"A区产线"+(i+1)}));window.__cacheId="many-products"');await delay(1100);
    await tap('#linePicker');await command('Input.insertText',{text:'Ａ区 350'});
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#lineOptions button")].map(b=>b.textContent)'),['A区产线350']);
    if(process.env.NZ315_UI_SHOTS){const shot=await command('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.NZ315_UI_SHOTS,'line-keyword.png'),Buffer.from(shot.result.data,'base64'));}
    assert.equal(await evaluate('document.getElementById("line").value'),'<产线&测试>','搜产线不会把关键词当作产线名称');
    await tap('#lineSearchClear');assert.equal(await evaluate('document.querySelectorAll("#lineOptions button").length'),350);
    await evaluate('document.getElementById("lineSearch").value="不存在";document.getElementById("lineSearch").dispatchEvent(new Event("input"))');assert.equal(await evaluate('document.querySelectorAll("#lineOptions button").length'),0);
    await evaluate('document.getElementById("lineSearch").value="350";document.getElementById("lineSearch").dispatchEvent(new Event("input"))');await tap('#lineOptions button');assert.equal(await evaluate('document.getElementById("line").value'),'A区产线350');
    assert.equal(await evaluate('document.getElementById("product").options.length'),1251,'缓存后面的产品也可以搜索');
    const searchProduct=async text=>evaluate('document.getElementById("productSearch").value='+JSON.stringify(text)+';document.getElementById("productSearch").dispatchEvent(new Event("input"))');
    await searchProduct(' 金丝鸟　５００　ｐｄ００００１２５０ ');
    assert.deepEqual(await evaluate('[...document.getElementById("product").options].map(o=>o.value)'),['','1250']);
    assert.equal(await evaluate('document.querySelector("#product script")===null'),true);
    if(process.env.NZ315_UI_SHOTS){await evaluate('document.getElementById("productSearch").scrollIntoView({block:"center"})');const shot=await command('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.NZ315_UI_SHOTS,'product-keyword.png'),Buffer.from(shot.result.data,'base64'));}
    await evaluate('document.getElementById("product").value="1250";document.getElementById("product").dispatchEvent(new Event("change"));document.getElementById("batchNo").value="关键词测试批号";document.getElementById("produceDate").value="2026-09-30";document.getElementById("expireDate").value="2027-09-30"');
    await searchProduct('不存在');
    assert.equal(await evaluate('document.getElementById("product").value'),'1250');assert.equal(await evaluate('document.getElementById("productCount").textContent.includes("匹配 0 / 1250")&&document.getElementById("productCount").textContent.includes("已选产品保留")'),true);
    await tap('#productSearchClear');assert.equal(await evaluate('document.getElementById("product").options.length'),1251);
    assert.deepEqual(await evaluate('["product","line","batchNo","produceDate","expireDate"].map(id=>document.getElementById(id).value)'),['1250','A区产线350','关键词测试批号','2026-09-30','2027-09-30']);
    for(const keyword of ['甲商标','测试产品1200','PD00001250','200毫升','<特殊&产品>']){await searchProduct(keyword);assert.equal(await evaluate('Number(document.getElementById("productCount").textContent.match(/匹配 ([0-9]+)/)[1])>0'),true,keyword);}
    await searchProduct('金丝鸟 500');
    await evaluate('document.getElementById("linePicker").click();document.getElementById("lineSearch").value="350";document.getElementById("lineSearch").dispatchEvent(new Event("input"));window.__products.push({id:1251,name:"金丝鸟新缓存产品",spec_name:"500毫升"});window.__pools.push({line_name:"B区产线350"});window.__cacheId="search-refresh"');await delay(1100);
    assert.equal(await evaluate('document.getElementById("productSearch").value'),'金丝鸟 500');assert.equal(await evaluate('document.getElementById("product").value'),'1250');assert.equal(await evaluate('document.getElementById("batchNo").value'),'关键词测试批号');
    assert.equal(await evaluate('document.getElementById("lineSearch").value'),'350');assert.equal(await evaluate('document.querySelectorAll("#lineOptions button").length'),2);
    await tap('.page-heading h1');
    await evaluate('window.__products=undefined;window.__cacheId="restored-products"');await delay(1100);
    assert.equal(await evaluate('document.getElementById("product").value'),'','缓存移除已选产品时必须取消旧ID');
    await searchProduct('不存在');assert.equal(await evaluate('document.getElementById("product").options.length'),1);await tap('#productSearchClear');
    await evaluate('window.__products=[];window.__pools=[];window.__cacheId="empty-products"');await delay(1100);
    assert.equal(await evaluate('document.getElementById("productCount").textContent.includes("匹配 0 / 0")'),true);
    await tap('#linePicker');assert.equal(await evaluate('document.getElementById("lineCount").textContent.includes("匹配 0 / 0")'),true);
    await tap('.page-heading h1');await evaluate('window.__products=undefined;window.__pools=undefined;window.__cacheId="restored-again"');await delay(1100);
    await evaluate('window.__openRuns=[{mode:"production",context:{productId:1,lineName:"原批产线",batchNo:"原批号",produceDate:"2026-10-01",expireDate:"2028-10-01"}}]');await delay(1100);
    await evaluate('document.getElementById("product").value="1";document.getElementById("product").dispatchEvent(new Event("change"))');
    assert.equal(await evaluate('document.getElementById("line").disabled&&document.getElementById("linePicker").disabled&&document.getElementById("lineOptions").hidden'),true,'续批锁定原产线');
    await searchProduct('产品乙');await tap('#productSearchClear');
    assert.deepEqual(await evaluate('["line","batchNo","produceDate","expireDate"].map(id=>document.getElementById(id).value)'),['原批产线','原批号','2026-10-01','2028-10-01']);
    assert.equal(await evaluate('document.getElementById("lineSearch").disabled&&document.getElementById("lineSearchClear").disabled'),true);
    await evaluate('document.getElementById("product").value="2";document.getElementById("product").dispatchEvent(new Event("change"));document.getElementById("line").value="二号线";document.getElementById("batchNo").value="B2";document.getElementById("produceDate").value="2026-10-13";document.getElementById("expireDate").value="2027-10-13";document.getElementById("start").click();document.querySelector("button[value=yes]").click()');
    await wait('!!document.getElementById("toggle")');assert.equal(await evaluate('window.__lastWorkerStart.productId'),2);assert.equal(await evaluate('window.__lastWorkerStart.stockWorkflow'),true);assert.equal(await evaluate('window.__lastWorkerStart.unifiedScan'),true);assert.equal(await evaluate('window.__lastWorkerStart.taskId'),0);assert.equal(await evaluate('window.__lastWorkerStart.autoLine'),true);assert.equal(await evaluate('window.__lastWorkerStart.lineName'),'二号线');
    await evaluate('document.getElementById("toggle").click();for(let i=0;i<80;i++)window.PDAScanAdapter.onScan("重复码");document.getElementById("toggle").click();for(let i=0;i<30;i++)window.PDAScanAdapter.onScan("暂停后重扫")');
    assert.equal(await evaluate('document.getElementById("errors").textContent'),'80');
    assert.equal(await evaluate('document.getElementById("collected").textContent'),'0');
    assert.equal(await evaluate('document.getElementById("last").textContent.includes("重复码")'),true);
    assert.equal(await evaluate('document.querySelectorAll("#last").length===1&&document.querySelectorAll("#notice").length===1'),true,'连续扫码不堆叠提示节点');
    for(const [width,height] of [[320,240],[320,480],[360,640],[480,800],[720,1280]]){
      await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
      for(const fontSize of ['20px','26px']){
        await evaluate('(()=>{let style=document.getElementById("testTextScale");if(!style){style=document.createElement("style");style.id="testTextScale";document.head.appendChild(style);}style.textContent="button,input,select,.stats span,#last{font-size:'+fontSize+'}";})()');
        for(const where of [0,99999]){
          await evaluate('window.scrollTo(0,'+where+')');await delay(40);
          assert.equal(await evaluate('(()=>{const b=document.getElementById("finish"),r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&b.contains(hit);})()'),true,'重复提示和滚动不遮挡结束按钮 '+width+'x'+height+' '+fontSize);
          if(process.env.NZ315_UI_SHOTS&&width===320&&height===480&&fontSize==='26px'&&where===99999){const shot=await command('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.NZ315_UI_SHOTS,'repeat-controls.png'),Buffer.from(shot.result.data,'base64'));}
        }
      }
    }
    await tap('#finish');assert.equal(await evaluate('document.getElementById("confirm").open'),true,'连续提示后仍能触摸结束采集');
    await tap('#confirm button[value=cancel]');assert.equal(await evaluate('document.getElementById("confirm").open'),false);await wait('document.querySelector("#confirm button[value=cancel]").textContent==="取消"');
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
    await command('Page.navigate',{url:origin+'/index.html?offline=1'});await wait('!!document.getElementById("verifyDevice")');await evaluate('[...document.querySelectorAll("button")].find(x=>x.textContent==="外部采集（可离线）").click()');await wait('!!document.getElementById("loginForm")');assert.equal(await evaluate('document.getElementById("externalWorker")===null'),true);assert.deepEqual(errors,[]);
  }finally{
    if(ws)ws.close();browser.kill();await new Promise(resolve=>server.close(resolve));
    // 仅删除本测试创建、位于系统临时目录的独立浏览器目录。
    const resolved=path.resolve(profile);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));for(let i=0;i<20;i++){try{fs.rmSync(resolved,{recursive:true,force:true});break;}catch(_){await delay(100);}}
  }
});
