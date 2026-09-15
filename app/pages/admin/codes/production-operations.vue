<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '生产更正记录与审批' })
const { isPlatformAdmin } = useUser()
const toast = useToast()
const page = ref(1)
const { data, refresh } = await useFetch<any>('/api/admin/production-operations', { query: computed(() => ({ page: page.value })) })
const selected = ref<any>(null)
const rejection = ref('')
const busy = ref(false)
const labels: Record<string, string> = { pending: '待审批', applied: '已执行', rejected: '已驳回' }
const fieldLabels: Record<string, string> = { produceDate: '生产日期', expireDate: '有效期至', qualityCertNo: '质量合格证号', qcResult: '质检结果' }
const format = (field: string, value: any) => value == null || value === '' ? '未填写' : field === 'qcResult' ? (Number(value) === 1 ? '合格' : '不合格') : value
async function select(row: any) {
  try { selected.value = await $fetch('/api/admin/production-operations/' + row.id); rejection.value = '' }
  catch (e: any) { toast.add({ title: e?.data?.statusMessage || '读取记录失败', color: 'error' }) }
}
async function review(action: string) {
  busy.value = true
  try {
    await $fetch('/api/admin/production-operations/' + selected.value.id + '/review', { method: 'POST', body: { action, reason: rejection.value } })
    toast.add({ title: action === 'approve' ? '审批通过并已执行' : '已驳回', color: 'success' })
    selected.value = null; await refresh()
  } catch (e: any) { toast.add({ title: e?.data?.statusMessage || '审批失败', color: 'error' }) }
  finally { busy.value = false }
}
</script>
<template>
  <div class="space-y-4">
    <div class="flex justify-between"><h1 class="b-page-title">生产更正记录与审批</h1><UButton to="/admin/codes" color="neutral" variant="outline">返回码库</UButton></div>
    <div class="b-card overflow-x-auto"><table class="b-table"><thead><tr><th>编号</th><th>更正范围</th><th>申请人</th><th>原因</th><th>状态</th><th>操作</th></tr></thead><tbody>
      <tr v-for="row in data?.rows" :key="row.id"><td>{{ row.id }}</td><td>{{ row.kind === 'batch' ? '生产批次公共资料' : row.file_name }}</td><td>{{ row.actor_name }}</td><td>{{ row.payload.reason }}</td><td>{{ labels[row.status] }}</td><td><UButton variant="link" @click="select(row)">查看</UButton></td></tr>
    </tbody></table><p v-if="!data?.rows?.length" class="b-empty">暂无更正记录</p></div>
    <div class="flex gap-3 items-center"><UButton :disabled="page === 1" @click="page--">上一页</UButton><span>第 {{ page }} 页</span><UButton :disabled="page * 20 >= (data?.total || 0)" @click="page++">下一页</UButton></div>
    <div v-if="selected" class="b-card p-5 space-y-4">
      <h2 class="b-page-title">更正记录 {{ selected.id }} · {{ labels[selected.status] }}</h2><p>原因：{{ selected.payload.reason }}</p>
      <template v-if="selected.status === 'pending'">
        <p>目标码 {{ selected.result.targetCount }} 条<span v-if="selected.kind === 'batch'">，涉及 {{ selected.result.uploadCount }} 个上传文件；{{ selected.result.legacyCount }} 条历史码保留原有覆盖值</span>。</p>
        <table v-if="selected.kind === 'correct'" class="b-table"><thead><tr><th>字段</th><th>修改前</th><th>修改后</th><th>码数</th></tr></thead><tbody><template v-for="(label, key) in fieldLabels" :key="key"><tr v-for="(change, i) in selected.result.distributions[key]" :key="String(key) + i"><td>{{ label }}</td><td>{{ format(String(key), change.before) }}</td><td>{{ format(String(key), change.after) }}</td><td>{{ change.count }}</td></tr></template></tbody></table>
        <table v-else class="b-table"><thead><tr><th>字段</th><th>修改前</th><th>修改后</th></tr></thead><tbody><tr v-for="field in [{key:'batch_no',label:'生产批号'},{key:'produce_date',label:'生产日期'},{key:'expire_date',label:'有效期至'},{key:'quality_cert_no',label:'质量合格证号'},{key:'qc_result',label:'质检结果'},{key:'qc_report_no',label:'质检报告号'},{key:'quantity',label:'生产数量'}]" :key="field.key"><td>{{ field.label }}</td><td>{{ format(field.key === 'qc_result' ? 'qcResult' : field.key, selected.result.before[field.key]) }}</td><td>{{ format(field.key === 'qc_result' ? 'qcResult' : field.key, selected.result.after[field.key]) }}</td></tr></tbody></table>
        <template v-if="isPlatformAdmin"><UButton :loading="busy" @click="review('approve')">确认通过并执行</UButton><UTextarea v-model="rejection" placeholder="驳回原因（驳回时必填）" maxlength="500" class="w-full" /><UButton variant="outline" :loading="busy" @click="review('reject')">驳回申请</UButton></template>
      </template>
      <p v-if="selected.status === 'rejected'">驳回原因：{{ selected.result.reason }}</p>
      <p v-if="selected.status === 'applied'">已完成并保存逐码修改记录，不可撤销。</p>
      <div v-if="selected.changes?.length" class="overflow-x-auto"><p>以下展示前100条执行明细：</p><table class="b-table"><thead><tr><th>码编号</th><th>生产日期（前 → 后）</th><th>有效期（前 → 后）</th><th>合格证号（前 → 后）</th></tr></thead><tbody><tr v-for="(change, i) in selected.changes" :key="i"><td>{{ change.code_id || '公共资料' }}</td><td>{{ change.before_value.effective?.produceDate || change.before_value.produce_date || '未填写' }} → {{ change.after_value.effective?.produceDate || change.after_value.produce_date || '未填写' }}</td><td>{{ change.before_value.effective?.expireDate || change.before_value.expire_date || '未填写' }} → {{ change.after_value.effective?.expireDate || change.after_value.expire_date || '未填写' }}</td><td>{{ change.before_value.effective?.qualityCertNo || change.before_value.quality_cert_no || '未填写' }} → {{ change.after_value.effective?.qualityCertNo || change.after_value.quality_cert_no || '未填写' }}</td></tr></tbody></table></div>
    </div>
  </div>
</template>
