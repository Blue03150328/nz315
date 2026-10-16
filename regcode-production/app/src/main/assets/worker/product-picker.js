(function(){'use strict';
 const main=document.getElementById('main');let dispose=()=>{};
 // 保留原产品ID控件和切换事件，只增强它的选择交互。
 function attach(){
  dispose();dispose=()=>{};const select=document.getElementById('product');if(!select)return;
  const label=select.closest('label'),box=document.createElement('div');box.className='product-combobox';
  box.innerHTML='<input id="productSearch" type="text" maxlength="100" role="combobox" aria-label="选择产品，输入关键词筛选" aria-autocomplete="list" aria-controls="productOptions" aria-expanded="false" autocomplete="off" placeholder="点击选择或输入产品关键词"><div id="productDropdown" class="product-dropdown" hidden><p id="productCount" role="status"></p><div id="productOptions" role="listbox" aria-label="产品选项"></div></div><p id="productSelected" class="product-selected" hidden></p>';
  label.htmlFor='productSearch';label.classList.add('product-picker-label');label.insertAdjacentElement('afterend',box);select.hidden=true;select.tabIndex=-1;select.setAttribute('aria-hidden','true');
  const input=box.querySelector('input'),dropdown=box.querySelector('#productDropdown'),list=box.querySelector('#productOptions'),count=box.querySelector('#productCount'),selectedHint=box.querySelector('#productSelected');
  let opened=false,keyword='',rows=[],filtered=[],active=-1;
  const selected=()=>rows.find(row=>row.value===select.value);
  function selection(){const row=selected();selectedHint.textContent=row?'已选：'+row.text:'';selectedHint.hidden=!row;}
  function highlight(){Array.from(list.children).forEach((button,i)=>button.classList.toggle('active',i===active));if(active>=0){input.setAttribute('aria-activedescendant','productOption'+active);list.children[active].scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');}
  function close(){opened=false;dropdown.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');input.value=selected()?.text||'';keyword='';selection();}
  function choose(row){if(select.disabled||document.getElementById('start')?.disabled||!rows.some(item=>item.value===row.value))return;const changed=select.value!==row.value;select.value=row.value;if(changed)select.dispatchEvent(new Event('change',{bubbles:true}));close();input.blur();}
  function render(){
   filtered=rows.filter(row=>WorkerPreparation.matches(row.text,keyword));active=-1;list.innerHTML='';count.textContent=rows.length?'匹配 '+filtered.length+' / '+rows.length+' 个产品':'暂无产品，请联网更新缓存';
   if(!filtered.length&&rows.length)count.textContent+='，请更换关键词';
   for(const [i,row] of filtered.entries()){const button=document.createElement('button');button.id='productOption'+i;button.type='button';button.setAttribute('role','option');button.setAttribute('aria-selected',String(row.value===select.value));button.textContent=row.text;button.onmousedown=e=>e.preventDefault();button.onclick=()=>choose(row);list.appendChild(button);}
   input.removeAttribute('aria-activedescendant');selection();
  }
  function sync(){rows=Array.from(select.options).filter(option=>option.value&&!option.disabled).map(option=>({value:option.value,text:option.textContent}));input.disabled=select.disabled;if(opened)render();else close();}
  function open(){if(input.disabled||opened)return;opened=true;keyword='';input.value='';dropdown.hidden=false;input.setAttribute('aria-expanded','true');render();}
  input.onfocus=open;input.onclick=open;input.oninput=()=>{const value=input.value;if(!opened)open();keyword=value;input.value=value;render();};
  input.onkeydown=e=>{if(e.isComposing)return;if(e.key==='Escape'){e.preventDefault();close();input.blur();}else if(e.key==='Tab'){close();}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open();if(filtered.length){active=e.key==='ArrowDown'?Math.min(active+1,filtered.length-1):Math.max(active-1,0);highlight();}}else if(e.key==='Enter'){e.preventDefault();if(opened&&(active>=0||filtered.length===1))choose(filtered[active>=0?active:0]);}};
  const outside=e=>{if(!box.contains(e.target)&&!label.contains(e.target))close();},changed=()=>{sync();};
  // 等点击落到原目标后再收起，避免触摸过程中布局移动导致误点开工。
  document.addEventListener('click',outside);select.addEventListener('change',changed);
  const observer=new MutationObserver(sync);observer.observe(select,{childList:true,attributes:true,attributeFilter:['disabled']});sync();
  dispose=()=>{observer.disconnect();document.removeEventListener('click',outside);select.removeEventListener('change',changed);};
 }
 const observer=new MutationObserver(attach);observer.observe(main,{childList:true});attach();
})();
