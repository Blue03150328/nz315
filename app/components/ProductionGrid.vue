<script setup lang="ts">
type Column={key:string,label:string,width?:number}
const props=defineProps<{columns:Column[],rows:any[],rowKey:string,storageKey:string}>()
const order=ref<string[]>(props.columns.map(c=>c.key)),widths=ref<Record<string,number>>({}),dragging=ref(''),dropTarget=ref('')
const shown=computed(()=>order.value.map(key=>props.columns.find(c=>c.key===key)).filter(Boolean) as Column[])
const width=(c:Column)=>widths.value[c.key]||c.width||140
function persist(){try{localStorage.setItem(props.storageKey,JSON.stringify({order:order.value,widths:widths.value}))}catch{}}
// 使用原目标位置，使向左、向右拖动都能移动整列，列宽与内容随列保留。
function move(key:string,target:string){const index=order.value.indexOf(target);if(!key||key===target||index<0||!order.value.includes(key))return;const next=order.value.filter(c=>c!==key);next.splice(index,0,key);order.value=next;persist()}
function dragStart(c:Column,event:DragEvent){if((event.target as HTMLElement).closest('button,input,select,[role=combobox],.resize-column')){event.preventDefault();return}dragging.value=c.key;dropTarget.value='';event.dataTransfer?.setData('text/plain',c.key);if(event.dataTransfer)event.dataTransfer.effectAllowed='move'}
function dragEnd(){dragging.value='';dropTarget.value=''}
function dropColumn(target:string){move(dragging.value,target);dragEnd()}
const columnClass=(key:string)=>({'column-dragging':dragging.value===key,'column-target':!!dragging.value&&dragging.value!==key&&dropTarget.value===key})
function reset(){order.value=props.columns.map(c=>c.key);widths.value={};persist()}
function keyboard(c:Column,e:KeyboardEvent){if(e.target!==e.currentTarget)return;if(!e.altKey||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const i=order.value.indexOf(c.key),j=i+(e.key==='ArrowLeft'?-1:1);if(j<0||j>=order.value.length)return;const next=[...order.value];[next[i],next[j]]=[next[j]!,next[i]!];order.value=next;persist()}
function resize(c:Column,e:PointerEvent){e.preventDefault();e.stopPropagation();const x=e.clientX,initial=width(c),target=e.currentTarget as HTMLElement;target.setPointerCapture(e.pointerId);const change=(event:PointerEvent)=>{widths.value={...widths.value,[c.key]:Math.max(90,Math.min(900,initial+event.clientX-x))}};const stop=()=>{target.removeEventListener('pointermove',change);target.removeEventListener('pointerup',stop);target.removeEventListener('pointercancel',stop);persist()};target.addEventListener('pointermove',change);target.addEventListener('pointerup',stop);target.addEventListener('pointercancel',stop)}
onMounted(()=>{try{const saved=JSON.parse(localStorage.getItem(props.storageKey)||'{}'),known=props.columns.map(c=>c.key);if(Array.isArray(saved.order))order.value=[...new Set<string>(saved.order.filter((k:any)=>known.includes(k))),...known.filter(k=>!saved.order.includes(k))];if(saved.widths&&typeof saved.widths==='object')for(const key of known){const value=Number(saved.widths[key]);if(Number.isFinite(value)&&value>=90&&value<=900)widths.value[key]=value}}catch{}})
watch(()=>props.columns.map(c=>c.key),known=>{order.value=[...order.value.filter(key=>known.includes(key)),...known.filter(key=>!order.value.includes(key))]})
</script>
<template>
 <div><div class="flex justify-end mb-2"><button class="text-sm text-muted" type="button" @click="reset">恢复默认列</button></div><div class="production-grid" tabindex="0" aria-label="生产表格，可左右滚动">
  <table :style="{width:shown.reduce((sum,c)=>sum+width(c),0)+'px'}"><colgroup><col v-for="c in shown" :key="c.key" :style="{width:width(c)+'px'}"></colgroup>
   <thead><tr><th v-for="c in shown" :key="c.key" draggable="true" tabindex="0" :data-column="c.key" :class="columnClass(c.key)" :aria-label="c.label+'，拖动整列，Alt加左右键移动'" @keydown="keyboard(c,$event)" @dragstart="dragStart(c,$event)" @dragend="dragEnd" @dragover.prevent="dropTarget=c.key" @drop.prevent="dropColumn(c.key)">
    <span class="column-name">{{ c.label }}</span><slot :name="'filter-'+c.key"/><span class="resize-column" role="separator" aria-orientation="vertical" :aria-label="'调整'+c.label+'列宽'" @pointerdown="resize(c,$event)" @dragstart.prevent/>
   </th></tr></thead>
   <tbody><tr v-for="r in rows" :key="r[rowKey]"><td v-for="c in shown" :key="c.key" :data-column="c.key" :class="columnClass(c.key)" :title="String(r[c.key]??'')" @dragover.prevent="dropTarget=c.key" @drop.prevent="dropColumn(c.key)"><slot :name="'cell-'+c.key" :row="r">{{ r[c.key]??'-' }}</slot></td></tr><tr v-if="!rows.length"><td :colspan="shown.length" class="text-center py-8">暂无符合条件的记录</td></tr></tbody>
  </table>
 </div></div>
</template>
<style scoped>
.production-grid{--grid-line:#b8c4d0;overflow:auto;max-width:100%;border:1px solid var(--grid-line);border-radius:0}.production-grid table{table-layout:fixed;border-collapse:collapse;min-width:100%}.production-grid th,.production-grid td{padding:12px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:1px solid var(--grid-line);height:52px}.production-grid th{position:relative;background:var(--ui-bg-elevated);vertical-align:top;cursor:grab;font-weight:600}.column-name{display:block;margin-bottom:6px}.resize-column{position:absolute;right:0;top:0;width:7px;height:100%;cursor:col-resize;touch-action:none}.resize-column:hover{background:var(--ui-primary)}.production-grid tbody tr:hover{background:var(--ui-bg-elevated)}.production-grid .column-dragging{background:color-mix(in srgb,var(--ui-primary) 14%,var(--ui-bg));cursor:grabbing}.production-grid .column-target{box-shadow:inset 3px 0 var(--ui-primary)}
</style>
