<script setup lang="ts">
type Column={key:string,label:string,width?:number}
const props=defineProps<{columns:Column[],rows:any[],rowKey:string,storageKey:string}>()
const order=ref<string[]>(props.columns.map(c=>c.key)),widths=ref<Record<string,number>>({}),dragging=ref('')
const shown=computed(()=>order.value.map(key=>props.columns.find(c=>c.key===key)).filter(Boolean) as Column[])
const width=(c:Column)=>widths.value[c.key]||c.width||140
function persist(){try{localStorage.setItem(props.storageKey,JSON.stringify({order:order.value,widths:widths.value}))}catch{}}
function move(key:string,target:string){if(!key||key===target)return;const next=order.value.filter(c=>c!==key);next.splice(next.indexOf(target),0,key);order.value=next;persist()}
function reset(){order.value=props.columns.map(c=>c.key);widths.value={};persist()}
function keyboard(c:Column,e:KeyboardEvent){if(e.target!==e.currentTarget)return;if(!e.altKey||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const i=order.value.indexOf(c.key),j=i+(e.key==='ArrowLeft'?-1:1);if(j<0||j>=order.value.length)return;const next=[...order.value];[next[i],next[j]]=[next[j]!,next[i]!];order.value=next;persist()}
function resize(c:Column,e:PointerEvent){e.preventDefault();e.stopPropagation();const x=e.clientX,initial=width(c),target=e.currentTarget as HTMLElement;target.setPointerCapture(e.pointerId);const change=(event:PointerEvent)=>{widths.value={...widths.value,[c.key]:Math.max(90,Math.min(900,initial+event.clientX-x))}};const stop=()=>{target.removeEventListener('pointermove',change);target.removeEventListener('pointerup',stop);target.removeEventListener('pointercancel',stop);persist()};target.addEventListener('pointermove',change);target.addEventListener('pointerup',stop);target.addEventListener('pointercancel',stop)}
onMounted(()=>{try{const saved=JSON.parse(localStorage.getItem(props.storageKey)||'{}'),known=props.columns.map(c=>c.key);if(Array.isArray(saved.order))order.value=[...new Set<string>(saved.order.filter((k:any)=>known.includes(k))),...known.filter(k=>!saved.order.includes(k))];if(saved.widths&&typeof saved.widths==='object')for(const key of known){const value=Number(saved.widths[key]);if(Number.isFinite(value)&&value>=90&&value<=900)widths.value[key]=value}}catch{}})
</script>
<template>
 <div><div class="flex justify-end mb-2"><button class="text-sm text-muted" type="button" @click="reset">恢复默认列</button></div><div class="production-grid" tabindex="0" aria-label="生产表格，可左右滚动">
  <table :style="{width:shown.reduce((sum,c)=>sum+width(c),0)+'px'}"><colgroup><col v-for="c in shown" :key="c.key" :style="{width:width(c)+'px'}"></colgroup>
   <thead><tr><th v-for="c in shown" :key="c.key" draggable="true" tabindex="0" :data-column="c.key" :aria-label="c.label+'，拖动调整列顺序，Alt加左右键移动'" @keydown="keyboard(c,$event)" @dragstart="dragging=c.key;($event.dataTransfer as DataTransfer).setData('text/plain',c.key)" @dragend="dragging=''" @dragover.prevent @drop.prevent="move(dragging,c.key);dragging=''">
    <span class="column-name">{{ c.label }}</span><slot :name="'filter-'+c.key"/><span class="resize-column" role="separator" aria-orientation="vertical" :aria-label="'调整'+c.label+'列宽'" @pointerdown="resize(c,$event)" @dragstart.prevent/>
   </th></tr></thead>
   <tbody><tr v-for="r in rows" :key="r[rowKey]"><td v-for="c in shown" :key="c.key" :data-column="c.key" :title="String(r[c.key]??'')"><slot :name="'cell-'+c.key" :row="r">{{ r[c.key]??'-' }}</slot></td></tr><tr v-if="!rows.length"><td :colspan="shown.length" class="text-center py-8">暂无符合条件的记录</td></tr></tbody>
  </table>
 </div></div>
</template>
<style scoped>
.production-grid{overflow:auto;max-width:100%;border:1px solid var(--b-divider);border-radius:8px}.production-grid table{table-layout:fixed;border-collapse:collapse;min-width:100%}.production-grid th,.production-grid td{padding:12px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid var(--b-divider);height:52px}.production-grid th{position:relative;background:var(--ui-bg-elevated);vertical-align:top;cursor:grab}.column-name{display:block;margin-bottom:6px}.resize-column{position:absolute;right:0;top:0;width:7px;height:100%;cursor:col-resize;touch-action:none;border-right:1px solid var(--b-divider)}.resize-column:hover{background:var(--ui-primary)}.production-grid tbody tr:hover{background:var(--ui-bg-elevated)}
</style>
