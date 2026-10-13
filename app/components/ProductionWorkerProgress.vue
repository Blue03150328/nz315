<script setup lang="ts">
const props=defineProps<{taskId:number}>()
const {canManageUsers}=useUser(),toast=useToast()
async function resolve(event:any,action:string){const reason=prompt(action==='bind'?'确认此件已投产，按当前任务生产资料绑定。请填写核对依据：':'确认此件未投入生产，可以作为余码审核。请填写核对依据：');if(!reason?.trim())return;try{await $fetch(`/api/admin/production-tasks/${props.taskId}/worker-exceptions`,{method:'POST',body:{eventId:event.id,action,reason}});await refresh()}catch(e:any){toast.add({title:e?.data?.statusMessage||'核对未确认，请重试',color:'error'})}}
const userId=ref(0),page=ref(1),state=ref('')
const {data,pending,error,refresh}=await useFetch<any>(()=>`/api/admin/production-tasks/${props.taskId}/worker-progress`,{query:{userId,page,state}})
watch([userId,state],()=>{page.value=1})
const clock=(ms:any,fallback:any)=>ms?new Date(Number(ms)).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false}):(fallback||'-')
const captureTime=(v:any)=>v?new Date(String(v).replace(' ','T')+'Z').toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false}):'-'
const labels:Record<string,string>={saved:'已生产',duplicate:'重复',exception:'异常'}
</script>
<template>
 <div class="space-y-4">
  <div class="flex justify-between"><h3 class="font-semibold">员工进度 · {{ data?.task?.lineName }}</h3><UButton variant="outline" :loading="pending" @click="refresh()">刷新</UButton></div>
  <p class="text-sm text-muted">显示服务器已收到的记录；离线记录自动上传或TXT导入后补齐。员工可以更换设备和生产线。</p>
  <p v-if="error" class="text-error">加载失败，请重试。</p><p v-else-if="!data?.rows?.length">暂无带工人身份的采集记录。</p>
  <div class="overflow-x-auto"><table class="b-table"><thead><tr><th>员工 / 工号</th><th>有效生产</th><th>重复</th><th>异常</th><th>设备数量</th><th>最后上传 / 状态</th><th>操作</th></tr></thead><tbody><tr v-for="r in data?.rows||[]" :key="r.user_id"><td>{{ r.name }} / {{ r.username }}</td><td>{{ r.collected }}</td><td>{{ r.duplicates }}</td><td>{{ r.exceptions }}</td><td>{{ r.devices }}</td><td>{{ clock(r.last_uploaded_ms,r.last_uploaded) }}<br>{{ r.active_sessions ? '采集或待结束同步' : '本机采集已结束' }}</td><td><UButton variant="outline" size="sm" @click="userId=Number(r.user_id)">查看详情</UButton></td></tr></tbody></table></div>
  <p v-if="data?.legacyRecords" class="text-sm text-muted">另有 {{ data.legacyRecords }} 条历史设备记录，未记录真实工人身份，保留在原设备采集明细中。</p>
  <template v-if="userId"><div class="flex flex-wrap items-center gap-3"><h4>员工扫码详情</h4><select v-model="state" class="rounded border p-2"><option value="">全部</option><option v-for="(label,key) in labels" :key="key" :value="key">{{ label }}</option></select><UButton variant="outline" @click="userId=0">收起详情</UButton></div>
   <div class="overflow-x-auto"><table class="b-table"><thead><tr><th>追溯码 / 原文</th><th>结果 / 原因</th><th>员工 / 设备</th><th>采集 / 上传时间</th><th>异常核对</th></tr></thead><tbody><tr v-for="e in data?.events||[]" :key="e.id"><td class="max-w-md break-all">{{ e.code||'-' }}<br>{{ e.raw_code }}</td><td>{{ labels[e.result_state] }}<br>{{ e.reason||'-' }}</td><td>{{ e.worker_name }} / {{ e.device_name }}</td><td>{{ captureTime(e.captured_at) }}<br>{{ e.received_at }}</td><td><span v-if="e.resolution_state">{{ e.resolution_state==='unused'?'确认未投产':e.resolution_state==='bound'?'核对后已绑定':'核对为重复' }}：{{ e.resolution_reason }}</span><div v-else-if="canManageUsers&&e.result_state==='exception'"><UButton v-if="e.code" size="sm" variant="outline" @click="resolve(e,'bind')">确认已投产</UButton><UButton size="sm" color="warning" variant="outline" @click="resolve(e,'unused')">确认未投产</UButton></div><span v-else>-</span></td></tr></tbody></table></div>
   <div class="flex gap-3"><UButton :disabled="page<=1||pending" variant="outline" @click="page--">上一页</UButton><span>第 {{ page }} 页，共 {{ data?.total||0 }} 条</span><UButton :disabled="page*100>=(data?.total||0)||pending" variant="outline" @click="page++">下一页</UButton></div>
  </template>
 </div>
</template>
