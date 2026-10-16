(function(){'use strict';
 const $=id=>document.getElementById(id),esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let page='login',q={},scanning=false,busy=false,foreground=true,last='',noticeTimer,pendingEnd=null,endedRun='';const calls=new Map();
 const isLeader=()=>q.identity&&q.identity.role==='line_leader';
 const click=(id,fn)=>{if($(id))$(id).onclick=()=>{if(!busy)fn();}};
 function toast(text){$('notice').textContent=text;$('notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').hidden=true,6000);}
 function read(){q=JSON.parse(WorkerNative.snapshot());if(!q.ok)throw Error(q.error||'本机数据无法读取');header();return q;}
 function header(context,productId){
  if(q.registrationRequired){$('companyLabel').textContent='农资315 · 设备激活';$('deviceLabel').textContent='设备未登记';$('lineLabel').hidden=true;return;}
  const d=q.device||{},person=q.identity||{};
  $('companyLabel').textContent=person.enterpriseName||d.enterpriseName||'农资315 · 生产采集';
  $('deviceLabel').textContent=q.identity?[person.name,'工号 '+person.username].filter(Boolean).join(' · '):(d.name||'设备身份待联网确认');
  const pools=assignedPools(),lines=[...new Set(pools.map(p=>p.line_name).filter(Boolean))];
  $('lineLabel').textContent=context&&context.lineName?context.lineName:'生产线待选择';
  $('lineLabel').hidden=!q.identity;
 }
 function arrow(id,side){return '<button id="'+id+'" class="back-arrow '+side+'" aria-label="返回" title="返回">←</button>';}
 function heading(title,id,side){return '<div class="page-heading '+side+'">'+arrow(id,side)+'<h1>'+title+'</h1></div>';}
 function stats(prefix){return '<div class="grid stats">'+[['collected','有效采集合计'],['internal','内部码'],['external','外部码'],['saved','服务器确认'],['waiting','待上传'],['errors','重复／异常']].map(([id,label])=>'<div><strong id="'+prefix+id+'">0</strong><span>'+label+'</span></div>').join('')+'</div>';}
 function paintStats(prefix,c){for(const id of ['collected','internal','external','saved','waiting'])$(prefix+id).textContent=Number(c[id]||0);$(prefix+'errors').textContent=Number(c.duplicates||0)+Number(c.exceptions||0);}
 function scanBack(){stop();if(q.run&&q.run.mode==='production')prepare();else home();}

 function stop(){scanning=false;WorkerNative.scanning(false);}
 function show(name,html){stop();page=name;document.body.dataset.page=name;$('main').innerHTML=html;window.scrollTo(0,0);}
 function call(action,data){busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);return new Promise((resolve,reject)=>{const id=Native.requestId(),timer=setTimeout(()=>{calls.delete(id);busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);reject(Error('操作尚未确认，本机记录保留，请核对后重试'));},120000);calls.set(id,r=>{clearTimeout(timer);busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);if(r.ok!==false)resolve(r);else reject(Error(r.error||'操作未完成'));});WorkerNative.call(id,action,JSON.stringify(data||{}));});}
 window.WorkerApi={receive(id,result){const done=calls.get(id);if(done){calls.delete(id);done(result);}}};
 async function confirm(text){stop();$('confirmText').textContent=text;return new Promise(resolve=>{$('confirm').addEventListener('close',()=>resolve($('confirm').returnValue==='yes'),{once:true});$('confirm').showModal();});}
 function field(id,label,type,value){return '<label><span>'+label+'</span><input id="'+id+'" type="'+type+'" value="'+esc(value||'')+'" required></label>';}
 function login(){read();if(q.registrationRequired){activation();return;}show('login','<h1>工人登录</h1><p>每人使用自己的工号，可在本厂设备轮换登录。</p><form id="loginForm" class="card">'+field('username','工号','text','')+field('password','密码','password','')+'<button class="primary">登录</button></form><p class="muted">首次需联网。已验证工人可以在72小时授权内离线登录。</p>');$('username').autocomplete='username';$('password').autocomplete='current-password';$('loginForm').onsubmit=async e=>{e.preventDefault();if(busy)return;try{await call('login',{username:$('username').value.trim(),password:$('password').value});$('password').value='';home();}catch(error){toast(error.message);}};}
 function registrationRoute(){if(!q.registrationRequired||['activate','history','ended'].includes(page))return false;if(pendingEnd){$('confirm').close('cancel');}activation();return true;}
 function activation(){read();show('activate','<h1>请扫码激活设备</h1><p>请扫描后台生成的设备激活二维码。</p>'+(q.unconfirmedWork?'<p class="status warning">本机还有未结束或未上传记录，已暂停扫码。请先保留备份并联系管理员处理，再更换登记。</p>':'')+'<div class="card"><input id="activationInput" placeholder="扫码输入"><button id="activate" class="primary">确认激活</button></div>'+(isLeader()?'<button id="activationHistory">我的记录与备份</button>':'')+'<p class="muted">本机采集记录保留。</p>');header();WorkerNative.scanning(true);click('activate',()=>activate($('activationInput').value));click('activationHistory',history);$('activationInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();activate($('activationInput').value);}};}
 async function activate(code){try{await call('activate',{activationCode:code});login();toast('设备已激活，请工人登录');}catch(error){toast(error.message);}}
 function home(){read();if(q.registrationRequired){activation();return;}if(!q.identity){login();return;}if(!isLeader()){prepare();return;}show('home','<div class="brandline"><h1>'+esc(q.identity.name)+'</h1><button id="logout">退出登录</button></div><button id="production" class="primary">生产扫码</button><div class="status">设备待上传：'+Number(q.allWaiting)+'条<br>'+esc(q.message)+'</div>'+(q.openRuns||[]).map(r=>'<button class="history" data-resume="'+esc(r.id)+'">继续原批 · '+esc(r.context.productName||'外码采集')+'<br>'+esc(r.context.batchNo||'')+'</button>').join('')+'<button id="history">我的记录与备份</button><button id="cachedProducts">本机产品（'+(q.products||[]).length+'）</button>');click('logout',logout);click('production',prepare);click('external',async()=>{try{await call('start',{mode:'external',name:'外码采集'});scan();}catch(error){toast(error.message);}});click('history',history);click('cachedProducts',cachedProducts);document.querySelectorAll('[data-resume]').forEach(b=>b.onclick=async()=>{try{await call('resume',{runId:b.dataset.resume});scan();}catch(error){toast(error.message);}});}
 async function logout(){try{await call('logout');login();}catch(error){toast(error.message);}}
 function assignedPools(){return (q.pools||[]).filter(p=>q.identity&&(!Array.isArray(p.memberIds)||p.memberIds.includes(q.identity.id)));}

 function taskChoice(){return '<label><span>生产线</span><select id="line" required><option value="">请选择生产线</option>'+WorkerPreparation.lines(q.pools).map(name=>'<option value="'+esc(name)+'">'+esc(name)+'</option>').join('')+'</select></label>';}
 function prepare(){
  read();const dates=WorkerPreparation.defaults(new Date());show('prepare',heading('生产准备','back','right')+'<div class="card">'+taskChoice()+'<label><span>选择产品</span><select id="product"></select></label><p id="productHint" class="muted"></p>'+'<div class="prepare-dates">'+field('produceDate','生产日期','date',dates.produceDate)+field('expireDate','有效期至','date',dates.expireDate)+'</div>'+field('batchNo','生产批号','text','')+'<button id="start" class="primary">确认，进入扫码</button></div>');
  click('back',async()=>{if(isLeader())home();else if(await confirm('退出当前账号？未上传记录会继续保留。'))logout();});products();$('product').onchange=productChanged;$('line').onchange=()=>header({lineName:$('line').value.trim()});
  if(q.run&&q.run.mode==='production'){$('product').value=String(q.run.context.productId);productChanged();}
  click('start',async()=>{const id=Number($('product').value),p=(q.products||[]).find(p=>Number(p.id)===id);if(!p){toast('请选择本厂启用产品');return;}const old=(q.openRuns||[]).find(r=>r.mode==='production'&&Number(r.context.productId)===id),lineName=$('line').value.trim();if(!lineName||(!old&&!WorkerPreparation.lines(q.pools).includes(lineName))){toast('请选择生产线');return;}
   const data=old?{...old.context}:{mode:'production',productId:id,lineWorkflow:true,stockWorkflow:true,unifiedScan:true,autoLine:true,taskId:0,lineName,productName:p.name,trademark:p.trademark,content:p.content,dosage:p.dosage,registrationNo:p.registration_no,specName:p.spec_name,batchNo:$('batchNo').value.trim(),produceDate:$('produceDate').value,expireDate:$('expireDate').value};
   if(!data.batchNo||!data.produceDate||!data.expireDate||data.expireDate<data.produceDate){toast('请核对批号、生产日期和有效期');return;}if(!await confirm(lineName+'\n'+WorkerPreparation.label(p)+'\n批号 '+data.batchNo+'\n生产 '+data.produceDate+'，有效期至 '+data.expireDate))return;try{await call('start',data);scan();}catch(error){read();toast(error.message);}});
 }
 function products(){$('product').dataset.snapshot=q.cache&&q.cache.id||'empty';const old=$('product').value,rows=q.products||[];$('product').innerHTML='<option value="">请选择产品</option>'+rows.map(p=>'<option value="'+p.id+'">'+esc(WorkerPreparation.label(p))+'</option>').join('');if(rows.some(p=>String(p.id)===old))$('product').value=old;productChanged();}
 function prepareCacheUpdate(){read();if(($('product').dataset.snapshot||'')===(q.cache&&q.cache.id||'empty'))return;const saved={line:$('line').value,produceDate:$('produceDate').value,expireDate:$('expireDate').value,batchNo:$('batchNo').value};$('line').innerHTML='<option value="">请选择生产线</option>'+WorkerPreparation.lines(q.pools).map(name=>'<option value="'+esc(name)+'">'+esc(name)+'</option>').join('');products();if(!$('line').disabled)for(const key of Object.keys(saved))$(key).value=saved[key];}
 function productChanged(){
  const id=Number($('product').value),p=(q.products||[]).find(p=>Number(p.id)===id),old=(q.openRuns||[]).find(r=>r.mode==='production'&&Number(r.context.productId)===id);
  $('productHint').textContent=old?'继续原批，资料保持不变':'';$('productHint').hidden=!$('productHint').textContent;
  $('line').disabled=!!old;if(old){const name=old.context.lineName||'';if(name&&!Array.from($('line').options).some(option=>option.value===name))$('line').add(new Option(name,name));$('line').value=name;}header(old?old.context:{lineName:$('line').value.trim()},id);
  const dates=WorkerPreparation.defaults(new Date());for(const key of ['produceDate','expireDate','batchNo']){$(key).disabled=!!old;$(key).value=old?old.context[key]:key==='batchNo'?'':dates[key];}
 }

 function scan(){
  read();if(registrationRoute())return;if(!q.run){home();return;}const c=q.run.context,external=q.run.mode==='external';
  show('scan',heading(external?'外码采集':'生产扫码','scanBack','left')+'<div class="batch-info"><h2>'+esc([c.trademark,c.productName].filter(Boolean).join(' · ')||'外码采集')+'</h2>'+(!external?'<p>'+esc(c.specName||'')+' · 批号 '+esc(c.batchNo)+'</p><p class="batch-dates"><span>生产 '+esc(c.produceDate)+'</span><span>有效期 '+esc(c.expireDate)+'</span></p>':'')+'</div>'+stats('')+'<p id="sync" class="status"></p><p id="last" class="last">扫码已暂停</p><input id="scanInput" placeholder="实体扫码或输入原文" aria-label="扫码内容"><div class="row scan-actions"><button id="toggle" class="primary">开始连续采集</button><button id="finish" class="danger">结束采集</button></div>');
  header(c,c.productId);click('toggle',()=>{if(q.blocked){toast('设备已停用，请联系管理员');return;}scanning=!scanning;WorkerNative.scanning(scanning);$('toggle').textContent=scanning?'暂停采集':'开始连续采集';if(scanning)$('scanInput').focus();});click('scanBack',scanBack);click('finish',beginEnd);$('scanInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();collect($('scanInput').value);}};update();
 }

 function endNotice(){const run=q.run,cached=run?(q.pools||[]).find(p=>p.task_id===run.context.taskId):null,local=q.counts||{};let text='有效采集 '+Number(local.collected||0)+' · 待上传 '+Number(local.waiting||0);if(cached&&Number(cached.collected)<Number(cached.total))text+='\n整线尚有未扫描或未上传记录。';return text+'\n'+(q.networkAvailable?'结束后自动上传。':(isLeader()?'当前离线，结束后可导出TXT或联网补传。':'当前离线，记录已保存，联网后自动上传。'));}

 function beginEnd(){if(pendingEnd||busy)return;read();if(!q.run)return;const wasScanning=scanning;stop();if($('toggle'))$('toggle').textContent='开始连续采集';const dialog=$('confirm'),cancel=dialog.querySelector('button[value=cancel]'),yes=dialog.querySelector('button[value=yes]');yes.hidden=true;cancel.textContent='取消结束，继续采集';const state={runId:q.run.id,wasScanning,deadline:Date.now()+5000,timer:null};pendingEnd=state;
  const reset=()=>{yes.hidden=false;cancel.textContent='取消';};
  dialog.addEventListener('close',()=>{reset();if(pendingEnd===state){clearInterval(state.timer);pendingEnd=null;if(state.wasScanning&&foreground&&!q.blocked){scanning=true;WorkerNative.scanning(true);if($('toggle'))$('toggle').textContent='暂停采集';}toast('已取消结束，数据保留，可以继续采集');}},{once:true});
  function tick(){if(pendingEnd!==state)return;const seconds=Math.max(0,Math.ceil((state.deadline-Date.now())/1000));$('confirmText').textContent=seconds+' 秒后结束采集，可点击下方取消。\n\n'+endNotice();if(seconds===0){clearInterval(state.timer);pendingEnd=null;dialog.close('commit');endedRun=state.runId;call('finish').then(()=>ended()).catch(error=>{toast(error.message);scan();});}}
  tick();dialog.showModal();state.timer=setInterval(tick,100);
 }
 function ended(){
  read();show('ended','<div class="end-heading"><span class="end-icon" aria-hidden="true">✓</span><h1>采集已结束</h1></div>'+stats('end-')+'<p id="endSummary" class="status end-status" role="status"></p><button id="endUpload" class="primary">立即上传</button>'+(isLeader()?'<div class="row"><button id="endExport">导出TXT</button><button id="endBackup">完整备份</button></div>':'')+'<button id="endHome">'+(isLeader()?'返回首页':'继续下一批')+'</button>'+(!isLeader()?'<button id="endLogout">退出登录</button>':''));
  click('endUpload',()=>{WorkerNative.upload();toast('正在上传，请等待云端确认');});click('endExport',()=>WorkerNative.txt(endedRun));click('endBackup',()=>WorkerNative.backup());click('endHome',home);click('endLogout',logout);endUpdate();
 }

 function endUpdate(){
  read();const run=(q.history||[]).find(r=>r.id===endedRun),c=run&&run.summary||{};header(run&&run.context,run&&run.context.productId);paintStats('end-',c);
  $('endSummary').textContent=run&&run.cloud_done?'已全部上传':q.blocked?'设备停用，请联系管理员':!q.networkAvailable?(isLeader()?'当前离线 · 可导出TXT或联网上传':'当前离线 · 记录已保存，联网后自动上传'):/未确认|失败|失效/.test(q.message)?(isLeader()?'同步未确认 · 请重试或导出TXT':'同步未确认 · 请联网重试，记录已保留'):Number(c.waiting)>0?'正在上传，请稍候':'等待云端确认结束';
  $('endSummary').className='status end-status'+(run&&run.cloud_done?' complete':!q.networkAvailable||q.blocked?' warning':'');
  const production=!run||run.mode==='production';if($('endExport'))$('endExport').title=production?'导出生产记录 TXT':'导出外码原文 TXT（离线可用）';$('endUpload').hidden=!!(run&&run.cloud_done);
 }

 function collect(raw){if(pendingEnd){Native.rejected();toast('正在确认结束，扫码已暂停；取消结束后请重扫');return;}if(page==='activate'){activate(raw);return;}if(page!=='scan'||!scanning||!foreground||busy){if(page==='scan'){Native.rejected();toast('扫码已暂停，本次未保存，开始后请重扫');}return;}try{const r=JSON.parse(WorkerNative.collect(raw));if(!r.ok)throw Error(r.error);const e=r.event;last=e.eventId;$('scanInput').value='';$('last').className='last '+(e.kind==='invalid'?'error':e.kind==='duplicate'?'warning':'');$('last').textContent=(e.kind==='valid'?'已保存，可以扫描下一件':e.kind==='duplicate'?'重复码，已记录':'异常码，已记录')+' · '+(e.reason||(q.run.mode==='external'?e.rawCode:e.code||e.rawCode));if(e.kind==='valid')Native.confirmed();else Native.rejected();update();$('scanInput').focus();}catch(error){stop();$('toggle').textContent='开始连续采集';$('last').className='last error';$('last').textContent='本次未保存，需要重扫：'+error.message;}}
 function update(){read();if(registrationRoute())return;if(!q.identity){stop();login();return;}if(page!=='scan')return;if(q.blocked){stop();$('toggle').textContent='开始连续采集';}const c=q.counts||{};header(q.run&&q.run.context,q.run&&q.run.context.productId);paintStats('',c);$('sync').textContent=q.blocked?'设备已停用，请联系管理员':!q.networkAvailable?'离线 · 记录已保存本机':/未确认|失败|失效/.test(q.message)?'同步未确认，记录保留本机':Number(c.waiting)>0?'联网 · 等待自动上传':Number(c.total)>0?'联网 · 记录已上传':'联网 · 等待采集';const row=(q.recent||[]).find(r=>r.event.eventId===last);if(row&&row.receipt)$('last').textContent=(row.receipt.state==='saved'?'云端已保存':row.receipt.state==='duplicate'?'重复码，不计数':'异常记录')+' · '+({internal:'系统内部码',external:'外部码',own:'本厂码（历史分类）',other_enterprise:'本系统其他企业码（历史分类）',not_imported:'未入库内容（历史分类）',unparsed:'未识别到扫码网址'}[row.receipt.classification]||'')+' '+(row.receipt.reason||(q.run.mode==='external'?row.event.rawCode:row.event.code||row.event.rawCode));}

 function timeLabel(value){return value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';}
 function historyText(value){return String(value==null?'':value).normalize('NFKC').toLocaleLowerCase('zh-CN');}

 let recordScope='device',recordRows=[],recordPage=1,recordTotal=0,recordKeyword='',recordFrom='',recordTo='',historyLoad=0;
 function ownField(label,value){return '<div class="record-field"><span>'+esc(label)+'</span><strong>'+esc(value==null||value===''?'—':value)+'</strong></div>';}
 async function history(){
  read();if(!isLeader()){home();return;}
  show('history',heading('记录与备份','historyBack','left')+'<select id="recordScope" aria-label="记录范围"><option value="device">本机记录（离线）</option><option value="factory">本厂记录（联网）</option></select><p id="recordScopeNote" class="record-scope-note"></p><div class="history-search"><input id="historySearch" type="search" placeholder="员工、工号、产品、批号、产线" aria-label="搜索记录" autocomplete="off"><button id="recordQuery">查询</button><button id="historyClear">清空</button></div><details class="record-filters"><summary>日期筛选</summary><div class="prepare-dates record-filter-dates"><label>开始日期<input id="recordFrom" type="date"></label><label>结束日期<input id="recordTo" type="date"></label></div></details><p id="historyCount" class="muted" role="status"></p><div id="historyList" class="history-list"></div><button id="historyMore" hidden>显示更多</button><button id="backup" class="backup-button">备份本机记录</button>');
  $('recordScope').value=recordScope;$('historySearch').value=recordKeyword;$('recordFrom').value=recordFrom;$('recordTo').value=recordTo;
  click('historyBack',home);click('backup',()=>WorkerNative.backup());
  $('recordScope').onchange=()=>{recordScope=$('recordScope').value;loadRecords(true);};
  $('historySearch').oninput=()=>{recordKeyword=$('historySearch').value;if(recordScope==='device')renderRecords();};
  $('historySearch').onkeydown=e=>{if(e.key==='Enter')loadRecords(true);};
  click('recordQuery',()=>loadRecords(true));click('historyClear',()=>{recordKeyword='';recordFrom='';recordTo='';$('historySearch').value='';$('recordFrom').value='';$('recordTo').value='';loadRecords(true);});
  click('historyMore',()=>loadRecords(false));await loadRecords(true);
 }
 function renderRecords(){
  if(page!=='history')return;const words=historyText(recordKeyword).trim().split(/\s+/).filter(Boolean);
  const rows=recordRows.filter(r=>{const c=r.context||{},i=r.identity||{},text=historyText([i.name,i.username,i.deviceName,c.lineName,c.productName,c.trademark,c.specName,c.registrationNo,c.batchNo,c.produceDate,c.expireDate,r.id,r.startedAt,r.stoppedAt,timeLabel(r.startedAt),timeLabel(r.stoppedAt)].join(' ')),stamp=new Date(r.startedAt||0),day=stamp.getFullYear()+'-'+String(stamp.getMonth()+1).padStart(2,'0')+'-'+String(stamp.getDate()).padStart(2,'0');return (recordScope==='factory'||words.every(w=>text.includes(w)))&&(!recordFrom||day>=recordFrom)&&(!recordTo||day<=recordTo);});
  $('recordScopeNote').textContent=recordScope==='device'?'当前设备 · 本厂员工记录，可离线查询。':'本厂全部生产线 · 仅已上传记录。';
  $('backup').hidden=recordScope!=='device';$('historyCount').textContent=recordScope==='device'?'找到 '+rows.length+' / 共 '+recordRows.length+' 条':'已加载 '+recordRows.length+' / 共 '+recordTotal+' 条';
  $('historyMore').hidden=recordScope!=='factory'||recordRows.length>=recordTotal;
  $('historyList').innerHTML=rows.length?rows.map(r=>{const c=r.context||{},i=r.identity||{},n=r.summary||{};return '<button class="record-card" data-detail="'+esc(r.id)+'"><div class="record-card-top"><strong>'+esc(i.name||'未记录姓名')+'（'+esc(i.username||'—')+'）</strong><span>'+esc(r.state==='completed'?'已上传':r.state==='closing'?'待上传':'采集中')+'</span></div><p>'+esc(c.lineName||'未记录产线')+' · '+esc(i.deviceName||'未记录设备')+'</p><p class="record-product">'+esc([c.trademark,c.productName||'外码采集',c.specName].filter(Boolean).join(' · '))+'</p><p>批号 '+esc(c.batchNo||'—')+'</p><p>'+esc(timeLabel(r.startedAt))+' → '+esc(timeLabel(r.stoppedAt))+'</p><div class="record-counts"><span>有效 <b>'+Number(n.collected||0)+'</b></span><span>待上传 <b>'+Number(n.waiting||0)+'</b></span><span>重复 <b>'+Number(n.duplicates||0)+'</b></span><span>异常 <b>'+Number(n.exceptions||0)+'</b></span></div><span class="detail-link">查看完整详情 →</span></button>';}).join(''):'<p class="history-empty">没有匹配的记录</p>';
  document.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>recordDetail(b.dataset.detail));
 }
 async function loadRecords(reset){
  if(page!=='history')return;recordKeyword=$('historySearch').value;recordFrom=$('recordFrom').value;recordTo=$('recordTo').value;
  if(recordFrom&&recordTo&&recordFrom>recordTo){toast('开始日期不能晚于结束日期');return;}
  const load=++historyLoad;if(reset){recordPage=1;recordRows=[];}else recordPage++;$('historyCount').textContent='正在读取…';
  try{const data=await call('records',{scope:recordScope,page:recordPage,keyword:recordKeyword,from:recordFrom,to:recordTo});if(page!=='history'||load!==historyLoad)return;recordRows=reset?data.rows:recordRows.concat(data.rows);recordTotal=data.total||recordRows.length;renderRecords();}catch(error){if(page==='history'){$('historyCount').textContent=recordScope==='factory'?'读取失败，请联网后重试；当前设备记录仍可离线查看。':'本机记录读取失败，请重试。';if(!reset)recordPage--;}toast(error.message);}
 }
 async function recordDetail(id,eventPage=1,result=''){
  read();if(!isLeader()){home();return;}const scope=recordScope;
  show('recordDetail',heading('采集记录详情','detailBack','left')+'<p id="detailLoading">正在读取…</p><div id="recordDetail"></div>');click('detailBack',history);
  try{const data=await call('recordDetail',{scope,sessionId:id,page:eventPage,result});if(page!=='recordDetail')return;const r=data.record,c=r.context||{},i=r.identity||{},n=r.summary||{},actions=data.actions||[],firstStart=actions.find(a=>a.kind==='start');
   $('detailLoading').remove();$('recordDetail').innerHTML='<p class="muted">'+(scope==='device'?'当前设备记录':'本厂已上传记录')+'</p><div class="record-fields">'+[
    ['采集员工',i.name],['工号',i.username],['设备',i.deviceName||(r.device||{}).name],['生产线',c.lineName],['公司',i.enterpriseName],['产品',c.productName||'外码采集'],['商标',c.trademark],['规格',c.specName],['成分含量',c.content],['剂型',c.dosage],['登记证号',c.registrationNo],['生产批号',c.batchNo],['生产日期',c.produceDate],['有效期至',c.expireDate],['建批时间',timeLabel(r.startedAt)],['开始采集',firstStart?timeLabel(firstStart.capturedAt):'旧记录未保存'],['首次扫描',timeLabel(r.firstScan)],['最后扫描',timeLabel(r.lastScan)],['停止采集',timeLabel(r.stoppedAt)],['上传确认',timeLabel(r.uploadedAt)],['有效采集',Number(n.collected||0)],['服务器确认',Number(n.saved||0)],['待上传',Number(n.waiting||0)],['重复',Number(n.duplicates||0)],['异常',Number(n.exceptions||0)],['记录编号',r.id]
   ].map(([k,v])=>ownField(k,v)).join('')+'</div><button id="detailExport" class="export-button">导出此员工记录 TXT</button><h2>操作时间线</h2><div class="record-timeline">'+(actions.length?actions.map(a=>'<p><strong>'+esc({start:'开始采集',pause:'暂停',resume:'继续采集',end:'结束采集'}[a.kind]||a.kind)+'</strong><br>'+esc(timeLabel(a.capturedAt))+'</p>').join(''):'<p>旧版本未记录暂停／继续操作</p>')+(r.uploadedAt?'<p><strong>上传完成</strong><br>'+esc(timeLabel(r.uploadedAt))+'</p>':'')+'</div><h2>扫码原文与结果</h2><select id="eventResult"><option value="">全部</option><option value="saved">有效采集</option><option value="duplicate">重复</option><option value="exception">异常</option></select><p>'+data.total+' 条 · 第 '+data.page+' 页</p><div class="record-events">'+data.events.map(e=>{const receipt=e.receipt||e,state=receipt.state||e.kind;return '<article><strong>#'+Number(e.sequence)+' · '+esc({saved:'服务器确认',valid:'本机有效',duplicate:'重复',invalid:'异常',exception:'异常'}[state]||state)+'</strong><p>'+esc(timeLabel(e.capturedAt))+'</p><pre>'+esc(e.rawCode)+'</pre><p>'+esc(receipt.reason||e.reason||'')+'</p><small>事件 '+esc(e.eventId)+'</small></article>';}).join('')+'</div><div class="row"><button id="eventPrev" '+(eventPage<=1?'hidden':'')+'>上一页</button><button id="eventNext" '+(eventPage*100>=data.total?'hidden':'')+'>下一页</button></div>';
   $('eventResult').value=result;$('eventResult').onchange=()=>recordDetail(id,1,$('eventResult').value);click('eventPrev',()=>recordDetail(id,eventPage-1,result));click('eventNext',()=>recordDetail(id,eventPage+1,result));click('detailExport',()=>WorkerNative.recordTxt(id,scope));
  }catch(error){if(page==='recordDetail')$('detailLoading').textContent='读取失败，请返回重试。';toast(error.message);}
 }
 function cachedProducts(){
  read();if(!isLeader()){home();return;}show('products',heading('本机产品','productsBack','left')+'<p id="cacheSummary" class="status"></p><div id="cachedList"></div>');click('productsBack',home);cacheUpdate();
 }
 function cacheUpdate(){
  read();const rows=q.products||[],cache=q.cache||{};$('cacheSummary').textContent='本厂已缓存 '+rows.length+' 个产品 · 最近更新 '+(cache.createdAt?timeLabel(cache.createdAt):'尚未完成下载');
  const snapshot=cache.id||'empty';if($('cachedList').dataset.snapshot===snapshot)return;$('cachedList').dataset.snapshot=snapshot;
  $('cachedList').innerHTML=rows.length?rows.map(p=>'<div class="card"><h2>'+esc([p.trademark,p.name].filter(Boolean).join(' · '))+'</h2><p>规格 '+esc(p.spec_name||'—')+'<br>登记证号 '+esc(p.registration_no||'—')+'</p></div>').join(''):'<p>暂无完整产品缓存，请联网等待下载。</p>';
 }

 window.PDAScanAdapter={onScan:raw=>collect(String(raw))};document.addEventListener('keydown',e=>{if(page!=='scan'||!scanning||!foreground||busy||!$('scanInput'))return;if(e.key.length===1&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&e.target!==$('scanInput')){e.preventDefault();$('scanInput').focus();$('scanInput').value+=e.key;}},true);
 window.App={lifecycle(value){foreground=value;if(!value){if(pendingEnd&&$('confirm').open)$('confirm').close('cancel');stop();if($('toggle'))$('toggle').textContent='开始连续采集';}},back(){if(pendingEnd){$('confirm').close('cancel');return;}if(busy)return;if(page==='login'||page==='activate')Native.exit();else if(page==='scan')scanBack();else if(page==='recordDetail')history();else if(page==='prepare'&&!isLeader()){if($('back'))$('back').click();}else home();}};
 setInterval(()=>{if(!foreground||busy)return;try{if(page==='scan')update();else if(page==='ended')endUpdate();else if(page==='products'){cacheUpdate();if(!q.identity)login();}else if(page==='prepare'){prepareCacheUpdate();}else if(page==='home'){read();if(!q.identity)login();else if($('cachedProducts'))$('cachedProducts').textContent='本机产品（'+(q.products||[]).length+'）';}else if(page==='login'){read();}registrationRoute();}catch(error){stop();toast(error.message);}},1000);
 try{const d=JSON.parse(Native.deviceInfo());read();if(q.registrationRequired||!d.hasCredential)activation();else if(q.identity)home();else login();}catch(error){show('error','<h1>本机队列无法打开</h1><p>'+esc(error.message)+'</p>');}
})();
