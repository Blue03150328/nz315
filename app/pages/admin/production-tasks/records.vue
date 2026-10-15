<script setup lang="ts">
definePageMeta({layout:'admin',middleware:'backend-guard',keepalive:true})
useHead({title:'生产任务'})
const {canManageUsers,user}=useUser(),toast=useToast(),route=useRoute()
const historyExternal=computed(()=>route.query.view==='external-history')
const filters=reactive({keyword:'',lineName:String(route.query.lineName||''),enterpriseId:String(route.query.enterpriseId||''),operatorId:'',status:'',dateFrom:'',dateTo:''}),keyword=ref(''),page=ref(1)
const {data,pending,error,refresh}=await useFetch<any>('/api/admin/production-lines',{query:computed(()=>({...filters,page:page.value}))})
const {data:options,pending:optionBusy,refresh:refreshOptions}=await useFetch<any>('/api/admin/production-lines/options',{})
watch(keyword,(value,_,cleanup)=>{const timer=setTimeout(()=>{filters.keyword=value.trim();page.value=1},300);cleanup(()=>clearTimeout(timer))})
watch(()=>JSON.stringify(filters),()=>{page.value=1})
const operatorOptions=computed(()=>(options.value?.operators||[]).map((p:any)=>({label:`${p.name} · ${p.username}`,value:String(p.id)})))
const lineOptions=computed(()=>(options.value?.lines||[]).map((name:string)=>({label:name,value:name})))
const statuses=[{label:'全部状态',value:'all'},{label:'未开始',value:'not_started'},{label:'进行中',value:'active'},{label:'已结束',value:'completed'}]
const busy=ref(false)
function resetSearch(){keyword.value='';Object.assign(filters,{keyword:'',lineName:'',enterpriseId:'',operatorId:'',status:'',dateFrom:'',dateTo:''});page.value=1}
watch(()=>[route.query.lineName,route.query.enterpriseId],()=>{filters.lineName=String(route.query.lineName||'');filters.enterpriseId=String(route.query.enterpriseId||'')})
const details=ref<Record<number,boolean>>({}),codeTask=ref<any>(null),showCodes=ref(false),codePage=ref(1),codeState=ref(''),codeKeyword=ref(''),codeSource=ref('internal')
const codeColumns=[{key:'code',label:'追溯码',width:340},{key:'raw_code',label:'外部标签原文',width:500},{key:'product_name',label:'产品',width:240,flex:2},{key:'batch_no',label:'批号',width:160},{key:'produce_date',label:'生产日期',width:150},{key:'operator_name',label:'操作员',width:180},{key:'device',label:'设备',width:160},{key:'used_at',label:'内部采集时间',width:210},{key:'captured_at',label:'外部采集时间',width:210}]
const {data:codeData,pending:codeBusy,refresh:refreshCodes}=await useFetch<any>(()=>codeTask.value?`/api/admin/production-tasks/${codeTask.value.id}${codeSource.value==='external'?'/external-codes':''}`:'/api/admin/production-lines',{immediate:false,query:{page:codePage,state:codeState,keyword:codeKeyword}})
async function openCodes(t:any){codeTask.value=t;codePage.value=1;codeState.value='';codeKeyword.value='';showCodes.value=true;await refreshCodes()}
watch(codeSource,()=>{codePage.value=1;codeState.value=''})
watch([codePage,codeState,codeKeyword,codeSource],()=>{if(showCodes.value)void refreshCodes()})
const selectedIds=ref<number[]>([]),deleteTargets=ref<any[]>([]),showDelete=ref(false)
const removableRows=computed(()=>(data.value?.rows||[]).filter((t:any)=>t.can_delete))
const allSelected=computed(()=>removableRows.value.length>0&&removableRows.value.every((t:any)=>selectedIds.value.includes(Number(t.id))))
function toggleSelected(id:number,checked:boolean){selectedIds.value=checked?[...new Set([...selectedIds.value,id])]:selectedIds.value.filter(n=>n!==id)}
function togglePage(checked:boolean){selectedIds.value=checked?removableRows.value.map((t:any)=>Number(t.id)):[]}
watch(()=>JSON.stringify({...filters,page:page.value}),()=>{selectedIds.value=[]})
watch(data,()=>{const ids=new Set(removableRows.value.map((t:any)=>Number(t.id)));selectedIds.value=selectedIds.value.filter(id=>ids.has(id))})
function openDelete(tasks:any[]){if(!tasks.length||busy.value)return;deleteTargets.value=tasks.map(t=>({...t}));showDelete.value=true}
function openBulkDelete(){openDelete((data.value?.rows||[]).filter((t:any)=>selectedIds.value.includes(Number(t.id))))}
async function removeTasks(){
 if(busy.value||!deleteTargets.value.length)return
 busy.value=true
 try{
  const ids=deleteTargets.value.map(t=>Number(t.id))
  const result=ids.length===1?await $fetch<any>('/api/admin/production-tasks/'+ids[0],{method:'DELETE'}):await $fetch<any>('/api/admin/production-tasks',{method:'DELETE',body:{ids}})
  showDelete.value=false;selectedIds.value=[]
  for(const id of ids)delete details.value[id]
  if(ids.includes(Number(codeTask.value?.id)))showCodes.value=false
  await refresh();await refreshOptions()
  if(page.value>1&&!data.value?.rows?.length){page.value=Math.max(1,Math.ceil(Number(data.value?.total||0)/20))}
  toast.add({title:result.deletedCount?`已删除 ${result.deletedCount} 个任务，追溯历史已保留`:'任务已删除，追溯历史已保留',color:'success'})
 }catch(e:any){toast.add({title:e?.data?.statusMessage||'删除未确认，请刷新后重试',color:'error'})}finally{busy.value=false}
}
const time=(v:any)=>v?String(v).replace('T',' ').slice(0,19):'-'
const clock=(ms:any,fallback:any)=>ms?new Date(Number(ms)).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false}):time(fallback)
let timer:ReturnType<typeof setInterval>|undefined
function startRefresh(){clearInterval(timer);timer=setInterval(()=>{if(document.visibilityState==='visible'&&!showDelete.value)void refresh()},10000)}
onMounted(startRefresh)
onActivated(startRefresh)
onDeactivated(()=>{clearInterval(timer);timer=undefined})
onBeforeUnmount(()=>clearInterval(timer))
const columns=computed(()=>[...(canManageUsers.value?[{key:'selection',label:'选择',width:56,minWidth:56,align:'center' as const}]:[]),{key:'line_name',label:'生产线',width:124},{key:'operatorLabel',label:'操作员',width:160},{key:'productLabel',label:'产品',width:240,flex:2},{key:'statusLabel',label:'状态',width:116},{key:'collected',label:'有效码合计',width:100,minWidth:72,align:'right' as const},{key:'internal_count',label:'内部码',width:76,minWidth:72,align:'right' as const},{key:'external_count',label:'外部码',width:76,minWidth:72,align:'right' as const},{key:'duplicates',label:'重复码',width:76,minWidth:72,align:'right' as const},{key:'exceptions',label:'异常码',width:76,minWidth:72,align:'right' as const},{key:'started',label:'开始时间',width:190},{key:'stopped',label:'结束时间',width:190},{key:'actions',label:'操作',width:224}])
const taskRows=computed(()=>(data.value?.rows||[]).map((t:any)=>{const operators=(t.operators||[]).filter((p:any)=>!p.removed_at||p.started_ms||p.started_at);return {...t,...t.monitor,operatorLabel:operators.map((p:any)=>`${p.name||'-'}（${p.username||'-'}）`).join('、')||'-',productLabel:t.actual_product_names||t.product_name||'-',statusLabel:t.display_status==='not_started'?'未开始':t.display_status==='active'?'进行中':'已结束',started:clock(t.started_ms,t.started_at),stopped:t.status==='active'?'-':clock(t.stopped_ms,t.stopped_at||t.ended_at)}}))
const detailTask=ref<any>(null),showDetail=ref(false)
function openDetail(t:any){detailTask.value=t;showDetail.value=true}
</script>
<template>
 <div class="production-page">
  <ProductionManagementTabs />
  <ExternalCollectionList v-if="historyExternal" mode="tasks" />
  <template v-else>
  <div class="flex flex-wrap justify-between items-center gap-3"><div><h1 class="b-page-title">生产任务</h1><p class="b-page-desc">工人选择生产线后自动加入任务；所有参与设备结束并完整上传后，任务自动结束。</p></div><div class="flex gap-2"><UButton v-if="canManageUsers" color="error" variant="outline" :disabled="!selectedIds.length||busy" @click="openBulkDelete">批量删除<span v-if="selectedIds.length">（{{ selectedIds.length }}）</span></UButton></div></div>
  <div class="b-card production-panel">
   <form class="flex flex-wrap items-end gap-3" @submit.prevent="filters.keyword=keyword.trim();refresh()"><label class="min-w-64 flex-1"><span class="block mb-1 text-sm">模糊搜索</span><UInput v-model="keyword" placeholder="产品、生产线、员工姓名或工号" class="w-full" /></label><label><span class="block mb-1 text-sm">操作员</span><USelectMenu v-model="filters.operatorId" :items="operatorOptions" value-key="value" placeholder="全部操作员" :clear="true" :search-input="{placeholder:'姓名或工号'}" /></label><label><span class="block mb-1 text-sm">创建日期从</span><input v-model="filters.dateFrom" type="date" class="rounded border p-2" /></label><label><span class="block mb-1 text-sm">至</span><input v-model="filters.dateTo" type="date" class="rounded border p-2" /></label><UButton type="submit">查询</UButton><UButton variant="outline" @click="resetSearch">重置</UButton><UButton variant="outline" :loading="pending" @click="refresh()">刷新</UButton></form>
   <p class="text-sm text-muted">拖动表头移动整列，拖动列边线调整宽度；支持左右滚动。码数只统计服务器已确认的记录。</p>
   <p v-if="error" class="text-error">查询失败，请重试。</p><p v-else-if="pending&&!data?.rows">正在加载…</p>
   <ProductionGrid class="production-table" fill-height :columns="columns" :rows="taskRows" row-key="id" :storage-key="'production-task-columns:v3:'+user?.id">
    <template #filter-selection><input v-if="canManageUsers" type="checkbox" aria-label="选择当前页可删除任务" :checked="allSelected" :indeterminate="selectedIds.length>0&&!allSelected" :disabled="!removableRows.length||busy" @change="togglePage(($event.target as HTMLInputElement).checked)"></template>
    <template #filter-line_name><USelectMenu v-model="filters.lineName" :items="lineOptions" value-key="value" placeholder="全部生产线" aria-label="按生产线筛选" :clear="true" :search-input="{placeholder:'搜索生产线'}" class="w-full" size="xs" /></template>
    <template #filter-operatorLabel><USelectMenu v-model="filters.operatorId" :items="operatorOptions" value-key="value" placeholder="全部操作员" aria-label="按操作员筛选" :clear="true" :search-input="{placeholder:'搜索姓名或工号'}" class="w-full" size="xs" /></template>
    <template #filter-statusLabel><USelect v-model="filters.status" :items="statuses" value-key="value" placeholder="全部状态" aria-label="按状态筛选" class="w-full" size="xs" /></template>
    <template #cell-selection="{row}"><input type="checkbox" :aria-label="'选择生产任务 '+row.line_name+'，编号 '+row.id" :checked="selectedIds.includes(Number(row.id))" :disabled="!row.can_delete||busy" @change="toggleSelected(Number(row.id),($event.target as HTMLInputElement).checked)"></template>
    <template #cell-statusLabel="{row}"><span :class="row.display_status==='active'?'b-tag-success':'b-tag'">{{ row.statusLabel }}</span></template>
    <template #cell-actions="{row}"><div class="flex gap-2"><UButton size="xs" variant="outline" @click="openDetail(row)">员工详情</UButton><UButton size="xs" variant="outline" @click="openCodes(row)">码明细</UButton><UButton v-if="canManageUsers" size="xs" color="error" variant="outline" :disabled="!row.can_delete||busy" @click="openDelete([row])">删除记录</UButton></div></template>
   </ProductionGrid>
   <div class="flex items-center gap-3"><span class="text-sm text-muted">共 {{ data?.total||0 }} 个任务</span><UButton :disabled="page<=1||pending" variant="outline" @click="page--">上一页</UButton><span>第 {{ page }} 页</span><UButton :disabled="page*20>=(data?.total||0)||pending" variant="outline" @click="page++">下一页</UButton></div>
  </div>
  <UModal v-model:open="showDetail" :title="(detailTask?.line_name||'')+' · 员工扫码情况'" :ui="{content:'max-w-[95vw]'}"><template #body><ProductionWorkerProgress v-if="detailTask" :key="detailTask.id" :task-id="detailTask.id" /></template></UModal>
  <UModal v-model:open="showDelete" :title="deleteTargets.length===1?'删除生产任务':'批量删除生产任务'" :dismissible="!busy" :close="false"><template #body><p class="mb-3">确认删除以下 {{ deleteTargets.length }} 个任务？</p><ul class="mb-3 max-h-60 overflow-y-auto space-y-2"><li v-for="t in deleteTargets" :key="t.id"><strong>{{ t.line_name||'-' }}</strong> · 任务编号 {{ t.id }}</li></ul><p class="text-sm text-muted">删除后任务不再出现在列表中。追溯码、生产资料、人员和设备扫码历史完整保留；已领用码不会释放或再次分配。</p><p v-if="deleteTargets.length>1" class="mt-2 text-sm text-muted">所有所选任务必须符合删除条件；任一任务不能删除时，整批保持原样。</p></template><template #footer><UButton color="error" :loading="busy" :disabled="busy" @click="removeTasks">确认删除</UButton><UButton variant="outline" :disabled="busy" @click="showDelete=false">取消</UButton></template></UModal>
  <UModal v-model:open="showCodes" :title="(codeTask?.line_name||'')+' · 码明细'" :close="{ 'aria-label':'关闭' }" :ui="{content:'max-w-5xl'}"><template #body><div class="space-y-3"><div class="flex flex-wrap gap-3"><select v-model="codeSource" class="rounded border p-2"><option value="internal">内部码</option><option value="external">外部码</option></select><UInput v-model="codeKeyword" placeholder="码原文模糊查询" /><select v-if="codeSource==='internal'" v-model="codeState" class="rounded border p-2"><option value="">全部</option><option value="used">已扫码</option><option value="reserved">未扫描</option></select></div><p v-if="codeBusy">正在加载…</p><ProductionGrid :columns="codeColumns.filter(c=>codeSource==='external'?!['code','used_at'].includes(c.key):!['raw_code','captured_at'].includes(c.key))" :rows="codeData?.rows||[]" :row-key="codeSource==='external'?'id':'code_id'" :storage-key="'task-code-columns:v1:'+codeSource+':'+user?.id" /><div class="flex gap-3"><UButton :disabled="codePage<=1" variant="outline" @click="codePage--">上一页</UButton><span>第 {{ codePage }} 页，共 {{ codeData?.filteredTotal||0 }} 个码</span><UButton :disabled="codePage*100>=(codeData?.filteredTotal||0)" variant="outline" @click="codePage++">下一页</UButton></div></div></template></UModal>
 </template>
 </div>
</template>
<style scoped>input[type=checkbox]{width:18px;height:18px;accent-color:var(--ui-primary)}
.production-page{display:flex;flex-direction:column;flex:1;min-height:0;gap:12px}.production-page>div{flex-shrink:0}.production-page>.production-panel{display:flex;flex-direction:column;flex:1;min-height:300px;padding:12px;gap:12px}.production-panel>.production-table{flex:1;min-height:0}
</style>
