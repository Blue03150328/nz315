<script setup lang="ts">
const props = defineProps<{ sources: any; fixedSource?: any; loading?: boolean; disabled?: boolean; productSelected: boolean }>()
const emit = defineEmits<{ selectTask: [task: any] }>()
const model = defineModel<{ kind: string; sourceId: string; quantity: number; content: string }>({ required: true })
const items = computed(() => model.value.kind === 'task' ? props.sources?.tasks || [] : props.sources?.uploads || [])
const available = computed(() => Number(props.fixedSource?.available_count ?? items.value.find((s: any) => Number(s.id) === Number(model.value.sourceId))?.available_count ?? 0))
// 数量只由操作员输入；切换来源或更新其他资料都不能覆盖已填写数量。
function changeKind() { model.value.sourceId = '' }
function changeQuantity(event: Event) {
  model.value = { ...model.value, quantity: Number((event.target as HTMLInputElement).value) }
}
function selectSource() {
  if (model.value.kind === 'task') {
    const task = items.value.find((s: any) => Number(s.id) === Number(model.value.sourceId))
    if (task) emit('selectTask', task)
  }
}
async function readFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) model.value.content = await file.text()
}
const count = computed(() => new Set(model.value.content.split(/\r?\n/).map(s => s.trim()).filter(Boolean)).size)
</script>

<template>
  <fieldset :disabled="disabled" class="space-y-3 rounded border p-4">
    <legend class="px-1 font-semibold">领用追溯码</legend>
    <p v-if="fixedSource">来源：{{ fixedSource.name }} · {{ fixedSource.line_name || fixedSource.name }}</p>
    <template v-else>
      <label class="block space-y-1"><span>码来源</span><select v-model="model.kind" class="w-full rounded border p-2" @change="changeKind"><option value="upload">已入库码文件</option><option value="task">已审核任务的剩余码</option><option value="manual">指定码清单</option></select></label>
      <label v-if="model.kind !== 'manual'" class="block space-y-1"><span>{{ model.kind === 'task' ? '来源任务' : '来源文件' }}</span><select v-model="model.sourceId" required :disabled="loading || (model.kind === 'upload' && !productSelected)" class="w-full rounded border p-2" @change="selectSource"><option value="">{{ model.kind === 'upload' && !productSelected ? '请先选择产品' : loading ? '正在加载…' : '请选择来源' }}</option><option v-for="s in items" :key="s.id" :value="String(s.id)">{{ model.kind === 'task' ? `${s.name} · ${s.product_name} · ${s.line_name || s.name}` : s.file_name }} · 可领 {{ s.available_count }} 个</option></select></label>
      <p v-if="model.kind === 'upload' && !productSelected" class="text-sm text-muted">请先选择产品，再选择已入库码文件。</p>
      <p v-else-if="model.kind === 'task' && !productSelected" class="text-sm text-muted">可先选来源任务，系统自动带入产品；也可先选产品缩小范围。</p>
      <p v-if="!loading && model.kind === 'task' && !items.length" class="text-sm text-muted">暂无已审核放行且仍有可领码的任务。</p>
      <p v-else-if="!loading && model.kind === 'upload' && productSelected && !items.length" class="text-sm text-muted">该产品暂无可领码文件，请先将码文件入库。</p>
      <p v-if="model.kind === 'task' && items.length >= 100" class="text-sm text-muted">显示最近100个可领用任务，可先选产品缩小范围。</p>
    </template>
    <label v-if="fixedSource || model.kind !== 'manual'" class="block space-y-1"><span>本次领用数量（当前可领 {{ available }} 个）</span><input :value="model.quantity" type="number" min="1" :max="Math.min(available, 10000)" required class="w-full rounded border p-2" @input="changeQuantity" /><span class="block text-sm text-muted">系统自动确定具体码清单，无需复制粘贴。每次最多10000个。</span></label>
    <template v-else>
      <label class="block">导入码清单 <input type="file" accept=".txt,.csv" @change="readFile" /></label>
      <label class="block space-y-1"><span>具体码清单（每行一个32位码）</span><textarea v-model="model.content" rows="4" required class="w-full rounded border p-2 font-mono text-sm" /></label>
      <p class="text-sm text-muted">已填写 {{ count }} 个不同码。</p>
    </template>
  </fieldset>
</template>
