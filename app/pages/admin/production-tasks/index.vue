<script setup lang="ts">
import ProductionDeviceManager from '~/components/ProductionDeviceManager.vue'
definePageMeta({layout:'admin',middleware:'backend-guard',keepalive:true})
useHead({title:'生产任务'})
const {canManageUsers,user}=useUser(),toast=useToast()
const filters=reactive({keyword:'',lineName:'',operatorId:'',status:'',dateFrom:'',dateTo:''}),keyword=ref(''),page=ref(1)
const {data,pending,error,refresh}=await useFetch<any>('/api/admin/production-lines',{query:computed(()=>({...filters,page:page.value}))})
const {data:options,pending:optionBusy,refresh:refreshOptions}=await useFetch<any>('/api/admin/production-lines/options',{})
watch(keyword,(value,_,cleanup)=>{const timer=setTimeout(()=>{filters.keyword=value.trim();page.value=1},300);cleanup(()=>clearTimeout(timer))})
watch(()=>JSON.stringify(filters),()=>{page.value=1})
const operatorOptions=computed(()=>(options.value?.operators||[]).map((p:any)=>({label:`${p.name} · ${p.username}`,value:String(p.id)})))
const lineOptions=computed(()=>(options.value?.lines||[]).map((name:string)=>({label:name,value:name})))
const statuses=[{label:'全部状态',value:'all'},{label:'进行中',value:'active'},{label:'已结束',value:'completed'}]
const showDevices=ref(false),showForm=ref(false),busy=ref(false),editing=ref<any>(null),requestId=ref(crypto.randomUUID())
const form=ref({name:'',lineName:'',enterpriseId:String(user.value?.enterprise_id||''),operatorIds:[] as string[]})
const selectedEnterprise=computed(()=>editing.value?.enterprise_id||Number(form.value.enterpriseId)||user.value?.enterprise_id)
const enterpriseOptions=computed(()=>[...new Map<number,any>((options.value?.operators||[]).map((p:any)=>[Number(p.enterprise_id),{label:p.enterprise_name,value:String(p.enterprise_id)}] as [number,any])).values()])
const workerOptions=computed(()=>(options.value?.operators||[]).filter((p:any)=>Number(p.enterprise_id)===Number(selectedEnterprise.value)).map((p:any)=>({label:`${p.name} · ${p.username}`,value:String(p.id)})))
watch(()=>form.value.enterpriseId,()=>{if(!editing.value)form.value.operatorIds=[]})
watch(()=>JSON.stringify(form.value),()=>{if(!busy.value)requestId.value=crypto.randomUUID()})
function resetSearch(){keyword.value='';Object.assign(filters,{keyword:'',lineName:'',operatorId:'',status:'',dateFrom:'',dateTo:''});page.value=1}
function openCreate(){editing.value=null;form.value={name:'',lineName:'',enterpriseId:String(user.value?.enterprise_id||''),operatorIds:[]};requestId.value=crypto.randomUUID();showForm.value=true;void refreshOptions()}
function openEdit(t:any){editing.value=t;form.value={name:t.name,lineName:t.line_name,enterpriseId:String(t.enterprise_id),operatorIds:(t.operators||[]).filter((p:any)=>!p.removed_at).map((p:any)=>String(p.user_id))};showForm.value=true}
async function save(){if(busy.value)return;busy.value=true;try{const body={...form.value,enterpriseId:Number(selectedEnterprise.value),operatorIds:form.value.operatorIds.map(Number),requestId:requestId.value};if(editing.value)await $fetch('/api/admin/production-lines/'+editing.value.id,{method:'PATCH',body:{...body,action:'edit'}});else await $fetch('/api/admin/production-lines',{method:'POST',body});showForm.value=false;await refresh();await refreshOptions();toast.add({title:'任务已保存',color:'success'})}catch(e:any){toast.add({title:e?.data?.statusMessage||'保存未确认，请使用原内容重试',color:'error'})}finally{busy.value=false}}
const details=ref<Record<number,boolean>>({}),codeTask=ref<any>(null),showCodes=ref(false),codePage=ref(1),codeState=ref(''),codeKeyword=ref('')
const {data:codeData,pending:codeBusy,refresh:refreshCodes}=await useFetch<any>(()=>codeTask.value?`/api/admin/production-tasks/${codeTask.value.id}`:'/api/admin/production-lines',{immediate:false,query:{page:codePage,state:codeState,keyword:codeKeyword}})
async function openCodes(t:any){codeTask.value=t;codePage.value=1;codeState.value='';codeKeyword.value='';showCodes.value=true;await refreshCodes()}
watch([codePage,codeState,codeKeyword],()=>{if(showCodes.value)void refreshCodes()})
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
function startRefresh(){clearInterval(timer);timer=setInterval(()=>{if(document.visibilityState==='visible'&&!showForm.value&&!showDelete.value)void refresh()},10000)}
onMounted(startRefresh)
onActivated(startRefresh)
onDeactivated(()=>{clearInterval(timer);timer=undefined})
onBeforeUnmount(()=>clearInterval(timer))
const columns=computed(()=>[...(canManageUsers.value?[{key:'selection',label:'选择',width:90}]:[]),{key:'name',label:'任务名称',width:210},{key:'line_name',label:'生产线',width:160},{key:'operatorUsernames',label:'操作员工号',width:180},{key:'operatorNames',label:'操作员姓名',width:200},{key:'productLabel',label:'产品',width:240},{key:'statusLabel',label:'状态',width:140},{key:'runningDevices',label:'运行设备',width:110},{key:'pausedDevices',label:'暂停设备',width:110},{key:'offlineDevices',label:'离线设备',width:110},{key:'pendingDevices',label:'待同步设备',width:130},{key:'participatingDevices',label:'参与设备',width:110},{key:'collected',label:'有效码',width:130},{key:'duplicates',label:'重复码',width:110},{key:'exceptions',label:'异常码',width:110},{key:'started',label:'开始时间',width:200},{key:'stopped',label:'结束时间',width:200},{key:'actions',label:'操作',width:270}])
const taskRows=computed(()=>(data.value?.rows||[]).map((t:any)=>{const operators=(t.operators||[]).filter((p:any)=>!p.removed_at||p.started_ms||p.started_at);return {...t,...t.monitor,operatorUsernames:operators.map((p:any)=>p.username||'-').join('、')||'-',operatorNames:operators.map((p:any)=>p.name||'-').join('、')||'-',productLabel:t.actual_product_names||t.product_name||'-',statusLabel:t.status==='active'?'进行中':'已结束',started:clock(t.started_ms,t.started_at),stopped:t.status==='active'?'-':clock(t.stopped_ms,t.stopped_at||t.ended_at)}}))
const pageStats=computed(()=>taskRows.value.reduce((sum:any,t:any)=>{for(const key of ['runningDevices','pausedDevices','offlineDevices','pendingDevices','collected'])sum[key]+=Number(t[key]||0);return sum},{runningDevices:0,pausedDevices:0,offlineDevices:0,pendingDevices:0,collected:0}))
const detailTask=ref<any>(null),showDetail=ref(false)
function openDetail(t:any){detailTask.value=t;showDetail.value=true}
</script>
<template>
 <div class="space-y-4">
  <div class="flex flex-wrap justify-between items-center gap-3"><div><h1 class="b-page-title">生产任务</h1><p class="b-page-desc">工人选择生产线后自动加入任务；所有参与设备结束并完整上传后，任务自动结束。</p></div><div class="flex gap-2"><UButton v-if="canManageUsers" color="error" variant="outline" :disabled="!selectedIds.length||busy" @click="openBulkDelete">批量删除<span v-if="selectedIds.length">（{{ selectedIds.length }}）</span></UButton><UButton v-if="canManageUsers" variant="outline" @click="showDevices=!showDevices">设备管理</UButton><UButton v-if="canManageUsers" @click="openCreate">预建任务（可选）</UButton></div></div>
  <div v-if="showDevices&&canManageUsers" class="b-card p-5"><ProductionDeviceManager /></div>
  <div class="b-card p-5 space-y-4">
   <form class="flex flex-wrap items-end gap-3" @submit.prevent="filters.keyword=keyword.trim();refresh()"><label class="min-w-64 flex-1"><span class="block mb-1 text-sm">模糊搜索</span><UInput v-model="keyword" placeholder="任务、产品、生产线、文件、员工姓名或工号" class="w-full" /></label><label><span class="block mb-1 text-sm">操作员</span><USelectMenu v-model="filters.operatorId" :items="operatorOptions" value-key="value" placeholder="全部操作员" :clear="true" :search-input="{placeholder:'姓名或工号'}" /></label><label><span class="block mb-1 text-sm">创建日期从</span><input v-model="filters.dateFrom" type="date" class="rounded border p-2" /></label><label><span class="block mb-1 text-sm">至</span><input v-model="filters.dateTo" type="date" class="rounded border p-2" /></label><UButton type="submit">查询</UButton><UButton variant="outline" @click="resetSearch">重置</UButton><UButton variant="outline" :loading="pending" @click="refresh()">刷新</UButton></form>
   <p class="text-sm text-muted">拖动表头移动整列，拖动列边线调整宽度；支持左右滚动。码数只统计服务器已确认的记录。</p>
   <p v-if="error" class="text-error">查询失败，请重试。</p><p v-else-if="pending&&!data?.rows">正在加载…</p>
   <div class="flex flex-wrap gap-6 py-3"><span v-for="(label,key) in {runningDevices:'运行设备',pausedDevices:'暂停设备',offlineDevices:'离线设备',pendingDevices:'待同步设备',collected:'有效码'}" :key="key">本页{{ label }} <strong class="text-xl">{{ pageStats[key] }}</strong></span></div>
   <ProductionGrid :columns="columns" :rows="taskRows" row-key="id" :storage-key="'production-task-columns:v2:'+user?.id">
    <template #filter-selection><input v-if="canManageUsers" type="checkbox" aria-label="选择当前页可删除任务" :checked="allSelected" :indeterminate="selectedIds.length>0&&!allSelected" :disabled="!removableRows.length||busy" @change="togglePage(($event.target as HTMLInputElement).checked)"></template>
    <template #filter-line_name><USelectMenu v-model="filters.lineName" :items="lineOptions" value-key="value" placeholder="全部生产线" aria-label="按生产线筛选" :clear="true" :search-input="{placeholder:'搜索生产线'}" class="w-full" size="xs" /></template>
    <template #filter-operatorNames><USelectMenu v-model="filters.operatorId" :items="operatorOptions" value-key="value" placeholder="全部操作员" aria-label="按操作员筛选" :clear="true" :search-input="{placeholder:'搜索姓名或工号'}" class="w-full" size="xs" /></template>
    <template #filter-statusLabel><USelect v-model="filters.status" :items="statuses" value-key="value" placeholder="全部状态" aria-label="按状态筛选" class="w-full" size="xs" /></template>
    <template #cell-selection="{row}"><input type="checkbox" :aria-label="'选择任务 '+row.name" :checked="selectedIds.includes(Number(row.id))" :disabled="!row.can_delete||busy" @change="toggleSelected(Number(row.id),($event.target as HTMLInputElement).checked)"></template>
    <template #cell-statusLabel="{row}"><span :class="row.status==='active'?'b-tag-success':'b-tag'">{{ row.statusLabel }}</span></template>
    <template #cell-actions="{row}"><div class="flex gap-2"><UButton size="xs" variant="outline" @click="openDetail(row)">员工详情</UButton><UButton size="xs" variant="outline" @click="openCodes(row)">码明细</UButton><UButton v-if="canManageUsers" size="xs" color="error" variant="outline" :disabled="!row.can_delete||busy" @click="openDelete([row])">删除记录</UButton></div></template>
   </ProductionGrid>
   <div class="flex items-center gap-3"><span class="text-sm text-muted">共 {{ data?.total||0 }} 个任务</span><UButton :disabled="page<=1||pending" variant="outline" @click="page--">上一页</UButton><span>第 {{ page }} 页</span><UButton :disabled="page*20>=(data?.total||0)||pending" variant="outline" @click="page++">下一页</UButton></div>
  </div>
  <UModal v-model:open="showForm" :dismissible="!busy" :close="{ 'aria-label':'关闭' }" :title="editing?'编辑任务与人员':'新建生产任务'" :ui="{content:'max-w-2xl'}"><template #body><form id="line-team-form" class="space-y-4" @submit.prevent="save"><label class="block"><span class="block mb-1">任务名称</span><UInput v-model="form.name" required maxlength="100" class="w-full" /></label><label class="block"><span class="block mb-1">生产线</span><input v-model="form.lineName" list="known-lines" required maxlength="100" placeholder="填写生产线名称" class="rounded border p-2 w-full"><datalist id="known-lines"><option v-for="line in options?.lines||[]" :key="line" :value="line" /></datalist></label><div v-if="!editing&&user?.role === 'platform_admin'"><label class="block mb-1">所属厂家</label><USelect v-model="form.enterpriseId" :items="enterpriseOptions" placeholder="选择厂家" class="w-full" /></div><div><label class="block mb-1">选择工作在这条线的生产操作员</label><USelectMenu v-model="form.operatorIds" :items="workerOptions" multiple value-key="value" :disabled="!selectedEnterprise" :search-input="{placeholder:'搜索姓名或工号'}" placeholder="可选择多名操作员" class="w-full" /><p class="text-sm text-muted mt-1">人员可选；工人在终端选择此生产线后自动登记参与，无需逐台安排设备。</p></div></form></template><template #footer><UButton type="submit" form="line-team-form" :loading="busy" :disabled="!selectedEnterprise">保存任务</UButton><UButton variant="outline" :disabled="busy" @click="showForm=false">取消</UButton></template></UModal>
  <UModal v-model:open="showDetail" :title="(detailTask?.line_name||'')+' · 设备与员工进度'" :ui="{content:'max-w-[95vw]'}"><template #body><ProductionWorkerProgress v-if="detailTask" :key="detailTask.id" :task-id="detailTask.id" /></template></UModal>
  <UModal v-model:open="showDelete" :title="deleteTargets.length===1?'删除生产任务':'批量删除生产任务'" :dismissible="!busy" :close="false"><template #body><p class="mb-3">确认删除以下 {{ deleteTargets.length }} 个任务？</p><ul class="mb-3 max-h-60 overflow-y-auto space-y-2"><li v-for="t in deleteTargets" :key="t.id"><strong>{{ t.name }}</strong> · {{ t.line_name||'-' }}</li></ul><p class="text-sm text-muted">删除后任务不再出现在列表中。追溯码、生产资料、人员和设备扫码历史完整保留；已领用码不会释放或再次分配。</p><p v-if="deleteTargets.length>1" class="mt-2 text-sm text-muted">所有所选任务必须符合删除条件；任一任务不能删除时，整批保持原样。</p></template><template #footer><UButton color="error" :loading="busy" :disabled="busy" @click="removeTasks">确认删除</UButton><UButton variant="outline" :disabled="busy" @click="showDelete=false">取消</UButton></template></UModal>
  <UModal v-model:open="showCodes" :title="(codeTask?.name||'')+' · 码明细'" :close="{ 'aria-label':'关闭' }" :ui="{content:'max-w-5xl'}"><template #body><div class="space-y-3"><div class="flex flex-wrap gap-3"><UInput v-model="codeKeyword" placeholder="追溯码模糊查询" /><select v-model="codeState" class="rounded border p-2"><option value="">全部</option><option value="used">已扫码</option><option value="reserved">未扫描</option></select></div><p v-if="codeBusy">正在加载…</p><div class="overflow-x-auto"><table class="b-table"><thead><tr><th>追溯码</th><th>产品</th><th>批号</th><th>生产日期</th><th>采集情况</th><th>操作员</th><th>设备</th><th>采集时间</th></tr></thead><tbody><tr v-for="c in codeData?.rows||[]" :key="c.code_id"><td class="font-mono">{{ c.code }}</td><td>{{ c.product_name||'-' }}</td><td>{{ c.batch_no||'-' }}</td><td>{{ c.produce_date||'-' }}</td><td>{{ c.state==='used'?'已扫码':'未扫描' }}</td><td>{{ c.operator_name||'-' }}</td><td>{{ c.device||'-' }}</td><td>{{ time(c.used_at) }}</td></tr></tbody></table></div><div class="flex gap-3"><UButton :disabled="codePage<=1" variant="outline" @click="codePage--">上一页</UButton><span>第 {{ codePage }} 页，共 {{ codeData?.filteredTotal||0 }} 个码</span><UButton :disabled="codePage*100>=(codeData?.filteredTotal||0)" variant="outline" @click="codePage++">下一页</UButton></div></div></template></UModal>
 </div>
</template>
<style scoped>input[type=checkbox]{width:18px;height:18px;accent-color:var(--ui-primary)}</style>
