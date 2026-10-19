<script setup lang="ts">
import QRCode from 'qrcode'
const toast=useToast(),{user}=useUser()
const {data,pending,error,refresh}=await useFetch<any>('/api/admin/production-devices')
const {data:options,refresh:refreshOptions}=await useFetch<any>('/api/admin/production-devices/options')
const busy=ref(false),showForm=ref(false),editing=ref<any>(null),qr=ref(''),activation=ref<any>(null),history=ref<any>(null),showHistory=ref(false)
const form=ref({name:'',enterpriseId:String(user.value?.enterprise_id||''),lineName:''})
const lines=computed(()=>[...new Set<string>((options.value?.lines||[]).filter((r:any)=>String(r.enterprise_id)===form.value.enterpriseId).map((r:any)=>r.line_name))])
const labels:Record<string,string>={pending:'待激活',enabled:'启用',disabled:'停用',deleted:'已删除'}
const actions:Record<string,string>={create:'登记',activation:'生成激活码',activated:'设备激活',edit:'编辑',enable:'启用',disable:'停用',delete:'删除'}
const keyword=ref(''),status=ref('all')
const statuses=[{label:'全部状态',value:'all'},...Object.entries(labels).filter(([key])=>key!=='deleted').map(([value,label])=>({label,value}))]
const columns=[{key:'id',label:'设备编号',width:84},{key:'name',label:'设备名称',width:140},{key:'modelLabel',label:'型号',width:160,align:'left' as const},{key:'enterprise_name',label:'所属公司',width:240,flex:1,align:'left' as const},{key:'stateLabel',label:'状态',width:110},{key:'seenAt',label:'最近在线',width:190,align:'left' as const},{key:'syncAt',label:'最近同步',width:190,align:'left' as const},{key:'active_sessions',label:'未结束会话',width:100,minWidth:72,align:'right' as const},{key:'pendingLabel',label:'待同步记录',width:100,minWidth:72,align:'right' as const},{key:'actions',label:'操作',width:420}]
const time=(value:any)=>value?String(value).replace('T',' ').slice(0,19):'-'
const rows=computed(()=>(data.value?.rows||[]).filter((r:any)=>(status.value==='all'||r.status===status.value)&&(!keyword.value.trim()||[r.id,r.name,r.model,r.enterprise_name].some(value=>String(value||'').toLowerCase().includes(keyword.value.trim().toLowerCase())))).map((r:any)=>({...r,modelLabel:r.model||'尚未激活',stateLabel:labels[r.status],seenAt:time(r.last_seen_at),syncAt:time(r.last_sync_at),pendingLabel:r.reported_pending===null?'未上报':r.reported_pending})))
let timer:ReturnType<typeof setInterval>|undefined
function startRefresh(){clearInterval(timer);timer=setInterval(()=>{if(document.visibilityState==='visible'&&!busy.value&&!showForm.value&&!activation.value)void refresh()},15000)}
onMounted(startRefresh)
onActivated(startRefresh)
onDeactivated(()=>clearInterval(timer))
onBeforeUnmount(()=>clearInterval(timer))
const msg=(e:any)=>e?.data?.statusMessage||'操作尚未确认，请刷新后重试'
function edit(row?:any){editing.value=row||null;form.value={name:row?.name||'',enterpriseId:String(row?.enterprise_id||user.value?.enterprise_id||''),lineName:row?.line_name||''};showForm.value=true;void refreshOptions()}
async function displayActivation(result:any){activation.value=null;qr.value=await QRCode.toDataURL(result.activationCode,{width:320,errorCorrectionLevel:'M',margin:3});activation.value={...result,expiresAt:Date.now()+result.expiresIn*1000}}
async function save(){busy.value=true;try{const body={...form.value,enterpriseId:Number(form.value.enterpriseId)};const result=editing.value?await $fetch<any>('/api/admin/production-devices/'+editing.value.id,{method:'PATCH',body:{...body,action:'edit'}}):await $fetch<any>('/api/admin/production-devices',{method:'POST',body});showForm.value=false;await refresh();await refreshOptions();if(result.activationCode)await displayActivation(result);else toast.add({title:'设备信息已保存',color:'success'})}catch(e){toast.add({title:msg(e),color:'error'})}finally{busy.value=false}}
async function action(row:any,action:string){
  if(['delete','disable','activate'].includes(action)&&!window.confirm(action==='delete'?'删除此设备？历史采集记录保留，设备凭证将撤销。':action==='disable'?'停用此设备？云端停止接受新的生产绑定，本机记录保留。':'重新生成激活码？旧凭证和旧激活码将失效，原设备须重新扫码激活。'))return
  busy.value=true;try{const result=await $fetch<any>('/api/admin/production-devices/'+row.id,{method:'PATCH',body:{action}});await refresh();if(result.activationCode)await displayActivation(result);else toast.add({title:'设备已'+(actions[action]||'更新'),color:'success'})}catch(e){toast.add({title:msg(e),color:'error'})}finally{busy.value=false}
}
async function loadHistory(row:any){try{history.value={name:row.name,...await $fetch<any>('/api/admin/production-devices/'+row.id+'/history')};showHistory.value=true}catch(e){toast.add({title:msg(e),color:'error'})}}
</script>
<template>
  <section class="device-manager">
    <div class="flex flex-wrap items-center justify-between gap-3"><div><h1 class="b-page-title">扫描仪管理</h1><p class="b-page-desc">登记扫描仪与所属公司，生产线由工人在终端选择。</p></div><div class="flex gap-2"><UButton variant="outline" :loading="pending" @click="refresh()">刷新</UButton><UButton :disabled="busy" @click="edit()">添加设备</UButton></div></div>
    <div class="b-card device-panel">
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="refresh()"><label class="flex-1 min-w-64"><span class="block mb-1 text-sm">模糊搜索</span><UInput v-model="keyword" placeholder="设备编号、名称、型号或公司" class="w-full" /></label><UButton type="submit" :loading="pending">查询</UButton><UButton variant="outline" @click="keyword='';status='all'">重置</UButton></form>
      <p v-if="error" class="text-error">设备列表加载失败，请刷新。</p>
      <ProductionGrid production-style class="device-table" fill-height :columns="columns" :rows="rows" row-key="id" :storage-key="'production-device-columns:v1:'+user?.id">
        <template #filter-stateLabel><USelect v-model="status" :items="statuses" placeholder="全部状态" aria-label="按设备状态筛选" class="w-full" size="xs" /></template>
        <template #cell-stateLabel="{row}"><span :class="row.status==='enabled'?'b-tag-success':'b-tag'">{{ row.stateLabel }}</span></template>
        <template #cell-actions="{row:r}"><div class="flex gap-2"><UButton size="xs" variant="outline" :disabled="busy" @click="edit(r)">编辑</UButton><UButton size="xs" variant="outline" :disabled="busy" @click="action(r,'activate')">{{ r.status==='pending'?'激活二维码':'重新激活' }}</UButton><UButton v-if="r.status==='enabled'||r.status==='pending'" size="xs" variant="outline" :disabled="busy" @click="action(r,'disable')">停用</UButton><UButton v-if="r.status==='disabled'" size="xs" variant="outline" :disabled="busy" @click="action(r,'enable')">启用</UButton><UButton size="xs" variant="outline" @click="loadHistory(r)">记录</UButton><UButton size="xs" color="error" variant="outline" :disabled="busy" @click="action(r,'delete')">删除</UButton></div></template>
      </ProductionGrid>
      <p class="text-sm text-muted">共 {{ rows.length }} 台扫描仪。待同步数量来自设备最近上报；未结束采集时不能删除或重新激活。</p>
    </div>
    <UModal v-model:open="showForm" :title="editing?'编辑设备':'添加设备'"><template #body><form id="device-form" class="space-y-4" @submit.prevent="save"><fieldset :disabled="busy" class="space-y-4"><label class="block">设备名称<input v-model="form.name" required maxlength="100" placeholder="例如：扫描仪001" class="mt-1 w-full rounded border p-2"></label><label v-if="user?.role==='platform_admin'" class="block">所属公司<select v-model="form.enterpriseId" required class="mt-1 w-full rounded border p-2" @change="form.lineName=''"><option value="">请选择已入驻公司</option><option v-for="e in options?.enterprises||[]" :key="e.id" :value="String(e.id)">{{ e.name }}</option></select></label><p class="text-sm text-muted">添加后用扫描仪扫描激活二维码，无需手动输入设备号。调换公司后需要重新激活。</p></fieldset></form></template><template #footer><UButton type="submit" form="device-form" :loading="busy">{{ editing?'保存':'登记并生成激活二维码' }}</UButton><UButton variant="outline" :disabled="busy" @click="showForm=false">取消</UButton></template></UModal>
    <UModal :open="!!activation" title="扫描仪扫码激活" @update:open="v=>{if(!v)activation=null}"><template #body><div class="text-center space-y-3"><img :src="qr" alt="一次性设备激活二维码" class="mx-auto h-80 w-80"><p>打开 APK 的“扫码激活设备”，用扫描头扫描此二维码。</p><p class="text-sm text-muted">有效期5分钟，只能激活一台设备。过期后重新生成。</p></div></template></UModal>
    <UModal v-model:open="showHistory" :title="(history?.name||'设备')+' · 管理记录'"><template #body><ul class="space-y-4"><li v-for="r in history?.rows||[]" :key="r.id"><b>{{ actions[r.action]||r.action }}</b> · {{ r.actor_name||'设备本人' }}<p class="text-sm text-muted">{{ r.created_at }}</p><p v-if="r.action==='edit'" class="text-sm">{{ r.detail?.before?.name }} / {{ r.detail?.before?.lineName }} → {{ r.detail?.after?.name }} / {{ r.detail?.after?.lineName }}</p></li></ul></template></UModal>
  </section>
</template>
<style scoped>
.device-manager{display:flex;flex-direction:column;flex:1;min-height:0;gap:12px;font-size:14px}.device-manager>.device-panel{display:flex;flex-direction:column;flex:1;min-height:340px;padding:12px;gap:12px}.device-panel>.device-table{flex:1;min-height:0}
</style>
