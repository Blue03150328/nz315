(function(){'use strict';
 const main=document.getElementById('main');let dispose=()=>{},dismiss=()=>false;
 window.WorkerProductPicker={close:()=>dismiss()};
 // 原产品select继续承载实际ID和切换事件，弹窗只负责搜索与点选。
 function attach(){
  dispose();dispose=()=>{};dismiss=()=>false;const select=document.getElementById('product');if(!select)return;
  const label=select.closest('label'),box=document.createElement('div');box.className='product-picker';
  box.innerHTML='<button id="productPicker" type="button" class="product-picker-trigger" aria-haspopup="dialog" aria-controls="productDialog" aria-expanded="false">请选择产品</button><dialog id="productDialog" class="product-dialog" aria-labelledby="productDialogTitle"><div class="product-dialog-heading"><h2 id="productDialogTitle">选择产品</h2><button id="productCancel" type="button" aria-label="取消选择产品">取消</button></div><div class="product-search-row"><input id="productSearch" type="search" maxlength="100" role="combobox" aria-label="搜索产品" aria-autocomplete="list" aria-controls="productOptions" aria-expanded="true" autocomplete="off" placeholder="名称、商标、规格、登记证号"><button id="productClear" type="button">清空</button></div><p id="productSelected" class="product-selected" hidden></p><p id="productCount" role="status"></p><div id="productOptions" role="listbox" aria-label="产品选项"></div></dialog>';
  label.htmlFor='productPicker';label.classList.add('product-picker-label');label.insertAdjacentElement('afterend',box);select.hidden=true;select.tabIndex=-1;select.setAttribute('aria-hidden','true');
  const trigger=box.querySelector('#productPicker'),dialog=box.querySelector('dialog'),input=box.querySelector('input'),list=box.querySelector('#productOptions'),count=box.querySelector('#productCount'),selectedHint=box.querySelector('#productSelected');
  let keyword='',rows=[],filtered=[],active=-1;
  const selected=()=>rows.find(row=>row.value===select.value);
  function selection(){const row=selected();trigger.textContent=row?row.text:'请选择产品';selectedHint.textContent=row?'已选：'+row.text:'';selectedHint.hidden=!row;}
  function highlight(){Array.from(list.children).forEach((button,i)=>button.classList.toggle('active',i===active));if(active>=0){input.setAttribute('aria-activedescendant','productOption'+active);list.children[active].scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');}
  function close(){if(!dialog.open)return false;dialog.close();trigger.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');input.value='';keyword='';selection();trigger.focus({preventScroll:true});return true;}
  function choose(row){if(select.disabled||document.getElementById('start')?.disabled||!rows.some(item=>item.value===row.value))return;const changed=select.value!==row.value;select.value=row.value;if(changed)select.dispatchEvent(new Event('change',{bubbles:true}));close();}
  function render(){
   filtered=rows.filter(row=>WorkerPreparation.matches(row.text,keyword));active=-1;list.innerHTML='';count.textContent=rows.length?'匹配 '+filtered.length+' / '+rows.length+' 个产品':'暂无产品，请联网更新缓存';
   if(!filtered.length&&rows.length)count.textContent+='，请更换关键词';
   for(const [i,row] of filtered.entries()){const button=document.createElement('button');button.id='productOption'+i;button.type='button';button.setAttribute('role','option');button.setAttribute('aria-selected',String(row.value===select.value));button.textContent=row.text;button.onmousedown=e=>e.preventDefault();button.onclick=()=>choose(row);list.appendChild(button);}
   list.scrollTop=0;input.removeAttribute('aria-activedescendant');selection();
  }
  function sync(){rows=Array.from(select.options).filter(option=>option.value&&!option.disabled).map(option=>({value:option.value,text:option.textContent}));trigger.disabled=select.disabled;selection();if(select.disabled)close();else if(dialog.open)render();}
  const viewport=()=>dialog.style.setProperty('--product-viewport',Math.floor(window.visualViewport?.height||window.innerHeight)+'px');
  function open(){if(trigger.disabled||document.getElementById('start')?.disabled||dialog.open)return;keyword='';input.value='';render();viewport();dialog.showModal();trigger.setAttribute('aria-expanded','true');input.focus();}
  trigger.onclick=open;input.oninput=()=>{keyword=input.value;render();};
  input.onkeydown=e=>{if(e.isComposing)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(filtered.length){active=e.key==='ArrowDown'?Math.min(active+1,filtered.length-1):Math.max(active-1,0);highlight();}}else if(e.key==='Enter'){e.preventDefault();if(active>=0||filtered.length===1)choose(filtered[active>=0?active:0]);}};
  dialog.onkeydown=e=>{if(e.key==='Escape'&&!e.isComposing){e.preventDefault();close();}};
  dialog.oncancel=e=>{e.preventDefault();close();};dialog.onclick=e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();};
  box.querySelector('#productCancel').onclick=close;box.querySelector('#productClear').onclick=()=>{input.value='';keyword='';render();input.focus();};
  const changed=()=>sync(),observer=new MutationObserver(sync);select.addEventListener('change',changed);observer.observe(select,{childList:true,attributes:true,attributeFilter:['disabled']});window.visualViewport?.addEventListener('resize',viewport);sync();dismiss=close;
  dispose=()=>{observer.disconnect();select.removeEventListener('change',changed);window.visualViewport?.removeEventListener('resize',viewport);if(dialog.open)dialog.close();box.remove();};
 }
 const observer=new MutationObserver(attach);observer.observe(main,{childList:true});attach();
})();
