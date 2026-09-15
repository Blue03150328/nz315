<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '整批修正' })
const route = useRoute()
const toast = useToast()
const { user, isPlatformAdmin } = useUser()
const base = '/api/admin/codes/upload-batches/' + route.params.id
const { data: context, error } = await useFetch<any>(base + '/binding-context')
const group = ref<string>()
const codeId = computed(() => route.query.codeId ? Number(route.query.codeId) : undefined)
const options = computed(() => (context.value?.groups || []).filter((g: any) => g.batchId && g.bound).map((g: any) => ({ value: g.productId + ':' + g.batchId, label: g.productName + ' / ' + g.batchNo + '（' + g.bound + ' 条已绑定）' })))
watch(options, values => { if (!group.value && values.length === 1) group.value = values[0].value }, { immediate: true })
const fields = [ { key: 'produceDate', label: '生产日期', type: 'date' }, { key: 'expireDate', label: '有效期至', type: 'date' }, { key: 'qualityCertNo', label: '质量合格证号', type: 'text' }, { key: 'qcResult', label: '质量检验结果', type: 'select' } ]
const commands = reactive<Record<string, { action: string; value: any }>>(Object.fromEntries(fields.map(f => [f.key, { action: 'keep', value: f.key === 'qcResult' ? 1 : '' }])))
const reason = ref('')
const preview = ref<any>(null)
const requestKey = ref('')
const busy = ref(false)
const failure = ref('')
const body = computed(() => ({ productId: Number(group.value?.split(':')[0]), groupBatchId: Number(group.value?.split(':')[1]), codeId: codeId.value, reason: reason.value,
  changes: Object.fromEntries(Object.entries(commands).filter(([, c]) => c.action !== 'keep').map(([key, c]) => [key, { action: c.action, ...(c.action === 'set' ? { value: c.value } : {}) }])) }))
watch(body, () => { preview.value = null; requestKey.value = '' }, { deep: true })
const display = (field: string, value: any) => value == null || value === '' ? '未填写' : field === 'qcResult' ? (Number(value) === 1 ? '合格' : '不合格') : value
async function run(confirm = false) {
  busy.value = true
  failure.value = ''
  try {
    if (confirm) {
      const result: any = await $fetch(base + '/correct', { method: 'POST', body: { ...body.value, previewToken: preview.value.previewToken, requestKey: requestKey.value } })
      toast.add({ title: result.status === 'pending' ? '更正申请已提交，等待总部审批' : '修正完成', color: 'success' })
      await navigateTo('/admin/codes/production-operations')
    } else {
      preview.value = await $fetch(base + '/correct/preview', { method: 'POST', body: body.value })
      requestKey.value = crypto.randomUUID()
    }
  } catch (e: any) { failure.value = e?.data?.statusMessage || '操作失败，请重试'; toast.add({ title: e?.data?.statusMessage || '修正失败，请重试', color: 'error' }) }
  finally { busy.value = false }
}
</script>

<template>
  <div class="space-y-4 max-w-5xl">
    <div class="flex justify-between items-center"><h1 class="b-page-title">{{ codeId ? '单码修正' : '整批修正' }}</h1><div class="flex gap-2"><UButton to="/admin/codes/production-operations" variant="outline" color="neutral">更正记录与审批</UButton><UButton to="/admin/codes" variant="outline" color="neutral">返回码库</UButton></div></div>
    <p v-if="error" class="b-tag-danger">{{ error?.data?.statusMessage || '上传文件读取失败，请返回码库重试' }}</p>
    <p v-if="failure" role="alert" class="b-note text-red-700">{{ failure }}</p>
    <template v-if="context">
      <div class="b-card p-5 space-y-2"><p>来源文件：{{ context.file.file_name }}</p><p>仅更正本文件选定范围内的码，不改变生产批次归属。</p><p v-if="codeId">当前仅修正从明细中选中的一条码。</p></div>
      <div class="b-card p-5 space-y-4">
        <div><label class="b-label">生产批次分组</label><USelect v-model="group" :items="options" placeholder="选择需要修正的分组" class="w-full" /></div>
        <p v-if="!options.length" class="b-empty">没有已绑定码，请先完成生产绑定。</p>
        <div v-for="field in fields" :key="field.key" class="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
          <label class="b-label">{{ field.label }}</label>
          <USelect v-model="commands[field.key]!.action" :items="[{ value: 'keep', label: '不修改' }, { value: 'set', label: '设置新值' }, { value: 'inherit', label: '恢复使用批次资料' }, ...(field.key === 'expireDate' ? [{ value: 'clear', label: '清空' }] : [])]" />
          <template v-if="commands[field.key]!.action === 'set'">
            <USelect v-if="field.type === 'select'" v-model="commands[field.key]!.value" :items="[{ value: 1, label: '合格' }, { value: 0, label: '不合格' }]" />
            <UInput v-else v-model="commands[field.key]!.value" :type="field.type === 'date' ? 'date' : 'text'" maxlength="64" />
          </template>
        </div>
        <div><label class="b-label">修正原因 *</label><UTextarea v-model="reason" maxlength="500" placeholder="说明资料错误及更正依据" class="w-full" /></div>
        <p class="b-note">冻结或作废码不参与整批修正。生产日期与有效期分别修改；已绑定码更正由总部审批，提交后不可撤销。</p>
        <UButton :disabled="user?.role === 'viewer' || !options.length" :loading="busy" @click="run()">预览修正</UButton>
      </div>
      <div v-if="preview" class="b-card p-5 space-y-3">
        <h2 class="b-page-title">确认修改前后差异</h2><p>本次目标 {{ preview.targetCount }} 条，文件其他 {{ preview.excludedCount }} 条不参与。</p>
        <div class="overflow-x-auto"><table class="b-table"><thead><tr><th>字段</th><th>修改前</th><th>修改后</th><th>码数</th></tr></thead><tbody>
          <template v-for="field in fields" :key="field.key"><tr v-for="(change, i) in preview.distributions[field.key]" :key="field.key + i"><td>{{ field.label }}</td><td>{{ display(field.key, change.before) }}</td><td>{{ display(field.key, change.after) }}</td><td>{{ change.count }}</td></tr></template>
        </tbody></table></div>
        <p>修正原因：{{ reason }}</p><UButton :loading="busy" @click="run(true)">{{ isPlatformAdmin ? '确认修正' : '提交总部审批' }}</UButton>
      </div>
    </template>
  </div>
</template>
