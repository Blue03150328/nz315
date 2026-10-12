(function () {
  'use strict';
  const $ = id => document.getElementById(id), core = window.ProductionCore;
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const number = value => Number(value || 0), date = value => String(value || '').slice(0, 10);
  const labels = { active: '生产中', pending: '待审核', rejected: '审核退回', approved: '已结束' };
  const state = { page: 'login', user: null, deviceMode: false, busy: false, foreground: true, scanning: false, confirming: false, tasks: [], taskPage: 1, total: 0, tab: 'active', detail: null, queue: null, external: null, product: null, products: [], sources: null, search: '', productPage: 1, productTotal: 0 };
  let settings = {}, noticeTimer, productTimer, searchVersion = 0;
  const calls = new Map();
  const storage = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; } },
    put(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
    remove(key) { localStorage.removeItem(key); }
  };
  function toast(message, error) { clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').className = error ? 'error' : ''; $('notice').hidden = false; noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6500); }
  function receipt(title, text, kind) { const node = $('receipt'); node.className = kind || ''; node.innerHTML = '<strong>' + escape(title) + '</strong><code>' + escape(text) + '</code>'; node.hidden = false; }
  function writable() { return state.user && ['platform_admin', 'enterprise_admin', 'code_admin'].includes(state.user.role); }
  function creation() { return storage.get('pendingCreation'); }
  function creationForUser() { const item = creation(); return item && item.server === settings.server && number(item.userId) === number(state.user && state.user.id) ? item : null; }
  function blockedNavigation() { if (state.busy) { toast('正在等待服务器，请稍候'); return true; } return false; }
  function selectPage(page, html) { if(window.Native)Native.capturing(false); state.page = page; state.scanning = false; $('main').className = ['scan','external'].includes(page) ? 'scan-page' : ''; $('main').innerHTML = html; if (!['scan','external'].includes(page)) $('receipt').hidden = true; window.scrollTo(0, 0); }
  function on(id, event, callback) { const node = $(id); if (node) node.addEventListener(event, callback); }
  function click(id, callback) { on(id, 'click', () => { if (!blockedNavigation()) callback(); }); }
  function field(id, label, value, type, placeholder) { return '<label class="field"><span>' + label + '</span><input id="' + id + '" type="' + (type || 'text') + '" value="' + escape(value || '') + '" placeholder="' + escape(placeholder || '') + '"' + (type === 'password' ? ' autocomplete="current-password"' : '') + '></label>'; }
  function send(method, path, body) {
    return new Promise(resolve => {
      const id = Native.requestId();
      const timer = setTimeout(() => { calls.delete(id); resolve({ status: 0, error: '未收到请求结果，请核对后重试' }); }, 40000);
      calls.set(id, response => { clearTimeout(timer); resolve(response); });
      try { Native.request(id, method, path, JSON.stringify(body || {})); }
      catch (_) { calls.get(id)({ status: 0, error: '请求未能启动，请重新打开应用核对' }); calls.delete(id); }
    });
  }
  window.NzApi = { receive(id, response) { const callback = calls.get(id); if (callback) { calls.delete(id); callback(response); } } };
  async function api(method, path, body) {
    const result = await send(method, path, body);
    if (number(result.status) < 200 || number(result.status) >= 300 || !result.body) {
      const error = new Error(result.error || '服务器没有返回有效资料'); error.status = number(result.status);
      if (error.status === 401) invalidate();
      throw error;
    }
    return result.body;
  }
  function invalidate() { if(state.deviceMode){state.user=null;state.scanning=false;Native.capturing(false);deviceActivation('设备凭证失效，请联系管理员；本机记录保留');return;} state.user=null; if(state.page==='scan' && state.queue && state.queue.session) toast('登录失效；本机继续保存，重新登录后自动同步',true); else login('请重新登录，本机记录已保留'); }
  function busy(value) { state.busy = value; document.querySelectorAll('[data-busy]').forEach(node => { node.disabled = value; }); $('settingsButton').disabled = value; }
  async function confirm(title, message, button) {
    state.scanning = false; updateScanLabel(); state.confirming = true;
    $('confirmTitle').textContent = title; $('confirmMessage').textContent = message; $('confirmYes').textContent = button || '确认';
    return new Promise(resolve => { $('confirmDialog').addEventListener('close', () => { state.confirming = false; resolve($('confirmDialog').returnValue === 'yes'); }, { once: true }); $('confirmDialog').showModal(); });
  }

  function login(message) {
    state.deviceMode=false;
    selectPage('login', '<div class="eyebrow">生产作业终端</div><h1>准备开始生产</h1><p class="muted">登录厂家账号，领用本批追溯码。</p><form id="loginForm" class="card">' + field('server', '服务器地址', settings.server, 'url', 'https://www.nz315.cn') + field('username', '后台账号', '', 'text', '请输入你的采集账号') + field('password', '密码', '', 'password', '请输入密码') + '<button class="primary wide" id="loginButton" data-busy>登录并进入任务</button></form><div class="tips">建议每台扫描仪使用独立账号。同一账号在其他设备登录，会使当前设备登录失效。</div>');
    $('username').autocomplete = 'username';
    on('loginForm', 'submit', async event => {
      event.preventDefault(); if (state.busy) return;
      const username = $('username').value.trim(), password = $('password').value;
      if (!username || !password) { toast('请输入账号和密码'); return; }
      const activeCreation = creation();
      const server = $('server').value.trim().replace(/\/+$/, '');
      if (activeCreation && activeCreation.server !== server) { toast('上次领用尚未确认，请先在原服务器核对'); return; }
      const error = Native.configure(JSON.stringify({ ...settings, server }));
      if (error) { toast(error, true); return; }
      settings = JSON.parse(Native.settings()); busy(true); $('loginButton').textContent = '正在登录…';
      try {
        const result = await api('POST', '/api/auth/login', { username, password });
        if (!result.ok || !result.user) throw new Error('登录返回的账号资料不完整');
        state.user = result.user; $('password').value = ''; Native.resumeUpload();
        readQueue(); if(state.queue.session) queuePage(); else await tasks();
      } catch (error) { toast(error.message, true); if ($('loginButton')) $('loginButton').textContent = '登录并进入任务'; }
      finally { busy(false); }
    });
    readQueue(); if(state.queue.session) { const resume=document.createElement('button');resume.className='secondary wide';resume.textContent='恢复本机采集（可离线）';resume.addEventListener('click',queuePage);$('main').appendChild(resume); }
    if (message) toast(message, true);
  }

  function taskList() {
    const item = creationForUser();
    selectPage('tasks', '<div class="heading"><div><div class="eyebrow">' + escape(state.user.name || state.user.username) + '</div><h1>生产任务</h1></div><button id="refreshTasks" class="iconbutton" data-busy>刷新</button></div>' + (item ? '<div class="card"><h3>上次领用尚未确认</h3><p class="muted">资料和提交标识已保留，请先核对该任务。</p><button class="secondary wide" id="resumeCreation" data-busy>核对上次领用</button></div>' : '') + (writable() && !state.deviceMode ? '<button class="primary wide" id="newTask" data-busy>' + (item ? '继续核对领用' : '＋ 新建生产任务') + '</button><div style="height:20px"></div>' : '<div class="tips">生产任务由管理员在后台建立，选择本次任务开始扫码。</div>') + '<div class="pillbar"><button id="activeTab" class="' + (state.tab === 'active' ? 'selected' : '') + '">进行中</button><button id="historyTab" class="' + (state.tab === 'history' ? 'selected' : '') + '">已结束</button></div><div id="taskRows"></div><button id="moreTasks" class="secondary wide" data-busy>加载更多任务</button><p class="devicehint">实际用量以服务器确认的生产扫码为准。</p>');
    click('newTask', showCreate); click('resumeCreation', showCreate); click('refreshTasks', () => tasks());
    if(state.deviceMode){const external=document.createElement('button');external.id='externalEntry';external.className='primary wide';external.textContent='外部二维码采集';$('taskRows').before(external);click('externalEntry',externalSetup);}
    click('activeTab', () => { state.tab = 'active'; taskList(); }); click('historyTab', () => { state.tab = 'history'; taskList(); });
    click('moreTasks', () => tasks(true));
    const rows = state.tasks.filter(task => (task.status === 'active') === (state.tab === 'active'));
    $('taskRows').innerHTML = rows.length ? rows.map(task => '<button class="task" data-task="' + number(task.id) + '"><div class="task-top"><span class="line">' + escape(task.line_name || '未设置生产线') + '</span><span class="badge ' + (task.status === 'active' ? '' : 'gray') + '">' + escape(labels[task.status] || task.status) + '</span></div><div class="name">' + escape(task.name) + '</div><div class="metadata">' + escape(task.product_name) + '<br>批号 ' + escape(task.batch_no) + '</div><div class="count">已生产 <b>' + number(task.used_count) + '</b> / ' + number(task.total) + (task.status === 'active' ? '　待生产 ' + number(task.reserved_count) : '　可再次领用 ' + number(task.available_count) + '　已转领 ' + number(task.transferred_count)) + '</div></button>').join('') : '<div class="empty">' + (state.tab === 'active' ? '暂无进行中的生产任务' : '暂无已结束的任务') + '</div>';
    document.querySelectorAll('[data-task]').forEach(node => node.addEventListener('click', () => { if (!blockedNavigation()) openTask(number(node.dataset.task)); }));
    $('moreTasks').hidden = state.tasks.length >= state.total;
  }
  async function tasks(more) {
    busy(true);
    try {
      const page = more ? state.taskPage + 1 : 1;
      const result = await api('GET', '/api/admin/production-tasks?page=' + page);
      if (!Array.isArray(result.rows)) throw new Error('任务列表资料不完整');
      state.taskPage = page; state.total = number(result.total); state.tasks = more ? state.tasks.concat(result.rows) : result.rows;
      const prior = creationForUser();
      if (prior && state.tasks.some(task => task.request_id === prior.payload.requestId && number(task.created_by) === number(prior.userId))) storage.remove('pendingCreation');
      taskList();
    } catch (error) { if (state.user) { taskList(); toast(error.message, true); } else throw error; }
    finally { busy(false); }
  }

  function showCreate() {
    if (state.deviceMode || !writable()) return;
    readQueue();if(state.queue.session){toast('请先完成本机采集与同步');queuePage();return;}
    const prior = creationForUser();
    if (creation() && !prior) { toast('上次领用尚未确认，请使用原账号登录核对', true); return; }
    state.product = null; state.sources = null; state.products = [];
    const today = new Date(); const day = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    selectPage('create', '<div class="heading"><h1>新建生产任务</h1><button id="createBack" class="iconbutton" data-busy>返回</button></div><div class="step"><span>1 填写本批资料</span><span>2 领用追溯码</span></div><form id="createForm"><div class="card"><label class="field"><span>产品</span><input id="productSearch" autocomplete="off" placeholder="搜索产品名称或登记证号"><div id="productResults" class="suggestions" hidden></div></label>' + field('taskName', '任务名称', '', 'text', '例如：10月10日早班') + field('lineName', '生产线', '', 'text', '例如：一号线') + field('batchNo', '生产批号', '', 'text', '请输入本批生产批号') + '<div class="row">' + field('produceDate', '生产日期', day, 'date') + field('expireDate', '有效期至', '', 'date') + '</div>' + field('qualityCertNo', '质量合格证号', '', 'text', '请输入合格证编号') + '<label class="check"><input id="qcResult" type="checkbox">本批产品质检合格</label></div><div class="card"><h2>领用追溯码</h2><label class="field"><span>码来源</span><select id="sourceKind"><option value="upload">已入库的码文件</option><option value="task">已审核任务的剩余码</option></select></label><label class="field"><span>选择来源</span><select id="sourceId"><option value="">请先选择产品</option></select></label>' + field('quantity', '本次领用数量', '1', 'number', '输入数量') + '<div id="sourceHint" class="tips">无需复制码清单，系统按来源自动领用具体追溯码。</div></div><button class="primary wide" id="createSubmit" data-busy>确认领用，进入扫码</button><p class="devicehint">领用只锁定码清单，生产扫码成功才写入批次资料。</p></form>');
    $('quantity').min = '1'; $('quantity').max = '10000'; $('quantity').step = '1';
    click('createBack', () => tasks());
    on('produceDate', 'change', () => { $('expireDate').min = $('produceDate').value; });
    on('productSearch', 'focus', () => searchProducts(false));
    on('productSearch', 'input', () => {
      state.product = null; state.sources = null; renderSources(); clearTimeout(productTimer); searchVersion++;
      productTimer = setTimeout(() => searchProducts(false), 300);
    });
    on('sourceKind', 'change', renderSources); on('sourceId', 'change', sourceHint);
    on('createForm', 'submit', event => { event.preventDefault(); if (!state.busy) createTask(); });
    if (prior) {
      const p = prior.payload;
      for (const [id, key] of [['taskName', 'name'], ['lineName', 'lineName'], ['batchNo', 'batchNo'], ['produceDate', 'produceDate'], ['expireDate', 'expireDate'], ['qualityCertNo', 'qualityCertNo'], ['quantity', 'quantity']]) $(id).value = p[key];
      $('productSearch').value = prior.productName || '上次选择的产品'; $('qcResult').checked = true;
      $('sourceKind').value = p.sourceTaskId ? 'task' : 'upload'; $('sourceId').innerHTML = '<option>上次领用来源（待服务器核对）</option>';
      lockCreate(); receipt('上次领用尚未确认', '点击核对会使用相同资料和提交标识，不重复领用。', 'warning'); $('receipt').hidden = false;
    }
  }
  async function searchProducts(more) {
    if (state.page !== 'create' || creationForUser()) return;
    const version = ++searchVersion, keyword = $('productSearch').value.trim().slice(0, 64), page = more ? state.productPage + 1 : 1;
    try {
      const result = await api('GET', '/api/admin/products?status=1&pageSize=20&page=' + page + '&keyword=' + encodeURIComponent(keyword));
      if (state.page !== 'create' || version !== searchVersion) return;
      state.productPage = page; state.productTotal = number(result.total); state.products = more ? state.products.concat(result.rows || []) : result.rows || [];
      $('productResults').hidden = false;
      $('productResults').innerHTML = state.products.map(product => '<button type="button" data-product="' + number(product.id) + '">' + escape(product.name) + '<small>' + escape(product.registration_no) + ' · ' + escape(product.spec_name || '') + '</small></button>').join('') + (state.products.length < state.productTotal ? '<button type="button" id="moreProducts">加载更多产品</button>' : '') + (!state.products.length ? '<div class="empty">没有匹配的产品</div>' : '');
      document.querySelectorAll('[data-product]').forEach(node => node.addEventListener('click', () => selectProduct(number(node.dataset.product))));
      on('moreProducts', 'click', () => searchProducts(true));
    } catch (error) { toast(error.message, true); }
  }
  async function selectProduct(id) {
    if (state.busy) return;
    searchVersion++;
    state.product = state.products.find(product => number(product.id) === id); $('productSearch').value = state.product.name + ' · ' + state.product.registration_no; $('productResults').hidden = true;
    state.sources = null; renderSources();
    try {
      const result = await api('GET', '/api/admin/production-tasks/sources?productId=' + id);
      if (state.page === 'create' && state.product && number(state.product.id) === id) { state.sources = result; renderSources(); }
    } catch (error) { toast(error.message, true); }
  }
  function renderSources() {
    if (!$('sourceId')) return;
    const kind = $('sourceKind').value, rows = state.sources ? state.sources[kind === 'task' ? 'tasks' : 'uploads'] || [] : [];
    $('sourceId').innerHTML = '<option value="">' + (state.product ? state.sources ? rows.length ? '请选择来源' : '此产品暂无可领码，请先在后台入库或审核' : '正在查询可领码…' : '请先选择产品') + '</option>' + rows.map(source => '<option value="' + number(source.id) + '">' + escape(kind === 'task' ? source.name + ' · ' + (source.line_name || '') : source.file_name) + '（可领 ' + number(source.available_count) + ' 个）</option>').join(''); sourceHint();
  }
  function sourceHint() {
    const kind = $('sourceKind').value, rows = state.sources ? state.sources[kind === 'task' ? 'tasks' : 'uploads'] || [] : [], source = rows.find(row => number(row.id) === number($('sourceId').value));
    $('sourceHint').textContent = source ? '当前可领 ' + number(source.available_count) + ' 个。系统自动确定具体码清单。' : '无需复制码清单，系统按来源自动领用具体追溯码。';
  }
  function lockCreate() { document.querySelectorAll('#createForm input,#createForm select').forEach(node => { node.disabled = true; }); $('createSubmit').textContent = '核对 / 重试上次领用'; }
  async function createTask() {
    let prior = creationForUser(), payload;
    try {
      if (prior) payload = prior.payload;
      else {
        payload = core.draft({ productId: state.product && state.product.id, name: $('taskName').value, lineName: $('lineName').value, batchNo: $('batchNo').value, produceDate: $('produceDate').value, expireDate: $('expireDate').value, qualityCertNo: $('qualityCertNo').value, qcResult: $('qcResult').checked ? 1 : 0, kind: $('sourceKind').value, sourceId: $('sourceId').value, quantity: $('quantity').value });
        const rows = state.sources[$('sourceKind').value === 'task' ? 'tasks' : 'uploads'], source = rows.find(row => number(row.id) === number($('sourceId').value));
        if (!source || payload.quantity > number(source.available_count)) throw new Error('领用数量超过当前余量，请核对数量');
        payload.requestId = Native.requestId(); prior = { server: settings.server, userId: state.user.id, productName: state.product.name, payload };
        storage.put('pendingCreation', prior);
      }
      lockCreate(); busy(true);
      const result = await send('POST', '/api/admin/production-tasks', payload);
      if (number(result.status) >= 200 && number(result.status) < 300 && result.body && result.body.ok === true && number(result.body.id) > 0) {
        storage.remove('pendingCreation'); busy(false); $('receipt').hidden = true; await openTask(result.body.id); toast('本批领用成功，可以开始扫码');
      } else if ([400, 409, 422].includes(number(result.status))) {
        storage.remove('pendingCreation'); document.querySelectorAll('#createForm input,#createForm select').forEach(node => { node.disabled = false; }); $('createSubmit').textContent = '确认领用，进入扫码'; toast(result.error || '领用未通过，请核对资料', true);
      } else {
        receipt('领用尚未确认', result.error || '请保持资料不变，点击核对上次领用。', 'warning');
        if (number(result.status) === 401) invalidate();
      }
    } catch (error) { toast(error.message, true); }
    finally { busy(false); }
  }

  function readQueue() {
    const snapshot=JSON.parse(Native.queue());
    if(!snapshot.ok)throw new Error(snapshot.error || '本机数据不可用');
    state.queue=snapshot;return snapshot;
  }
  async function openTask(id) {
    readQueue();
    if(state.queue.session) { if(number(state.queue.session.task_id)!==number(id)){toast('请先完成本机原任务的采集与同步');return;}queuePage();return; }
    busy(true);
    try {
      const detail=await api('GET','/api/admin/production-tasks/'+number(id));state.detail=detail;
      const task=detail.task;
      selectPage('task','<div class="heading"><h1>'+escape(task.name)+'</h1><button id="taskBack" class="iconbutton">返回</button></div><div class="card"><h2>'+escape(task.product_name)+'</h2><p>'+escape(task.line_name)+' · 批号 '+escape(task.batch_no)+'</p><p>已生产 '+number(task.used_count)+' / 领用 '+number(task.total)+'</p><p>当前状态：'+escape(labels[task.status] || task.status)+'</p></div>'+(task.status==='active' && writable()?'<button id="startCollection" class="primary wide">缓存领用清单，开始本机采集</button><p class="devicehint">首次开始需要联网。扫码先保存到设备，每20条自动批量上传。</p>':'<div class="tips">已结束的任务请在网页查看审核与转领详情。</div>'));
      click('taskBack',tasks);
      click('startCollection',()=>{const result=JSON.parse(Native.prepare(number(id),JSON.stringify(state.user)));if(!result.ok){toast(result.error,true);return;}Native.resumeUpload();readQueue();queuePage();});
    }catch(error){toast(error.message,true);}finally{busy(false);}
  }
  function queuePage() {
    const q=readQueue(), session=q.session;
    if(!session){if(state.user)tasks();else login();return;}
    const c=session.context, open=session.phase==='open';
    selectPage('scan','<div class="heading"><div><div class="eyebrow">'+escape(c.lineName || '本机采集')+'</div><h1>'+escape(c.name || '准备领用清单')+'</h1></div><button id="scanBack" class="iconbutton">返回</button></div><div class="card"><h3>'+escape(c.productName || '')+'</h3><p class="muted">生产批号 '+escape(c.batchNo || '正在联网确认…')+'</p><div class="stats"><div><strong id="localCount">0</strong><small>本机有效采集</small></div><div><strong id="cloudCount">0</strong><small>云端已绑定</small></div><div><strong id="waitingCount">0</strong><small>待同步记录</small></div></div><div id="syncStatus" class="tips"></div><div class="actions sync-actions"><button id="uploadCloud" class="primary">上传云端</button><button id="backupRecords" class="secondary">导出备份</button></div><p class="devicehint">上传时可继续扫码；上传成功也保留本机记录。</p><details><summary>本批生产资料</summary>'+[['生产日期',date(c.produceDate)],['有效期至',date(c.expireDate)],['质量合格证号',c.qualityCertNo],['质检结果',c.qcResult===1?'合格':'-']].map(r=>'<div class="detail-line"><span>'+r[0]+'</span><strong>'+escape(r[1] || '-')+'</strong></div>').join('')+'</details></div>'+(open?'<div class="card scan-panel"><div class="scan-art" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><h2 id="scanHeading">扫码已暂停</h2><p class="muted">提示已保存后可继续扫描，无需等待云端。重复码和异常码自动剔除并留痕。</p><div class="scan-entry"><input id="scanInput" autocomplete="off" placeholder="实体扫描，或输入追溯码" aria-label="追溯码"><button id="submitScan" class="secondary">采集</button></div><button id="toggleScan" class="primary wide">开始连续采集</button></div>':'<div class="card"><h2>'+ (session.phase==='starting'?'正在缓存领用清单':'已停止扫码，正在同步并结束')+'</h2><p class="muted">'+(session.phase==='starting'?'云端确认后才允许扫码；请保持联网或重新登录。':'全部记录收到云端收据后才完成结束，未确认记录仍保留在设备。')+'</p></div>')+'<div class="card"><div class="split"><h3>采集与异常记录</h3><span id="anomalyCount"></span></div><div id="recentRows"></div></div><button id="loginAgain" class="secondary wide" hidden>登录已失效，重新登录</button>'+(open?'<button id="closeCollection" class="danger wide">结束本机采集及本批生产</button><p class="devicehint">其他设备仍在采集时，只结束本机；任务需等所有设备完成同步。</p>':''));
    const uploadStatus=document.createElement('p');uploadStatus.id='uploadBoundaryStatus';uploadStatus.className='devicehint';$('syncStatus').after(uploadStatus);
    $('uploadCloud').textContent='立即同步';
    $('uploadCloud').parentElement.nextElementSibling.textContent='扫码持续自动上传。点击“完成本次上传”划分子批次，之后扫描的码归入下一批；可以继续扫码。';
    if(open){
      const finish=document.createElement('button');finish.id='finishUpload';finish.className='primary wide';finish.textContent='完成本次上传';$('uploadCloud').parentElement.before(finish);
      click('finishUpload',()=>{
        try{
          const result=JSON.parse(Native.finishUpload());if(!result.ok)throw new Error(result.error || '本次上传边界未能保存，请重试');
          toast(result.finishRequested?'本次上传边界已保存，等待云端确认；可以继续扫码':'没有新的采集记录，无需完成本次上传');updateQueue();
          if(state.scanning && settings.mode!=='broadcast' && $('scanInput'))$('scanInput').focus();
        }catch(error){toast(error.message,true);}
      });
    }
    const records=$('recentRows'),card=records.parentElement;
    const more=document.createElement('details'),summary=document.createElement('summary');summary.textContent='查看最近30条采集原文及原因';more.appendChild(summary);more.appendChild(records);card.appendChild(more);
    if($('closeCollection'))card.before($('closeCollection'));
    click('scanBack',()=>{Native.capturing(false);if(state.user)tasks();else login();});
    click('toggleScan',()=>{if(readQueue().deviceBlocked){toast('设备已停用或认证失效，请联系管理员',true);return;}state.scanning=!state.scanning;updateScanLabel();if(state.scanning && settings.mode!=='broadcast')$('scanInput').focus();});
    click('submitScan',()=>submitScan($('scanInput').value,true));
    on('scanInput','keydown',event=>{if(event.key==='Enter'){event.preventDefault();submitScan($('scanInput').value,false);}});
    click('uploadCloud',()=>{
      try{const result=JSON.parse(Native.uploadNow());if(!result.ok){toast(result.message || result.error || '请先登录后上传，本机记录已保留',true);updateQueue();return;}
        const button=$('uploadCloud');button.disabled=true;setTimeout(()=>{if($('uploadCloud'))$('uploadCloud').disabled=false;},1500);
        toast('已开始上传云端，可以继续扫码；本机记录保留');updateQueue();
        if(state.scanning && settings.mode!=='broadcast' && $('scanInput'))$('scanInput').focus();
      }catch(error){toast(error.message,true);}
    });
    click('backupRecords',exportBackup);
    click('loginAgain',()=>{state.scanning=false;Native.capturing(false);if(state.deviceMode)connectDevice();else login();});
    click('closeCollection',async()=>{
      if(!await confirm('停止采集并结束生产？','停止后不能再扫码。本机全部记录同步成功后才能结束；网络中断时自动保留并重试。','停止并同步'))return;
      const result=JSON.parse(Native.finishCollection(true));if(!result.ok){toast(result.error,true);return;}queuePage();
    });
    updateQueue();receipt(open?'本机记录已恢复，等待开始':'请等待云端确认','有效码先本机保存，批量同步后显示云端已绑定。','warning');
  }
  function updateScanLabel(){if(window.Native)Native.capturing(state.scanning);if($('toggleScan')){$('toggleScan').textContent=state.scanning?'暂停采集':'开始连续采集';$('scanHeading').textContent=state.scanning?'正在连续采集':'扫码已暂停';}if($('externalToggle')){$('externalToggle').textContent=state.scanning?'暂停外部采集':'开始连续采集';$('externalHeading').textContent=state.scanning?'正在采集外部二维码':'外部扫码已暂停';}}
  function updateQueue(){
    const q=readQueue(),session=q.session;
    if(state.page!=='scan')return;
    if(!session){state.scanning=false;Native.capturing(false);toast(q.syncMessage || '全部记录已同步，本机采集已结束');if(state.user)tasks();else login();return;}
    const counts=q.counts || {};
    for(const [id,key] of [['localCount','collected'],['cloudCount','accepted'],['waitingCount','waiting']])if($(id))$(id).textContent=number(counts[key]);
    if($('syncStatus'))$('syncStatus').textContent=q.syncMessage || '自动同步中';
    if($('uploadBoundaryStatus')){
      const current=q.currentUpload && q.currentUpload.counts || {}, batches=q.uploadCounts || {};
      $('uploadBoundaryStatus').textContent='本次有效采集 '+number(current.collected)+' · 本次云端成功 '+number(current.accepted)+' · 已完成 '+number(batches.completed)+' 批'+(number(batches.pending)>0?' · '+number(batches.pending)+' 批等待云端确认':'');
    }
    if($('loginAgain')){$('loginAgain').hidden=!q.loginRequired;$('loginAgain').textContent=state.deviceMode?'重新验证设备':'登录已失效，重新登录';}if(q.deviceBlocked){state.scanning=false;updateScanLabel();}
    if($('anomalyCount'))$('anomalyCount').textContent='重复 '+number(counts.duplicates)+' · 异常 '+number(counts.rejected);
    const latest=(q.recent || []).find(row=>row.event.eventId===state.lastEventId);
    if(latest && latest.receipt){const r=latest.receipt;receipt(r.state==='accepted'?'云端已绑定':r.state==='duplicate'?'重复码，已记录并剔除':'异常码，已记录并剔除',r.reason || latest.event.code,r.state==='accepted'?'':r.state==='duplicate'?'warning':'error');}
    if($('recentRows'))$('recentRows').innerHTML=(q.recent || []).map(row=>{
      const e=row.event,r=row.receipt;
      const title=r?(r.state==='accepted'?'云端已绑定':r.state==='duplicate'?'重复码（不计数）':'异常码（不计数）'):(e.kind==='valid'?'本机已保存，待同步':e.kind==='duplicate'?'重复码，已剔除':'异常码，已剔除');
      return '<div class="recent"><small>'+escape(title)+' · '+escape(new Date(e.capturedAt).toLocaleTimeString('zh-CN',{hour12:false}))+'</small><code>'+escape(e.code || e.rawCode)+'</code>'+((r&&r.reason)||e.reason?'<small>'+escape(r&&r.reason || e.reason)+'</small>':'')+'</div>';
    }).join('') || '<div class="empty">暂无本机记录</div>';
  }
  function submitScan(raw,manual){
    if(state.page!=='scan' || !state.foreground || state.confirming || !state.scanning){if(manual)toast('请先点击开始连续采集');return;}
    try{
      const result=JSON.parse(Native.collect(String(raw)));
      if(!result.ok)throw new Error(result.error);
      const e=result.event; state.lastEventId=e.eventId;if($('scanInput'))$('scanInput').value='';
      receipt(e.kind==='valid'?'已保存到本机，可以扫描下一件':e.kind==='duplicate'?'重复码，已记录并剔除':'异常码，已记录并剔除',e.reason || e.code,e.kind==='valid'?'':e.kind==='duplicate'?'warning':'error');
      if(e.kind==='valid')Native.confirmed();else Native.rejected();updateQueue();
      if(settings.mode!=='broadcast' && $('scanInput'))$('scanInput').focus();
    }catch(error){state.scanning=false;updateScanLabel();receipt('本次未保存，请暂停检查',error.message,'error');}
  }

  function exportBackup(){state.scanning=false;updateScanLabel();Native.exportBackup();}
  function readExternal(){const result=JSON.parse(Native.externalQueue());if(!result.ok)throw new Error(result.error || '本机外部队列不可用');state.external=result;return result;}
  function externalSetup(){
    readQueue();if(state.queue.session){toast('请先完成本机内部生产采集及同步',true);queuePage();return;}
    let q;try{q=readExternal();}catch(error){toast(error.message,true);return;}
    const device=q.deviceContext,open=q.batch&&q.batch.state==='open',worker=open?q.batch.worker_no:q.selection&&q.selection.workerNo || '';
    selectPage('external-setup','<div class="heading"><h1>外部二维码采集</h1><button id="externalSetupBack" class="iconbutton">返回</button></div><div class="card"><div class="detail-line"><span>厂家</span><strong>'+escape(device&&device.enterpriseName || '请先联网验证设备')+'</strong></div><div class="detail-line"><span>生产流水线</span><strong>'+escape(device&&device.lineName || '请先联网验证设备')+'</strong></div><p class="muted">流水线取自管理员的设备登记。填写工号后即可扫描，产品、生产批号、生产日期及生产数量在后台补填。</p><form id="externalWorkerForm">'+field('externalWorker','本次采集工号（必填）',worker,'text','请输入本次操作工号')+'<button class="primary wide" id="externalStart">进入外部采集</button></form><p class="devicehint">工号是生产记录字段。每次点击“完成本次采集”后，下一扫码自动创建新采集批次。</p></div><button id="externalVerify" class="secondary wide">联网验证设备</button><button id="externalSetupBackup" class="secondary wide">导出完整本机备份</button>'+(q.batch?'<button id="externalView" class="secondary wide">查看外部采集与同步状态</button>':''));
    $('externalWorker').maxLength=64;if(open)$('externalWorker').readOnly=true;
    on('externalWorkerForm','submit',event=>{event.preventDefault();try{const result=JSON.parse(Native.prepareExternal($('externalWorker').value));if(!result.ok)throw new Error(result.error);externalPage();}catch(error){toast(error.message,true);}});
    click('externalSetupBack',()=>{if(state.user)tasks();else deviceActivation();});click('externalVerify',connectDevice);click('externalSetupBackup',exportBackup);click('externalView',externalPage);
    if(q.deviceBlocked){$('externalStart').disabled=true;toast('设备已停用或凭证失效，请联网验证；原文和备份保留',true);}
  }
  function externalPage(){
    let q;try{q=readExternal();}catch(error){toast(error.message,true);return;}
    const selected=q.selection || q.deviceContext || {},worker=selected.workerNo || q.batch&&q.batch.worker_no || '未设置';
    selectPage('external','<div class="heading"><div><div class="eyebrow">'+escape(selected.enterpriseName || '')+'</div><h1>外部二维码采集</h1></div><button id="externalBack" class="iconbutton">返回</button></div><div class="card"><div class="detail-line"><span>生产流水线</span><strong>'+escape(selected.lineName || '-')+'</strong></div><div class="detail-line"><span>采集工号</span><strong>'+escape(worker)+'</strong></div><div class="stats"><div><strong id="externalLocal">0</strong><small>本次初步去重</small></div><div><strong id="externalCloud">0</strong><small>本次云端入库</small></div><div><strong id="externalWaiting">0</strong><small>全部待补传</small></div></div><div id="externalSyncStatus" class="tips"></div><p id="externalBoundary" class="devicehint"></p><button id="externalFinish" class="primary wide">完成本次采集</button><div class="actions sync-actions"><button id="externalUpload" class="secondary">立即同步</button><button id="externalBackup" class="secondary">导出备份</button></div><p class="devicehint">完整扫码原文持续自动上传。断网先保存在本机，联网后补传；不同设备重复以云端结果为准。</p></div><div class="card scan-panel"><h2 id="externalHeading">外部扫码已暂停</h2><div class="scan-entry"><input id="externalInput" autocomplete="off" aria-label="外部二维码原文" placeholder="扫描外部二维码或输入完整原文"><button id="externalSubmit" class="secondary">采集</button></div><button id="externalToggle" class="primary wide">开始连续采集</button></div><div class="card"><div class="split"><h3>最近采集记录</h3><span id="externalAnomalies"></span></div><div id="externalRecent"></div></div>');
    click('externalBack',externalSetup);
    click('externalToggle',()=>{try{const current=readExternal();if(current.deviceBlocked)throw new Error('设备已停用或认证失效，请联网验证');if(!current.selection)throw new Error('请返回填写工号后开始采集');state.scanning=!state.scanning;updateScanLabel();if(state.scanning&&settings.mode!=='broadcast')$('externalInput').focus();}catch(error){toast(error.message,true);}});
    click('externalSubmit',()=>submitExternal($('externalInput').value,true));on('externalInput','keydown',event=>{if(event.key==='Enter'){event.preventDefault();submitExternal($('externalInput').value,false);}});
    click('externalFinish',()=>{try{const result=JSON.parse(Native.finishExternal());if(!result.ok)throw new Error(result.error);toast(result.finishRequested?'本次采集边界已保存，下一扫码归入新批；云端收齐后完成':'本次没有新记录，无需完成');updateExternal();if(state.scanning&&settings.mode!=='broadcast')$('externalInput').focus();}catch(error){toast(error.message,true);}});
    click('externalUpload',()=>{try{const result=JSON.parse(Native.uploadExternal());toast(result.message || '正在补传外部记录',!result.ok);updateExternal();}catch(error){toast(error.message,true);}});click('externalBackup',exportBackup);updateExternal();
  }
  function updateExternal(){
    if(state.page!=='external')return;const q=readExternal(),c=q.counts || {},batch=q.batch,batches=q.batchCounts || {};
    $('externalLocal').textContent=number(c.collected);$('externalCloud').textContent=number(c.accepted);$('externalWaiting').textContent=number(q.queueCounts&&q.queueCounts.waiting);
    $('externalSyncStatus').textContent=q.syncMessage || '等待采集';
    $('externalBoundary').textContent=(batch?'本次'+({open:'采集中',sealed:'已固定，等待云端确认',completed:'已完整上传'}[batch.state] || '待核对'):'等待本次第一条扫码')+' · 已完成 '+number(batches.completed)+' 批 · 等待确认 '+number(batches.pending)+' 批';
    $('externalAnomalies').textContent='本机重复 '+number(c.localDuplicates)+' · 云端重复 '+number(c.duplicates)+' · 云端未入库 '+number(c.rejected);
    if(q.deviceBlocked){state.scanning=false;updateScanLabel();}
    const latest=(q.recent || []).find(row=>row.event.eventId===state.lastExternalEventId);if(latest&&latest.receipt){const r=latest.receipt;receipt(r.state==='accepted'?'云端已入库':r.state==='duplicate'?'重复码，云端未新增':'云端未入库',r.reason || latest.event.rawCode,r.state==='accepted'?'':r.state==='duplicate'?'warning':'error');}
    $('externalRecent').innerHTML=(q.recent || []).map(row=>{const e=row.event,r=row.receipt,title=r?{accepted:'云端已入库',duplicate:'云端重复，未新增',rejected:'云端未入库'}[r.state]:row.localKind==='duplicate'?'本机重复，原文留存待云端确认':'本机已保存，待云端确认';return '<div class="recent"><small>'+escape(title)+' · '+escape(new Date(e.capturedAt).toLocaleTimeString('zh-CN',{hour12:false}))+'</small><code>'+escape(e.rawCode)+'</code>'+(r&&r.reason?'<small>'+escape(r.reason)+'</small>':'')+'</div>';}).join('') || '<div class="empty">暂无本次采集记录</div>';
  }
  function submitExternal(raw,manual){
    if(state.page!=='external'||!state.foreground||state.confirming||!state.scanning){if(manual)toast('请先开始连续采集');return;}
    try{const result=JSON.parse(Native.collectExternal(String(raw)));if(!result.ok)throw new Error(result.error);const e=result.event;state.lastExternalEventId=e.eventId;$('externalInput').value='';receipt(e.localKind==='duplicate'?'本机发现重复，原文留存待云端确认':'完整原文已保存，可以扫描下一件',e.rawCode,e.localKind==='duplicate'?'warning':'');if(e.localKind==='duplicate')Native.rejected();else Native.confirmed();updateExternal();if(settings.mode!=='broadcast')$('externalInput').focus();}
    catch(error){state.scanning=false;updateScanLabel();receipt('本次未录入，请核对',error.message,'error');}
  }
  function showSettings() {
    if (creation()) { toast('有未确认扫码或领用，请先在原服务器核对；需要登录时返回登录页即可'); return; }
    selectPage('settings', '<div class="heading"><h1>连接与扫码设置</h1><button id="settingsBack" class="iconbutton">返回</button></div><form id="settingsForm" class="card">' + field('settingServer', '服务器地址', settings.server, 'url', 'https://www.nz315.cn') + '<label class="field"><span>扫码输出方式</span><select id="settingMode"><option value="broadcast">广播模式（原源码方式）</option><option value="keyboard">键盘输入＋回车</option></select></label><details><summary>自定义广播（可选）</summary>' + field('settingAction', '广播动作', settings.action, 'text', '使用原来的广播时可以留空') + field('settingExtra', '数据字段', settings.extra, 'text', 'scannerdata') + '</details><button class="primary wide" data-busy>保存连接设置</button></form><div class="tips">已保留原源码的扫码广播，并兼容优博讯标准广播。设备扫码服务的输出方式应与这里保持一致。</div><p class="devicehint">已登记设备自动认证。设备凭证由系统加密保存，不导出到备份。</p><button id="backupHistory" class="secondary wide">导出全部本机备份</button><p class="devicehint">包含已结束任务、待上传记录、重复和异常原文及云端收据。</p>' + (state.user && !state.deviceMode ? '<button id="logout" class="secondary wide" data-busy>退出当前账号</button>' : ''));
    $('settingMode').insertAdjacentHTML('afterbegin', '<option value="auto">自动接收（广播与键盘，沿用原源码）</option>'); $('settingMode').value = settings.mode;
    const terminator=document.createElement('label');terminator.className='check';terminator.innerHTML='<input id="stripTerminator" type="checkbox">去掉扫描头附加的末尾回车／换行';$('settingsForm').insertBefore(terminator,$('settingsForm').querySelector('button'));$('stripTerminator').checked=settings.stripTerminator!==false;
    click('backupHistory',exportBackup);
    click('settingsBack', () => { if (state.user) tasks(); else login(); });
    on('settingsForm', 'submit', event => {
      event.preventDefault(); if (state.busy) return;
      const error = Native.configure(JSON.stringify({ server: $('settingServer').value.trim(), mode: $('settingMode').value, action: $('settingAction').value.trim(), extra: $('settingExtra').value.trim() || 'scannerdata',stripTerminator:$('stripTerminator').checked }));
      if (error) { toast(error, true); return; }
      settings = JSON.parse(Native.settings()); state.user = null; bootDevice();
    });
    click('logout', async () => { busy(true); try { await api('POST', '/api/auth/logout', {}); } catch (_) { /* 本机仍清除会话，服务端失效时不保留登录态。 */ } Native.clearSession(); state.user = null; busy(false); login(); });
  }
  function deviceActivation(message) {
    state.deviceMode=true;state.user=null;readQueue();
    const queued=!!state.queue.session;
    selectPage('activation','<div class="heading"><h1>扫码激活设备</h1></div><div class="card"><h2>管理员登记一次，设备自动认证</h2><p class="muted">请管理员在“生产任务与审核 → 设备管理”添加设备，选择公司与生产线。用扫描头扫描后台激活二维码，无需抄写设备号。</p>'+(queued?'<p class="tips">本机有未结束采集，先恢复原设备认证并完成同步，不能更换登记。</p>':field('activationCode','设备激活二维码','', 'text','扫描后台激活二维码')+'<button id="activateButton" class="primary wide" data-busy>激活设备</button>')+'<button id="verifyDevice" class="secondary wide" data-busy>重新验证已登记设备</button></div>'+(queued?'<button id="resumeDeviceQueue" class="secondary wide">查看本机采集与备份</button>':'')+'<p class="devicehint">'+escape(settings.device)+'</p>');
    click('activateButton',()=>submitActivation($('activationCode').value));
    on('activationCode','keydown',event=>{if(event.key==='Enter'){event.preventDefault();submitActivation($('activationCode').value);}});
    click('verifyDevice',connectDevice);click('resumeDeviceQueue',queuePage);
    if($('activationCode'))$('activationCode').focus();
    let info={};try{info=JSON.parse(Native.deviceInfo());}catch(_){}
    if(info.pendingActivation&&!queued){const retry=document.createElement('button');retry.className='secondary wide';retry.textContent='核对上次激活（超时重试）';retry.onclick=()=>submitActivation('');$('main').appendChild(retry);}
    try{const q=readExternal();if(info.hasCredential&&info.registered&&q.deviceContext&&q.deviceContext.server===settings.server){const offline=document.createElement('button');offline.className='secondary wide';offline.textContent='外部采集（可离线）';offline.onclick=externalSetup;$('main').appendChild(offline);}else if(q.batch){const view=document.createElement('button');view.className='secondary wide';view.textContent='查看外部记录并导出备份';view.onclick=externalPage;$('main').appendChild(view);}}catch(_){/* 旧版本无外部队列时保留原激活入口。 */}
    if(message)toast(message,true);
  }
  async function submitActivation(raw) {
    if(state.busy)return;busy(true);
    try{await api('POST','/api/device/activate',{activationCode:String(raw||'').trim()});toast('设备已激活，正在获取公司与生产线');await connectDevice();}
    catch(error){toast(error.message,true);}
    finally{busy(false);}
  }
  async function connectDevice() {
    state.deviceMode=true;busy(true);
    try{const result=await api('POST','/api/device/context',{});if(!result.device||!result.user)throw new Error('设备资料不完整');state.user=result.user;Native.resumeUpload();readQueue();const external=readExternal();if(state.queue.session)queuePage();else if(external.batch&&external.batch.state!=='completed')externalSetup();else await tasks();}
    catch(error){readQueue();if(error.status===0&&state.queue.session){queuePage();toast('网络未连接，本机记录已恢复；联网后重新验证设备',true);}else deviceActivation(error.message);}
    finally{busy(false);}
  }
  function bootDevice() {
    readQueue();const session=state.queue.session;
    // 升级前账号采集的队列必须仍由原账号同步，不转换历史会话的身份。
    if(session&&number(session.context&&session.context.deviceId)===0){state.deviceMode=false;login('先登录原账号，完成旧任务同步后即可使用设备激活');return;}
    let info={};try{info=JSON.parse(Native.deviceInfo());}catch(_){login();return;}
    if(info.hasCredential){state.deviceMode=true;connectDevice();}
    else deviceActivation(info.error);
  }
  let heartbeatBusy=false;
  setInterval(async()=>{
    if(!state.deviceMode||!state.user||!state.foreground||heartbeatBusy)return;
    heartbeatBusy=true;
    try{const result=await api('POST','/api/device/context',{});state.user=result.user;}
    catch(error){if(error.status===403){state.scanning=false;updateScanLabel();if(state.page==='scan')toast(error.message,true);else deviceActivation(error.message);}}
    finally{heartbeatBusy=false;}
  },15000);
  window.PDAScanAdapter = { onScan(raw) { if(state.page==='activation'){submitActivation(raw);return;}if (settings.mode !== 'keyboard'){if(state.page==='external')submitExternal(raw,false);else submitScan(raw, false);} } };
  // 沿用原源码扫码页的键盘自动聚焦；普通登录、填写资料和暂停时不接管键盘。
  document.addEventListener('keydown', event => {
    const input=state.page==='external'?$('externalInput'):$('scanInput');
    if (!['scan','external'].includes(state.page) || !state.foreground || !state.scanning || state.confirming || settings.mode === 'broadcast' || !input) return;

    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey && event.target !== input) {
      event.preventDefault(); input.focus(); input.value += event.key;
    }
  }, true);
  window.App = {
    lifecycle(foreground) { state.foreground = foreground; if (!foreground) { state.scanning = false; updateScanLabel(); } },
    back() {
      if (blockedNavigation()) return;
      if ($('confirmDialog').open) { $('confirmDialog').close('cancel'); return; }
      if(state.page==='external'){externalSetup();return;}if(state.page==='external-setup'){if(state.user)tasks();else deviceActivation();return;}
      if (state.page === 'scan' || state.page === 'task' || state.page === 'create' || state.page === 'settings') { if (state.user) tasks(); else login(); }
      else Native.exit();
    }
  };
  on('settingsButton', 'click', () => { if (!blockedNavigation()) showSettings(); });
  setInterval(()=>{if(!window.Native || !state.foreground)return;try{if(state.page==='external'){updateExternal();return;}const prior=state.queue && state.queue.session;const q=readQueue();if(state.page==='scan' && prior && q.session && prior.phase!==q.session.phase)queuePage();else if(state.page==='scan')updateQueue();}catch(error){state.scanning=false;updateScanLabel();toast(error.message,true);}},1000);
  try {
    if (!window.Native) throw new Error('请在安卓应用内打开生产扫码界面');
    settings=JSON.parse(Native.settings());readQueue();bootDevice();
  } catch (error) { selectPage('error', '<div class="card"><h1>无法启动生产扫码</h1><p>' + escape(error.message) + '</p></div>'); }
})();
