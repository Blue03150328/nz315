<script setup lang="ts">
const props=defineProps<{taskId:number}>(),{user}=useUser()
const userId=ref(0),page=ref(1),state=ref(''),keyword=ref('')
const {data,pending,error,refresh}=await useFetch<any>(()=>`/api/admin/production-tasks/${props.taskId}/worker-progress`,{query:{userId,page,state}})
watch([userId,state],()=>{page.value=1})
const obj=(v:any)=>typeof v==='string'?JSON.parse(v):v||{}
const clock=(v:any)=>v?new Date(Number(v)).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false}):'-'
const labels:Record<string,string>={saved:'已生产',duplicate:'重复',exception:'异常'}
const columns=[{key:'device_name',label:'设备',width:110},{key:'operatorLabel',label:'操作员',width:160},{key:'product_name',label:'产品',width:240,flex:2,align:'left' as const},{key:'trademark',label:'商标',width:130},{key:'content',label:'成分含量',width:140,align:'left' as const},{key:'dosage',label:'剂型',width:120},{key:'spec_name',label:'规格',width:120,align:'left' as const},{key:'registration_no',label:'登记证号',width:150,align:'left' as const},{key:'batchNo',label:'生产批号',width:150,align:'left' as const},{key:'produceDate',label:'生产日期',width:130,align:'left' as const},{key:'expireDate',label:'有效期至',width:130,align:'left' as const},{key:'cloud_valid',label:'有效码合计',width:100,minWidth:72,align:'right' as const},{key:'internal_count',label:'内部码',width:76,minWidth:72,align:'right' as const},{key:'external_count',label:'外部码',width:76,minWidth:72,align:'right' as const},{key:'cloud_duplicate',label:'重复码',width:76,minWidth:72,align:'right' as const},{key:'cloud_exception',label:'异常码',width:76,minWidth:72,align:'right' as const},{key:'started',label:'开始时间',width:190,align:'left' as const},{key:'stopped',label:'停止时间',width:190,align:'left' as const},{key:'liveState',label:'采集状态',width:160},{key:'lastSeen',label:'最近上报',width:190,align:'left' as const},{key:'actions',label:'操作',width:130}]
const records=computed(()=>(data.value?.sessions||[]).map((s:any)=>{const identity=obj(s.identity_json),context=obj(s.context_json);return {...s,username:identity.username,worker_name:identity.name,operatorLabel:`${identity.name||'-'}（${identity.username||'-'}）`,...context,started:clock(s.started_ms),stopped:clock(s.stopped_ms),lastSeen:clock(s.heartbeat_ms),local_pending:s.state==='completed'?0:s.local_pending??'未上报',liveState:s.run_state==='sealed'&&s.state==='completed'?'已结束':s.state==='completed'?'待结束同步':!s.heartbeat_ms||Date.now()-Number(s.heartbeat_ms)>=90000?'离线／状态未知':s.capture_state==='running'?'采集中':s.capture_state==='paused'?'已暂停':'已结束待同步'}}).filter((r:any)=>(!userId.value||Number(r.user_id)===userId.value)&&(!keyword.value||[r.worker_name,r.username,r.device_name,r.product_name,r.trademark,r.batchNo].some(v=>String(v||'').includes(keyword.value.trim())))))
const events=computed(()=>(data.value?.events||[]).map((e:any)=>({...e,sourceLabel:sourceLabel(e.classification),result:labels[e.result_state],captureTime:new Date(String(e.captured_at).replace(' ','T')+'Z').toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false})})))
const sourceLabel=(v:any)=>v==='internal'?'内部码':v==='external'?'外部码':v==='unparsed'?'无法识别':'历史内部码'
const eventColumns=[{key:'sourceLabel',label:'标签来源',width:130},{key:'code',label:'追溯码',width:300,align:'left' as const},{key:'raw_code',label:'扫码原文',width:500,align:'left' as const},{key:'result',label:'结果',width:120},{key:'reason',label:'原因',width:400,align:'left' as const},{key:'worker_name',label:'员工姓名',width:130},{key:'device_name',label:'设备',width:110},{key:'captureTime',label:'采集时间',width:200,align:'left' as const},{key:'received_at',label:'上传时间',width:200,align:'left' as const}]
let timer:ReturnType<typeof setInterval>|undefined
function startRefresh(){clearInterval(timer);timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh()},10000)}
onMounted(startRefresh)
onActivated(startRefresh)
onDeactivated(()=>{clearInterval(timer);timer=undefined})
onBeforeUnmount(()=>clearInterval(timer))
</script>
<template><div class="space-y-4">
 <div class="flex flex-wrap items-center gap-3 justify-between"><h3 class="font-semibold">员工扫码情况 · {{ data?.task?.lineName }}</h3><UButton variant="outline" :loading="pending" @click="refresh()">刷新</UButton></div>
 <div class="flex gap-3"><UInput v-model="keyword" placeholder="查询工号、姓名、设备、产品或批号" class="min-w-80"/><UButton v-if="userId" variant="outline" @click="userId=0">全部员工</UButton></div>
 <p class="text-sm text-muted">一行对应一名工人的一次采集，码数只统计服务器已确认的记录。</p>
 <p v-if="error" class="text-error">加载失败，请重试。</p>
 <ProductionGrid production-style :columns="columns" :rows="records" row-key="session_id" :storage-key="'production-worker-columns:v3:'+user?.id"><template #cell-actions="{row}"><UButton variant="outline" size="xs" @click="userId=Number(row.user_id)">扫码详情</UButton></template></ProductionGrid>
 <p v-if="data?.legacyRecords" class="text-sm text-muted">另有 {{ data.legacyRecords }} 条历史设备记录未记录个人工号，原记录保留。</p>
 <template v-if="userId"><div class="flex gap-3 items-center"><h4>员工扫码详情</h4><select v-model="state" class="rounded border p-2"><option value="">全部结果</option><option v-for="(label,key) in labels" :key="key" :value="key">{{ label }}</option></select></div><ProductionGrid production-style :columns="eventColumns" :rows="events" row-key="id" :storage-key="'production-event-columns:'+user?.id"/><div class="flex gap-3"><UButton :disabled="page<=1||pending" variant="outline" @click="page--">上一页</UButton><span>第 {{ page }} 页，共 {{ data?.total||0 }} 条</span><UButton :disabled="page*100>=(data?.total||0)||pending" variant="outline" @click="page++">下一页</UButton></div></template>
</div></template>
