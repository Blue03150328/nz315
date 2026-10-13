(function(){'use strict';
 const $=id=>document.getElementById(id),esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let page='login',q={},scanning=false,busy=false,foreground=true,last='',noticeTimer,pendingEnd=null,endedRun='';const calls=new Map();
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
 function stats(prefix){return '<div class="grid stats">'+[['collected','有效采集'],['saved','云端记录'],['waiting','待上传'],['errors','重复／异常']].map(([id,label])=>'<div><strong id="'+prefix+id+'">0</strong><span>'+label+'</span></div>').join('')+'</div>';}
 function paintStats(prefix,c){for(const id of ['collected','saved','waiting'])$(prefix+id).textContent=Number(c[id]||0);$(prefix+'errors').textContent=Number(c.duplicates||0)+Number(c.exceptions||0);}
 function scanBack(){stop();if(q.run&&q.run.mode==='production')prepare();else home();}

 function stop(){scanning=false;WorkerNative.scanning(false);}
 function show(name,html){stop();page=name;$('main').innerHTML=html;if(['login','home','history','activate','error'].includes(name)&&typeof Native.openLegacyApp==='function'){$('main').insertAdjacentHTML('beforeend','<button id="legacyEntry">外部原文采集与旧记录</button><p class="muted">外部生产记录使用独立工号采集；新采集须先完成另一模式的采集及全部上传确认。</p>');click('legacyEntry',()=>Native.openLegacyApp());}window.scrollTo(0,0);}
 function call(action,data){busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);return new Promise((resolve,reject)=>{const id=Native.requestId(),timer=setTimeout(()=>{calls.delete(id);busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);reject(Error('操作尚未确认，本机记录保留，请核对后重试'));},120000);calls.set(id,r=>{clearTimeout(timer);busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);if(r.ok!==false)resolve(r);else reject(Error(r.error||'操作未完成'));});WorkerNative.call(id,action,JSON.stringify(data||{}));});}
 window.WorkerApi={receive(id,result){const done=calls.get(id);if(done){calls.delete(id);done(result);}}};
 async function confirm(text){stop();$('confirmText').textContent=text;return new Promise(resolve=>{$('confirm').addEventListener('close',()=>resolve($('confirm').returnValue==='yes'),{once:true});$('confirm').showModal();});}
 function field(id,label,type,value){return '<label><span>'+label+'</span><input id="'+id+'" type="'+type+'" value="'+esc(value||'')+'" required></label>';}
 function login(){read();if(q.registrationRequired){activation();return;}show('login','<h1>工人登录</h1><p>每人使用自己的工号，可在本厂设备轮换登录。</p><form id="loginForm" class="card">'+field('username','工号','text','')+field('password','密码','password','')+'<button class="primary">登录</button></form><p class="muted">首次需联网。已验证工人可以在72小时授权内离线登录。</p>');$('username').autocomplete='username';$('password').autocomplete='current-password';$('loginForm').onsubmit=async e=>{e.preventDefault();if(busy)return;try{await call('login',{username:$('username').value.trim(),password:$('password').value});$('password').value='';home();}catch(error){toast(error.message);}};}
 function registrationRoute(){if(!q.registrationRequired||['activate','history','ended'].includes(page))return false;if(pendingEnd){$('confirm').close('cancel');}activation();return true;}
 function activation(){read();show('activate','<h1>请扫码激活设备</h1><p>请扫描后台生成的设备激活二维码。</p>'+(q.unconfirmedWork?'<p class="status warning">本机还有未结束或未上传记录，已暂停扫码。请先保留备份并联系管理员处理，再更换登记。</p>':'')+'<div class="card"><input id="activationInput" placeholder="扫码输入"><button id="activate" class="primary">确认激活</button></div>'+(q.identity?'<button id="activationHistory">我的记录与备份</button>':'')+'<p class="muted">本机采集记录保留。</p>');header();WorkerNative.scanning(true);click('activate',()=>activate($('activationInput').value));click('activationHistory',history);$('activationInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();activate($('activationInput').value);}};}
 async function activate(code){try{await call('activate',{activationCode:code});login();toast('设备已激活，请工人登录');}catch(error){toast(error.message);}}
 function home(){read();if(q.registrationRequired){activation();return;}if(!q.identity){login();return;}show('home','<div class="brandline"><h1>'+esc(q.identity.name)+'</h1><button id="logout">退出登录</button></div><button id="production" class="primary">生产扫码</button><button id="external">外码采集</button><div class="status">设备待上传：'+Number(q.allWaiting)+'条<br>'+esc(q.message)+'</div>'+(q.openRuns||[]).map(r=>'<button class="history" data-resume="'+esc(r.id)+'">继续原批 · '+esc(r.context.productName||'外码采集')+'<br>'+esc(r.context.batchNo||'')+'</button>').join('')+'<button id="history">我的记录与备份</button><button id="cachedProducts">本机产品（'+(q.products||[]).length+'）</button>');click('logout',logout);click('production',prepare);click('external',async()=>{try{await call('start',{mode:'external',name:'外码采集'});scan();}catch(error){toast(error.message);}});click('history',history);click('cachedProducts',cachedProducts);document.querySelectorAll('[data-resume]').forEach(b=>b.onclick=async()=>{try{await call('resume',{runId:b.dataset.resume});scan();}catch(error){toast(error.message);}});}
 async function logout(){try{await call('logout');login();}catch(error){toast(error.message);}}
 function assignedPools(){return (q.pools||[]).filter(p=>q.identity&&(!Array.isArray(p.memberIds)||p.memberIds.includes(q.identity.id)));}

 function taskChoice(){return '<label><span>生产线（输入或选择）</span><input id="line" list="worker-lines" maxlength="100" placeholder="例如：一号线" required><datalist id="worker-lines">'+WorkerPreparation.lines(q.pools).map(name=>'<option value="'+esc(name)+'">').join('')+'</datalist></label>';}
 function prepare(){
  read();const dates=WorkerPreparation.defaults(new Date());show('prepare',heading('生产准备','back','right')+'<div class="card">'+taskChoice()+'<label><span>选择产品</span><select id="product"></select></label><p id="productHint" class="muted"></p>'+field('produceDate','生产日期','date',dates.produceDate)+field('expireDate','有效期至','date',dates.expireDate)+field('batchNo','生产批号','text','')+'<button id="start" class="primary">确认资料，进入扫码</button></div>');
  click('back',home);products();$('product').onchange=productChanged;$('line').oninput=()=>header({lineName:$('line').value.trim()});
  if(q.run&&q.run.mode==='production'){$('product').value=String(q.run.context.productId);productChanged();}
  click('start',async()=>{const id=Number($('product').value),p=(q.products||[]).find(p=>Number(p.id)===id);if(!p){toast('请选择本厂启用产品');return;}const old=(q.openRuns||[]).find(r=>r.mode==='production'&&Number(r.context.productId)===id),lineName=$('line').value.trim();if(!lineName){toast('请输入或选择生产线');return;}
   const data=old?{...old.context}:{mode:'production',productId:id,lineWorkflow:true,stockWorkflow:true,autoLine:true,taskId:0,lineName,productName:p.name,trademark:p.trademark,content:p.content,dosage:p.dosage,registrationNo:p.registration_no,specName:p.spec_name,batchNo:$('batchNo').value.trim(),produceDate:$('produceDate').value,expireDate:$('expireDate').value};
   if(!data.batchNo||!data.produceDate||!data.expireDate||data.expireDate<data.produceDate){toast('请核对批号、生产日期和有效期');return;}if(!await confirm(lineName+'\n'+WorkerPreparation.label(p)+'\n批号 '+data.batchNo+'\n生产 '+data.produceDate+'，有效期至 '+data.expireDate))return;try{await call('start',data);scan();}catch(error){read();toast(error.message);}});
 }
 function products(){$('product').dataset.snapshot=q.cache&&q.cache.id||'empty';const old=$('product').value,rows=q.products||[];$('product').innerHTML='<option value="">请选择产品</option>'+rows.map(p=>'<option value="'+p.id+'">'+esc(WorkerPreparation.label(p))+'</option>').join('');if(rows.some(p=>String(p.id)===old))$('product').value=old;productChanged();}
 function prepareCacheUpdate(){read();if(($('product').dataset.snapshot||'')===(q.cache&&q.cache.id||'empty'))return;const saved={line:$('line').value,produceDate:$('produceDate').value,expireDate:$('expireDate').value,batchNo:$('batchNo').value};products();if(!$('line').disabled)for(const key of Object.keys(saved))$(key).value=saved[key];}
 function productChanged(){
  const id=Number($('product').value),p=(q.products||[]).find(p=>Number(p.id)===id),old=(q.openRuns||[]).find(r=>r.mode==='production'&&Number(r.context.productId)===id);
  $('productHint').textContent=old?'继续原批，生产资料保持不变':p?WorkerPreparation.label(p):'';$('productHint').hidden=!$('productHint').textContent;
  $('line').disabled=!!old;if(old)$('line').value=old.context.lineName||'';header(old?old.context:{lineName:$('line').value.trim()},id);
  const dates=WorkerPreparation.defaults(new Date());for(const key of ['produceDate','expireDate','batchNo']){$(key).disabled=!!old;$(key).value=old?old.context[key]:key==='batchNo'?'':dates[key];}
 }

 function scan(){
  read();if(registrationRoute())return;if(!q.run){home();return;}const c=q.run.context,external=q.run.mode==='external';
  show('scan',heading(external?'外码采集':'生产扫码','scanBack','left')+'<div class="batch-info"><h2>'+esc([c.trademark,c.productName].filter(Boolean).join(' · ')||'外码采集')+'</h2>'+(!external?'<p>'+esc(c.specName||'')+' · 批号 '+esc(c.batchNo)+'</p><p class="batch-dates"><span>生产 '+esc(c.produceDate)+'</span><span>有效期 '+esc(c.expireDate)+'</span></p>':'')+'</div>'+stats('')+'<p id="sync" class="status"></p><p id="last" class="last">扫码已暂停</p><input id="scanInput" placeholder="实体扫码或输入原文" aria-label="扫码内容"><div class="row scan-actions"><button id="toggle" class="primary">开始连续采集</button><button id="finish" class="danger">结束采集</button></div>');
  header(c,c.productId);click('toggle',()=>{if(q.blocked){toast('设备已停用，请联系管理员');return;}scanning=!scanning;WorkerNative.scanning(scanning);$('toggle').textContent=scanning?'暂停采集':'开始连续采集';if(scanning)$('scanInput').focus();});click('scanBack',scanBack);click('finish',beginEnd);$('scanInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();collect($('scanInput').value);}};update();
 }

 function endNotice(){const run=q.run,cached=run?(q.pools||[]).find(p=>p.task_id===run.context.taskId):null,local=q.counts||{};let text='有效采集 '+Number(local.collected||0)+' · 待上传 '+Number(local.waiting||0);if(cached&&Number(cached.collected)<Number(cached.total))text+='\n整线尚有未扫描或未上传记录。';return text+'\n'+(q.networkAvailable?'结束后自动上传。':'当前离线，结束后请导出TXT或联网补传。');}

 function beginEnd(){if(pendingEnd||busy)return;read();if(!q.run)return;const wasScanning=scanning;stop();if($('toggle'))$('toggle').textContent='开始连续采集';const dialog=$('confirm'),cancel=dialog.querySelector('button[value=cancel]'),yes=dialog.querySelector('button[value=yes]');yes.hidden=true;cancel.textContent='取消结束，继续采集';const state={runId:q.run.id,wasScanning,deadline:Date.now()+5000,timer:null};pendingEnd=state;
  const reset=()=>{yes.hidden=false;cancel.textContent='取消';};
  dialog.addEventListener('close',()=>{reset();if(pendingEnd===state){clearInterval(state.timer);pendingEnd=null;if(state.wasScanning&&foreground&&!q.blocked){scanning=true;WorkerNative.scanning(true);if($('toggle'))$('toggle').textContent='暂停采集';}toast('已取消结束，数据保留，可以继续采集');}},{once:true});
  function tick(){if(pendingEnd!==state)return;const seconds=Math.max(0,Math.ceil((state.deadline-Date.now())/1000));$('confirmText').textContent=seconds+' 秒后结束采集，可点击下方取消。\n\n'+endNotice();if(seconds===0){clearInterval(state.timer);pendingEnd=null;dialog.close('commit');endedRun=state.runId;call('finish').then(()=>ended()).catch(error=>{toast(error.message);scan();});}}
  tick();dialog.showModal();state.timer=setInterval(tick,100);
 }
 function ended(){
  read();show('ended','<div class="end-heading"><span class="end-icon" aria-hidden="true">✓</span><h1>采集已结束</h1></div>'+stats('end-')+'<p id="endSummary" class="status end-status" role="status"></p><button id="endUpload" class="primary">立即上传</button><div class="row"><button id="endExport">导出TXT</button><button id="endBackup">完整备份</button></div><button id="endHome">返回首页</button>');
  click('endUpload',()=>{WorkerNative.upload();toast('正在上传，请等待云端确认');});click('endExport',()=>WorkerNative.txt(endedRun));click('endBackup',()=>WorkerNative.backup());click('endHome',home);endUpdate();
 }

 function endUpdate(){
  read();const run=(q.history||[]).find(r=>r.id===endedRun),c=run&&run.summary||{};header(run&&run.context,run&&run.context.productId);paintStats('end-',c);
  $('endSummary').textContent=run&&run.cloud_done?'已全部上传':q.blocked?'设备停用，请联系管理员':!q.networkAvailable?'当前离线 · 请导出TXT或联网上传':/未确认|失败|失效/.test(q.message)?'同步未确认 · 请重试或导出TXT':Number(c.waiting)>0?'正在上传，请稍候':'等待云端确认结束';
  $('endSummary').className='status end-status'+(run&&run.cloud_done?' complete':!q.networkAvailable||q.blocked?' warning':'');
  const production=!run||run.mode==='production';$('endExport').title=production?'导出生产记录 TXT':'导出外码原文 TXT（离线可用）';$('endUpload').hidden=!!(run&&run.cloud_done);
 }

 function collect(raw){if(pendingEnd){Native.rejected();toast('正在确认结束，扫码已暂停；取消结束后请重扫');return;}if(page==='activate'){activate(raw);return;}if(page!=='scan'||!scanning||!foreground||busy){if(page==='scan'){Native.rejected();toast('扫码已暂停，本次未保存，开始后请重扫');}return;}try{const r=JSON.parse(WorkerNative.collect(raw));if(!r.ok)throw Error(r.error);const e=r.event;last=e.eventId;$('scanInput').value='';$('last').className='last '+(e.kind==='invalid'?'error':e.kind==='duplicate'?'warning':'');$('last').textContent=(e.kind==='valid'?'已保存，可以扫描下一件':e.kind==='duplicate'?'重复码，已记录':'异常码，已记录')+' · '+(e.reason||(q.run.mode==='external'?e.rawCode:e.code||e.rawCode));if(e.kind==='valid')Native.confirmed();else Native.rejected();update();$('scanInput').focus();}catch(error){stop();$('toggle').textContent='开始连续采集';$('last').className='last error';$('last').textContent='本次未保存，需要重扫：'+error.message;}}
 function update(){read();if(registrationRoute())return;if(!q.identity){stop();login();return;}if(page!=='scan')return;if(q.blocked){stop();$('toggle').textContent='开始连续采集';}const c=q.counts||{};header(q.run&&q.run.context,q.run&&q.run.context.productId);paintStats('',c);$('sync').textContent=q.blocked?'设备已停用，请联系管理员':!q.networkAvailable?'离线 · 记录已保存本机':/未确认|失败|失效/.test(q.message)?'同步未确认，记录保留本机':Number(c.waiting)>0?'联网 · 等待自动上传':Number(c.total)>0?'联网 · 记录已上传':'联网 · 等待采集';const row=(q.recent||[]).find(r=>r.event.eventId===last);if(row&&row.receipt)$('last').textContent=(row.receipt.state==='saved'?'云端已保存':row.receipt.state==='duplicate'?'重复码，不计数':'异常记录')+' · '+({internal:'系统内部码',external:'外部码',own:'本厂码（历史分类）',other_enterprise:'本系统其他企业码（历史分类）',not_imported:'未入库内容（历史分类）',unparsed:'未识别到扫码网址'}[row.receipt.classification]||'')+' '+(row.receipt.reason||(q.run.mode==='external'?row.event.rawCode:row.event.code||row.event.rawCode));}

 function timeLabel(value){return value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';}
 function history(){
  read();show('history',heading('我的记录与备份','historyBack','left')+'<button id="backup" class="primary">导出本人本机备份</button>'+ (q.history||[]).map(r=>{const c=r.summary||{},external=r.mode==='external';return '<div class="card"><h2>'+esc(r.context.productName||'外码采集')+'</h2><p>'+esc(r.context.batchNo||r.id.slice(0,8))+' · '+(r.state==='open'?'采集中':r.cloud_done?'已上传结束':'待上传结束')+'</p>'+(external?'<p>有效 '+Number(c.collected||0)+' · 重复 '+Number(c.duplicates||0)+' · 异常 '+Number(c.exceptions||0)+'</p><p>云端 '+Number(c.saved||0)+' · 待上传 '+Number(c.waiting||0)+'</p><p>开始 '+esc(timeLabel(r.startedAt))+'<br>结束 '+esc(r.stoppedAt?timeLabel(r.stoppedAt):'尚未结束')+'</p>':'')+(r.mode==='production'&&r.context.lineWorkflow?'<button data-txt="'+esc(r.id)+'">导出生产记录 TXT（离线可用）</button>':external?'<button data-txt="'+esc(r.id)+'">导出外码原文 TXT（离线可用）</button>':'')+'</div>';}).join(''));
  click('historyBack',home);click('backup',()=>WorkerNative.backup());document.querySelectorAll('[data-txt]').forEach(b=>b.onclick=()=>WorkerNative.txt(b.dataset.txt));
 }
 function cachedProducts(){
  read();show('products',heading('本机产品','productsBack','left')+'<p id="cacheSummary" class="status"></p><div id="cachedList"></div>');click('productsBack',home);cacheUpdate();
 }
 function cacheUpdate(){
  read();const rows=q.products||[],cache=q.cache||{};$('cacheSummary').textContent='本厂已缓存 '+rows.length+' 个产品 · 最近更新 '+(cache.createdAt?timeLabel(cache.createdAt):'尚未完成下载');
  const snapshot=cache.id||'empty';if($('cachedList').dataset.snapshot===snapshot)return;$('cachedList').dataset.snapshot=snapshot;
  $('cachedList').innerHTML=rows.length?rows.map(p=>'<div class="card"><h2>'+esc([p.trademark,p.name].filter(Boolean).join(' · '))+'</h2><p>规格 '+esc(p.spec_name||'—')+'<br>登记证号 '+esc(p.registration_no||'—')+'</p><p class="muted">'+'可在生产准备选择'+'</p></div>').join(''):'<p>暂无完整产品缓存，请联网等待下载。</p>';
 }

 window.PDAScanAdapter={onScan:raw=>collect(String(raw))};document.addEventListener('keydown',e=>{if(page!=='scan'||!scanning||!foreground||busy||!$('scanInput'))return;if(e.key.length===1&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&e.target!==$('scanInput')){e.preventDefault();$('scanInput').focus();$('scanInput').value+=e.key;}},true);
 window.App={lifecycle(value){foreground=value;if(!value){if(pendingEnd&&$('confirm').open)$('confirm').close('cancel');stop();if($('toggle'))$('toggle').textContent='开始连续采集';}},back(){if(pendingEnd){$('confirm').close('cancel');return;}if(busy)return;if(page==='login'||page==='activate')Native.exit();else if(page==='scan')scanBack();else home();}};
 setInterval(()=>{if(!foreground||busy)return;try{if(page==='scan')update();else if(page==='ended')endUpdate();else if(page==='products'){cacheUpdate();if(!q.identity)login();}else if(page==='prepare'){prepareCacheUpdate();}else if(page==='home'){read();if(!q.identity)login();else if($('cachedProducts'))$('cachedProducts').textContent='本机产品（'+(q.products||[]).length+'）';}else if(page==='login'){read();}registrationRoute();}catch(error){stop();toast(error.message);}},1000);
 try{const d=JSON.parse(Native.deviceInfo());read();if(q.registrationRequired||!d.hasCredential)activation();else if(q.identity)home();else login();}catch(error){show('error','<h1>本机队列无法打开</h1><p>'+esc(error.message)+'</p>');}
})();
