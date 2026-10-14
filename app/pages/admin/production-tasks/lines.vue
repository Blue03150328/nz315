<script setup lang="ts">
definePageMeta({layout:'admin',middleware:'backend-guard',keepalive:true})
useHead({title:'生产管理 · 生产线管理'})
const {user,canManageUsers}=useUser(),toast=useToast()
const page=ref(1),keyword=ref(''),filters=reactive({keyword:'',enterpriseId:'',lineName:'',supervisorName:'',status:''})
const {data,pending,error,refresh}=await useFetch<any>('/api/admin/production-line-management',{query:computed(()=>({...filters,page:page.value}))})
const {data:options,refresh:refreshOptions}=await useFetch<any>('/api/admin/production-line-management/options')
watch(keyword,(v,_,cleanup)=>{const timer=setTimeout(()=>{filters.keyword=v.trim()},300);cleanup(()=>clearTimeout(timer))})
watch(()=>JSON.stringify(filters),()=>{page.value=1})
const enterprises=computed(()=>(options.value?.enterprises||[]).map((e:any)=>({label:e.name,value:String(e.id)})))
const lineOptions=computed(()=>(data.value?.lines||[]).map((name:string)=>({label:name,value:name})))
const supervisors=computed(()=>[...new Set<string>((options.value?.supervisors||[]).filter((p:any)=>!filters.enterpriseId||Number(p.enterprise_id)===Number(filters.enterpriseId)).map((p:any)=>p.name))].map(name=>({label:name,value:name})))
const statusLabels:Record<string,string>={running:'运行中',paused:'已暂停',offline:'设备离线',pending:'待同步',idle:'空闲'}
const statuses=[{label:'全部状态',value:'all'},...Object.entries(statusLabels).map(([value,label])=>({label,value}))]
const columns=[{key:'enterprise_name',label:'厂家',width:250},{key:'line_name',label:'生产线',width:180},{key:'supervisor_name',label:'厂长（负责人）',width:180},{key:'statusLabel',label:'运行状态',width:140},{key:'runningDevices',label:'运行设备',width:120},{key:'pausedDevices',label:'暂停设备',width:120},{key:'offlineDevices',label:'离线设备',width:120},{key:'pendingDevices',label:'待同步设备',width:130},{key:'products',label:'当前产品',width:300},{key:'activeTaskCount',label:'进行中任务',width:140},{key:'collected',label:'有效码合计',width:130},{key:'duplicates',label:'重复码',width:110},{key:'exceptions',label:'异常码',width:110},{key:'lastSeen',label:'最近上报',width:200},{key:'actions',label:'操作',width:230}]
const rows=computed(()=>(data.value?.rows||[]).map((r:any)=>({...r,supervisor_name:r.supervisor_name||'-',statusLabel:statusLabels[r.status],lastSeen:r.latestHeartbeat?new Date(Number(r.latestHeartbeat)).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false}):'-'})))
const editing=ref<any>(null),showForm=ref(false),busy=ref(false),showDevices=ref(false)
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
function start(){clearInterval(timer);timer=setInterval(()=>{if(document.visibilityState==='visible'&&!showForm.value)void refresh()},10000)}
onMounted(start);onActivated(start);onDeactivated(()=>clearInterval(timer));onBeforeUnmount(()=>clearInterval(timer))
</script>
<template><div class="space-y-4">
 <ProductionManagementTabs />
 <div class="flex flex-wrap justify-between items-center gap-3"><div><h1 class="b-page-title">生产线管理</h1><p class="b-page-desc">一行查看一条生产线的总情况，设备状态每10秒自动刷新。</p></div><div class="flex gap-2"><UButton v-if="canManageUsers" variant="outline" @click="showDevices=!showDevices">扫描仪管理</UButton><UButton v-if="canManageUsers" @click="openCreate">添加生产线</UButton></div></div>
 <div v-if="showDevices&&canManageUsers" class="b-card p-5"><ProductionDeviceManager /></div>
 <div class="b-card p-5 space-y-4">
  <form class="flex flex-wrap items-end gap-3" @submit.prevent="filters.keyword=keyword.trim();refresh()"><label class="min-w-64 flex-1"><span class="block mb-1 text-sm">模糊搜索</span><UInput v-model="keyword" placeholder="厂家、生产线、负责人或当前产品" class="w-full" /></label><UButton type="submit">查询</UButton><UButton variant="outline" @click="reset">重置</UButton><UButton variant="outline" :loading="pending" @click="refresh()">刷新</UButton></form>
  <div class="flex flex-wrap gap-6 py-3"><span v-for="(label,key) in {runningDevices:'运行设备',pausedDevices:'暂停设备',offlineDevices:'离线设备',pendingDevices:'待同步设备'}" :key="key">{{ label }} <strong class="text-xl">{{ data?.summary?.[key]||0 }}</strong></span></div>
  <p v-if="error" class="text-error">查询失败，请重试。</p>
  <ProductionGrid :columns="columns" :rows="rows" row-key="id" :storage-key="'production-line-columns:v1:'+user?.id">
   <template #filter-enterprise_name><USelectMenu v-if="user?.role==='platform_admin'" v-model="filters.enterpriseId" :items="enterprises" value-key="value" :clear="true" placeholder="全部厂家" size="xs" class="w-full" /></template>
   <template #filter-line_name><USelectMenu v-model="filters.lineName" :items="lineOptions" value-key="value" :clear="true" placeholder="全部生产线" size="xs" class="w-full" /></template>
   <template #filter-supervisor_name><USelectMenu v-model="filters.supervisorName" :items="supervisors" value-key="value" :clear="true" placeholder="全部负责人" size="xs" class="w-full" /></template>
   <template #filter-statusLabel><USelect v-model="filters.status" :items="statuses" placeholder="全部状态" size="xs" class="w-full" /></template>
   <template #cell-statusLabel="{row}"><span :class="row.status==='running'?'b-tag-success':'b-tag'">{{ row.statusLabel }}</span></template>
   <template #cell-actions="{row}"><div class="flex gap-2"><UButton size="xs" variant="outline" :to="{path:'/admin/production-tasks/records',query:{lineName:row.line_name,enterpriseId:row.enterprise_id}}">查看扫码情况</UButton><UButton v-if="canManageUsers" size="xs" variant="outline" @click="openEdit(row)">编辑</UButton></div></template>
  </ProductionGrid>
  <p class="text-sm text-muted">设备按当前未结束采集去重；超过90秒未收到心跳显示离线。码数汇总本线未删除任务已确认的采集记录。</p>
  <div class="flex items-center gap-3"><span class="text-sm text-muted">共 {{ data?.total||0 }} 条生产线</span><UButton variant="outline" :disabled="page<=1||pending" @click="page--">上一页</UButton><span>第 {{ page }} 页</span><UButton variant="outline" :disabled="page*20>=(data?.total||0)||pending" @click="page++">下一页</UButton></div>
 </div>
 <UModal v-model:open="showForm" :title="editing?'编辑生产线':'添加生产线'" :dismissible="!busy" :close="{'aria-label':'关闭'}"><template #body><form id="production-line-form" class="space-y-4" @submit.prevent="save">
  <label v-if="user?.role==='platform_admin'" class="block"><span class="block mb-1">所属厂家</span><USelect v-model="form.enterpriseId" :items="selectableEnterprises" :disabled="!!editing" placeholder="选择厂家" class="w-full" /></label>
  <label class="block"><span class="block mb-1">生产线名称<span class="b-required">*</span></span><UInput v-model="form.lineName" required maxlength="100" :disabled="!!editing&&!editing.canRename" placeholder="例如：一号线" class="w-full" /></label>
  <label class="block"><span class="block mb-1">厂长（负责人）</span><input v-model="form.supervisorName" list="production-line-supervisors" maxlength="100" placeholder="输入姓名或选择已有负责人" class="rounded border p-2 w-full"><datalist id="production-line-supervisors"><option v-for="name in knownSupervisors" :key="name" :value="name" /></datalist></label>
  <p class="text-sm text-muted">负责人只作为产线标识，不分配扫码权限。操作员由实际登录和采集自动记录。</p>
  <p v-if="editing&&!editing.canRename" class="text-sm text-muted">已有生产记录的生产线保留原名称，负责人可以修改。</p>
 </form></template><template #footer><UButton type="submit" form="production-line-form" :loading="busy" :disabled="!form.enterpriseId">保存</UButton><UButton variant="outline" :disabled="busy" @click="showForm=false">取消</UButton></template></UModal>
</div></template>
