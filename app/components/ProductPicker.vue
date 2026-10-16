<script setup lang="ts">
import { productWithSpec } from '#shared/utils/product-name'

// 搜索全部启用产品；选中行独立保留，过滤结果不能改变生成配置。
const props = defineProps<{ modelValue: number | null; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [id: number | null]; selected: [product: any] }>()
const search = ref('')
const rows = ref<any[]>([])
const selected = ref<any>(null)
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const failure = ref('')
let requestVersion = 0
let selectedVersion = 0
let timer: ReturnType<typeof setTimeout> | undefined
function label(product: any) {
  const name = productWithSpec(product), trademark = String(product.trademark || '').trim()
  return (trademark && !name.includes(trademark) ? `（${trademark}）` : '') + name + `（${product.registration_no}）`
}
const items = computed(() => rows.value.map(product => ({ value: Number(product.id), label: label(product) })))
async function load(nextPage = 1) {
  const version = ++requestVersion
  loading.value = true
  failure.value = ''
  try {
    const data = await $fetch<any>('/api/admin/products', { query: { keyword: search.value.trim() || undefined, status: 1, page: nextPage, pageSize: 50 } })
    if (version !== requestVersion) return
    rows.value = nextPage === 1 ? data.rows : [...rows.value, ...data.rows]
    page.value = nextPage
    total.value = data.total
  } catch {
    if (version === requestVersion) { rows.value = []; total.value = 0; failure.value = '产品加载失败，请重试' }
  } finally { if (version === requestVersion) loading.value = false }
}
async function loadSelected(id: number | null) {
  const version = ++selectedVersion
  const cached = rows.value.find(row => Number(row.id) === id) || (Number(selected.value?.id) === id ? selected.value : null)
  if (cached || !id) {
    selected.value = cached
    emit('selected', cached)
    if (!id) search.value = ''
    return
  }
  try {
    const data = await $fetch<any>('/api/admin/products', { query: { productId: id, status: 1, pageSize: 1 } })
    if (version !== selectedVersion) return
    selected.value = data.rows[0] || null
    emit('selected', selected.value)
  } catch { if (version === selectedVersion) failure.value = '已选产品加载失败，请重试' }
}
function choose(id: number | null | undefined) {
  ++selectedVersion
  selected.value = rows.value.find(row => Number(row.id) === id) || null
  emit('selected', selected.value)
  emit('update:modelValue', id ?? null)
}
watch(search, () => {
  ++requestVersion
  rows.value = []
  total.value = 0
  loading.value = true
  clearTimeout(timer)
  timer = setTimeout(() => load(), 250)
})
watch(() => props.modelValue, loadSelected, { immediate: true })
onMounted(() => load())
onBeforeUnmount(() => { clearTimeout(timer); ++requestVersion; ++selectedVersion })
</script>

<template>
  <USelectMenu :model-value="modelValue" v-model:search-term="search" :items="items" value-key="value" :ignore-filter="true" :loading="loading" :disabled="disabled" :search-input="{ placeholder: '输入产品名称、商标、登记证号或规格' }" placeholder="输入关键词选择产品" aria-label="生成产品" class="w-full" :ui="{ itemLabel: 'whitespace-normal break-words', content: 'min-w-72', value: 'whitespace-normal break-words text-left' }" @update:model-value="choose">
    <template #default><span class="whitespace-normal break-words text-left">{{ selected ? label(selected) : '输入关键词选择产品' }}</span></template>
    <template #empty>{{ failure || (loading ? '正在搜索…' : '没有匹配的启用产品，请调整关键词') }}</template>
    <template #content-bottom>
      <div class="border-t p-2 text-center text-xs text-muted">
        <button v-if="failure" type="button" class="text-primary" @click.stop="load(); loadSelected(modelValue)">重新加载产品</button>
        <button v-else-if="rows.length < total" type="button" :disabled="loading" class="text-primary" @click.stop="load(page + 1)">共 {{ total }} 个产品，加载更多</button>
        <span v-else>共 {{ total }} 个产品</span>
      </div>
    </template>
  </USelectMenu>
</template>
