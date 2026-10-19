<script setup lang="ts">
definePageMeta({layout:'admin',middleware:'backend-guard',keepalive:true})
useHead({title:'生产管理 · 生产线管理'})
const {user,canManageUsers,isPlatformAdmin}=useUser(),toast=useToast()
const page=ref(1),keyword=ref(''),filters=reactive({keyword:'',enterpriseId:'',lineName:'',supervisorName:'',status:''})
const {data,pending,error,refresh}=await useFetch<any>('/api/admin/production-line-management',{query:computed(()=>({...filters,page:page.value}))})
const {data:options,refresh:refreshOptions}=await useFetch<any>('/api/admin/production-line-management/options')
watch(keyword,(v,_,cleanup)=>{const timer=setTimeout(()=>{filters.keyword=v.trim()},300);cleanup(()=>clearTimeout(timer))})
watch(()=>JSON.stringify(filters),()=>{page.value=1})
const enterprises=computed(()=>(options.value?.enterprises||[]).map((e:any)=>({label:e.name,value:String(e.id)})))
watch(()=>filters.enterpriseId,()=>{filters.lineName='';filters.supervisorName='';page.value=1})
const lineOptions=computed(()=>(data.value?.lines||[]).map((name:string)=>({label:name,value:name})))
const supervisors=computed(()=>[...new Set<string>((options.value?.supervisors||[]).filter((p:any)=>!filters.enterpriseId||Number(p.enterprise_id)===Number(filters.enterpriseId)).map((p:any)=>p.name))].map(name=>({label:name,value:name})))
const statusLabels:Record<string,string>={running:'运行中',paused:'已暂停',offline:'设备离线',pending:'待同步',idle:'空闲'}
const statuses=[{label:'全部状态',value:'all'},...Object.entries(statusLabels).map(([value,label])=>({label,value}))]
const columns=computed(()=>[...(canManageUsers.value?[{key:'selection',label:'选择',width:56,minWidth:56,align:'center' as const}]:[]),...(isPlatformAdmin.value?[{key:'enterprise_name',label:'所属企业',width:240,flex:1,align:'left' as const}]:[]),{key:'line_name',label:'生产线',width:124},{key:'supervisor_name',label:'厂长（负责人）',width:160},{key:'statusLabel',label:'运行状态',width:116},{key:'runningDevices',label:'运行设备',width:88,minWidth:72,align:'right' as const},{key:'pausedDevices',label:'暂停设备',width:88,minWidth:72,align:'right' as const},{key:'offlineDevices',label:'离线设备',width:88,minWidth:72,align:'right' as const},{key:'pendingDevices',label:'待同步设备',width:100,minWidth:72,align:'right' as const},{key:'products',label:'当前产品',width:240,flex:2,align:'left' as const},{key:'activeTaskCount',label:'进行中任务',width:100,minWidth:72,align:'right' as const},{key:'collected',label:'有效码合计',width:100,minWidth:72,align:'right' as const},{key:'duplicates',label:'重复码',width:76,minWidth:72,align:'right' as const},{key:'exceptions',label:'异常码',width:76,minWidth:72,align:'right' as const},{key:'lastSeen',label:'最近上报',width:190,align:'left' as const},{key:'actions',label:'操作',width:242}])
const rows=computed(()=>(data.value?.rows||[]).map((r:any)=>({...r,supervisor_name:r.supervisor_name||'-',statusLabel:statusLabels[r.status],lastSeen:r.latestHeartbeat?new Date(Number(r.latestHeartbeat)).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false}):'-'})))
const editing=ref<any>(null),showForm=ref(false),busy=ref(false)
const selectedIds=ref<string[]>([]),showDelete=ref(false),deleteTargets=ref<any[]>([])
const selectedDraftCount=computed(()=>deleteTargets.value.reduce((n,r)=>n+Number(r.draftTaskCount||0),0))
const selectableRows=computed(()=>rows.value.filter((r:any)=>r.can_delete))
const allSelected=computed(()=>selectableRows.value.length>0&&selectableRows.value.every((r:any)=>selectedIds.value.includes(r.id)))
function toggleRow(id:string,checked:boolean){selectedIds.value=checked?[...new Set([...selectedIds.value,id])]:selectedIds.value.filter(v=>v!==id)}
function togglePage(checked:boolean){selectedIds.value=checked?selectableRows.value.map((r:any)=>r.id):[]}
watch(()=>JSON.stringify({...filters,page:page.value}),()=>{selectedIds.value=[]})
watch(rows,()=>{const valid=new Set(selectableRows.value.map((r:any)=>r.id));selectedIds.value=selectedIds.value.filter(id=>valid.has(id))})
function openDelete(targets:any[]){if(busy.value||!targets.length)return;deleteTargets.value=targets.map(r=>({...r}));showDelete.value=true}
function openBulkDelete(){openDelete(rows.value.filter((r:any)=>selectedIds.value.includes(r.id)))}
async function removeLines(){if(busy.value||!deleteTargets.value.length)return;busy.value=true;try{
 const result=await $fetch<any>('/api/admin/production-line-management',{method:'DELETE',body:{lines:deleteTargets.value.map(r=>({enterpriseId:Number(r.enterprise_id),lineKey:r.line_key}))}})
 showDelete.value=false;selectedIds.value=[];await Promise.all([refresh(),refreshOptions()]);if(page.value>1&&!data.value?.rows?.length){page.value=Math.max(1,Math.ceil(Number(data.value?.total||0)/20))}
 toast.add({title:result.deletedCount?`已删除 ${result.deletedCount} 条生产线，历史资料保留`:'生产线已删除，历史资料保留',color:'success'})
}catch(e:any){toast.add({title:e?.data?.statusMessage||'删除未确认，请刷新后重试',color:'error'})}finally{busy.value=false}}
const form=ref({enterpriseId:String(user.value?.enterprise_id||''),lineName:'',supervisorName:''})
const selectableEnterprises=computed(()=>(options.value?.enterprises||[]).filter((e:any)=>Number(e.status)===1).map((e:any)=>({label:e.name,value:String(e.id)})))
const knownSupervisors=computed(()=>[...new Set<string>((options.value?.supervisors||[]).filter((p:any)=>Number(p.enterprise_id)===Number(form.value.enterpriseId)).map((p:any)=>p.name))])
function openCreate(){editing.value=null;form.value={enterpriseId:String(user.value?.enterprise_id||''),lineName:'',supervisorName:''};showForm.value=true;void refreshOptions()}
function openEdit(row:any){editing.value=row;form.value={enterpriseId:String(row.enterprise_id),lineName:row.line_name,supervisorName:row.supervisor_name==='-'?'':row.supervisor_name};showForm.value=true;void refreshOptions()}
async function save(){if(busy.value)return;busy.value=true;try{
 await $fetch('/api/admin/production-line-management',{method:editing.value?'PATCH':'POST',body:{enterpriseId:Number(form.value.enterpriseId),lineName:form.value.lineName,supervisorName:form.value.supervisorName,...(editing.value?{lineKey:editing.value.line_key}:{})}})
 showForm.value=false;await Promise.all([refresh(),refreshOptions()]);toast.add({title:'生产线已保存',color:'success'})
}catch(e:any){toast.add({title:e?.data?.statusMessage||'保存未确认，请刷新后重试',color:'error'})}finally{busy.value=false}}
function reset(){keyword.value='';Object.assign(filters,{keyword:'',enterpriseId:'',lineName:'',supervisorName:'',status:''});page.value=1}
let timer:ReturnType<typeof setInterval>|undefined
function start(){clearInterval(timer);timer=setInterval(()=>{if(document.visibilityState==='visible'&&!showForm.value&&!showDelete.value)void refresh()},10000)}
onMounted(start);onActivated(start);onDeactivated(()=>clearInterval(timer));onBeforeUnmount(()=>clearInterval(timer))
</script>
<template><div class="production-page">
 <ProductionManagementTabs />
 <div class="flex flex-wrap justify-between items-center gap-3"><div><h1 class="b-page-title">生产线管理</h1><p class="b-page-desc">一行查看一条生产线的总情况，设备状态每10秒自动刷新。</p></div><div class="flex gap-2"><UButton v-if="canManageUsers" color="error" variant="outline" :disabled="!selectedIds.length||busy" @click="openBulkDelete">批量删除<span v-if="selectedIds.length">（{{ selectedIds.length }}）</span></UButton><UButton v-if="canManageUsers" @click="openCreate">添加生产线</UButton></div></div>
 <div class="b-card production-panel">
  <form class="flex flex-wrap items-end gap-3" @submit.prevent="filters.keyword=keyword.trim();refresh()"><label class="min-w-64 flex-1"><span class="block mb-1 text-sm">模糊搜索</span><UInput v-model="keyword" placeholder="生产线、负责人或当前产品" class="w-full" /></label><label v-if="isPlatformAdmin" class="w-60"><span class="block mb-1 text-sm">所属企业</span><USelectMenu v-model="filters.enterpriseId" :items="enterprises" value-key="value" :clear="true" placeholder="全部企业" aria-label="按企业筛选生产线" :search-input="{placeholder:'搜索企业名称'}" class="w-full" /></label><UButton type="submit">查询</UButton><UButton variant="outline" @click="reset">重置</UButton><UButton variant="outline" :loading="pending" @click="refresh()">刷新</UButton></form>
  <div class="flex flex-wrap gap-6 py-3"><span v-for="(label,key) in {runningDevices:'运行设备',pausedDevices:'暂停设备',offlineDevices:'离线设备',pendingDevices:'待同步设备'}" :key="key">{{ label }} <strong class="text-xl">{{ data?.summary?.[key]||0 }}</strong></span></div>
  <p v-if="error" class="text-error">查询失败，请重试。</p>
  <ProductionGrid production-style class="production-table" fill-height :layout-version="isPlatformAdmin?3:undefined" :leading-columns="['selection','enterprise_name']" :columns="columns" :rows="rows" row-key="id" :storage-key="'production-line-columns:v2:'+user?.id">
   <template #filter-selection><input type="checkbox" aria-label="选择当前页可删除生产线" :checked="allSelected" :indeterminate="selectedIds.length>0&&!allSelected" :disabled="!selectableRows.length||busy" @change="togglePage(($event.target as HTMLInputElement).checked)"></template>
   <template #cell-selection="{row}"><input type="checkbox" :aria-label="'选择生产线 '+row.line_name" :checked="selectedIds.includes(row.id)" :disabled="!row.can_delete||busy" :title="row.can_delete?'选择此生产线':'有未结束任务，结束采集并完整上传后才能删除'" @change="toggleRow(row.id,($event.target as HTMLInputElement).checked)"></template>
   <template #filter-line_name><USelectMenu v-model="filters.lineName" :items="lineOptions" value-key="value" :clear="true" placeholder="全部生产线" size="xs" class="w-full" /></template>
   <template #filter-supervisor_name><USelectMenu v-model="filters.supervisorName" :items="supervisors" value-key="value" :clear="true" placeholder="全部负责人" size="xs" class="w-full" /></template>
   <template #filter-statusLabel><USelect v-model="filters.status" :items="statuses" placeholder="全部状态" size="xs" class="w-full" /></template>
   <template #cell-statusLabel="{row}"><span :class="row.status==='running'?'b-tag-success':'b-tag'">{{ row.statusLabel }}</span></template>
   <template #cell-actions="{row}"><div class="flex gap-2"><UButton size="xs" variant="outline" :to="{path:'/admin/production-tasks/records',query:{lineName:row.line_name,enterpriseId:row.enterprise_id}}">查看扫码情况</UButton><UButton v-if="canManageUsers" size="xs" variant="outline" @click="openEdit(row)">编辑</UButton><UButton v-if="canManageUsers" size="xs" color="error" variant="outline" :disabled="!row.can_delete||busy" :title="row.can_delete?'删除生产线':'有未结束任务，结束采集并完整上传后才能删除'" @click="openDelete([row])">删除</UButton></div></template>
  </ProductionGrid>
  <AdminHelp title="统计口径"><p>设备按当前未结束采集去重；超过90秒未收到心跳显示离线。码数为本线未删除任务中已确认的采集记录，每10秒刷新。</p></AdminHelp>
  <div class="flex items-center gap-3"><span class="text-sm text-muted">共 {{ data?.total||0 }} 条生产线</span><UButton variant="outline" :disabled="page<=1||pending" @click="page--">上一页</UButton><span>第 {{ page }} 页</span><UButton variant="outline" :disabled="page*20>=(data?.total||0)||pending" @click="page++">下一页</UButton></div>
 </div>
 <UModal v-model:open="showForm" :title="editing?'编辑生产线':'添加生产线'" :dismissible="!busy" :close="{'aria-label':'关闭'}"><template #body><form id="production-line-form" class="space-y-4" @submit.prevent="save">
  <label v-if="user?.role==='platform_admin'" class="block"><span class="block mb-1">所属厂家</span><USelect v-model="form.enterpriseId" :items="selectableEnterprises" :disabled="!!editing" placeholder="选择厂家" class="w-full" /></label>
  <label class="block"><span class="block mb-1">生产线名称<span class="b-required">*</span></span><UInput v-model="form.lineName" required maxlength="100" :disabled="!!editing&&!editing.canRename" placeholder="例如：一号线" class="w-full" /></label>
  <label class="block"><span class="block mb-1">厂长（负责人）</span><input v-model="form.supervisorName" list="production-line-supervisors" maxlength="100" placeholder="输入姓名或选择已有负责人" class="rounded border p-2 w-full"><datalist id="production-line-supervisors"><option v-for="name in knownSupervisors" :key="name" :value="name" /></datalist></label>
  <p class="text-sm text-muted">负责人只作为产线标识，不分配扫码权限。操作员由实际登录和采集自动记录。</p>
  <p v-if="editing&&!editing.canRename" class="text-sm text-muted">已有生产记录的生产线保留原名称，负责人可以修改。</p>
 </form></template><template #footer><UButton type="submit" form="production-line-form" :loading="busy" :disabled="!form.enterpriseId">保存</UButton><UButton variant="outline" :disabled="busy" @click="showForm=false">取消</UButton></template></UModal>
 <UModal v-model:open="showDelete" :title="deleteTargets.length===1?'删除生产线':'批量删除生产线'" :dismissible="!busy" :close="false"><template #body><p class="mb-3">确认删除以下 {{ deleteTargets.length }} 条生产线？</p><ul class="max-h-60 overflow-auto space-y-2 mb-3"><li v-for="row in deleteTargets" :key="row.id"><strong>{{ row.line_name }}</strong> · {{ row.enterprise_name }}</li></ul><p class="text-sm text-muted">删除后不再显示在产线列表和工人可选列表。历史任务、扫码记录、生产资料和码库完整保留；重新添加同名线可恢复档案。</p><p v-if="selectedDraftCount" class="text-sm mt-2">同时移除 {{ selectedDraftCount }} 个从未领码、从未开工的空任务。</p><p v-if="deleteTargets.length>1" class="text-sm text-muted mt-2">任一产线已有生产活动未结束或数据待上传时，整批不删除。</p></template><template #footer><UButton color="error" :loading="busy" :disabled="busy" @click="removeLines">确认删除</UButton><UButton variant="outline" :disabled="busy" @click="showDelete=false">取消</UButton></template></UModal>
</div></template>
<style scoped>input[type=checkbox]{width:18px;height:18px;accent-color:var(--ui-primary)}
.production-page{font-size:14px;display:flex;flex-direction:column;flex:1;min-height:0;gap:12px}.production-page>div{flex-shrink:0}.production-page>.production-panel{display:flex;flex-direction:column;flex:1;min-height:340px;padding:12px;gap:12px}.production-panel>.production-table{flex:1;min-height:0}
</style>
