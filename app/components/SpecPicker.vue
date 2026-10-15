<script setup lang="ts">
// 服务端搜索全部规格，保留当前选中项；不将输入文字当成规格ID提交。
const props = defineProps<{ modelValue: number | null; enterpriseId?: number | null; company?: string | null; productId?: number | null; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null]; selected: [spec: any] }>()
const search = ref('')
const rows = ref<any[]>([])
const selected = ref<any>(null)
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const failure = ref('')
let version = 0
let selectedVersion = 0
let timer: ReturnType<typeof setTimeout> | undefined
const scope = computed(() => ({ enterpriseId: props.enterpriseId || undefined, company: props.company || undefined }))
const items = computed(() => rows.value.map(row => ({ value: Number(row.id), label: row.spec_name + (Number(row.status) === 1 ? '' : '（已停用）'), disabled: Number(row.status) !== 1 && Number(row.id) !== props.modelValue })))
async function load(nextPage = 1) {
  const requestVersion = ++version
  loading.value = true
  failure.value = ''
  if (props.disabled) { rows.value = []; total.value = 0; loading.value = false; return }
  try {
    const data = await $fetch<any>('/api/admin/specs', { query: { ...scope.value, keyword: search.value.trim() || undefined, page: nextPage, pageSize: 50 } })
    if (requestVersion !== version) return
    rows.value = nextPage === 1 ? data.rows : [...rows.value, ...data.rows]
    total.value = data.total
    page.value = nextPage
  } catch {
    if (requestVersion === version) { failure.value = '规格加载失败，请重试'; rows.value = []; total.value = 0 }
  } finally { if (requestVersion === version) loading.value = false }
}
async function loadSelected() {
  const requestVersion = ++selectedVersion
  const id = props.modelValue
  selected.value = rows.value.find(row => Number(row.id) === id) || null
  if (selected.value || !id) { emit('selected', selected.value); return }
  try {
    const data = await $fetch<any>('/api/admin/specs', { query: { ...scope.value, id, productId: props.productId || undefined, pageSize: 1 } })
    if (requestVersion !== selectedVersion) return
    selected.value = data.rows[0] || null
    emit('selected', selected.value)
  } catch { if (requestVersion === selectedVersion) { selected.value = null; emit('selected', null); failure.value = '已选规格加载失败，请重试' } }
}
function choose(value: number | null | undefined) {
  selectedVersion++
  selected.value = rows.value.find(row => Number(row.id) === value) || null
  emit('selected', selected.value)
  emit('update:modelValue', value ?? null)
}
watch(search, () => {
  ++version // 输入时立即作废旧请求，防抖期间也不能用迟到响应覆盖候选。
  clearTimeout(timer)
  timer = setTimeout(() => load(), 250)
})
watch(() => props.modelValue, loadSelected, { immediate: true })
watch(scope, () => { ++selectedVersion; rows.value = []; selected.value = null; emit('selected', null); emit('update:modelValue', null); search.value = ''; load() })
onMounted(() => load())
onBeforeUnmount(() => { clearTimeout(timer); ++version; ++selectedVersion })
</script>

<template>
  <USelectMenu
    :model-value="modelValue"
    v-model:search-term="search"
    :items="items"
    value-key="value"
    :ignore-filter="true"
    :loading="loading"
    :disabled="disabled"
    :search-input="{ placeholder: '输入规格名称、容量、包装或规格码' }"
    placeholder="输入关键词选择规格"
    aria-label="产品规格"
    class="w-full"
    :ui="{ itemLabel: 'whitespace-normal break-words', content: 'min-w-72', value: 'whitespace-normal text-left' }"
    @update:model-value="choose"
  >
    <template #default>{{ selected ? selected.spec_name + (Number(selected.status) === 1 ? '' : '（已停用）') : '输入关键词选择规格' }}</template>
    <template #empty>{{ failure || (loading ? '正在搜索…' : '没有匹配的规格，请调整关键词') }}</template>
    <template #content-bottom>
      <div class="border-t p-2 text-center text-xs text-muted">
        <button v-if="failure" type="button" class="text-primary" @click.stop="load(); loadSelected()">重新加载规格</button>
        <button v-else-if="rows.length < total" type="button" :disabled="loading" class="text-primary" @click.stop="load(page + 1)">共 {{ total }} 个规格，加载更多</button>
        <span v-else>共 {{ total }} 个规格</span>
      </div>
    </template>
  </USelectMenu>
</template>
