<script setup lang="ts">
// 归属企业选择器（2026-09-07 用户需求）：候选 = 登记数据源（pesticide_reg）中的全部生产厂家
// （3,637 家去重，不再使用系统 enterprise 表）；远程搜索：输入关键字防抖请求 /regdata/factories，
// 点击展开默认加载首批 + 可输入过滤；选中值 = 厂家名（与登记数据源 company 同源，过滤无损耗）
import { ref, onMounted, onBeforeUnmount } from 'vue'

withDefaults(defineProps<{
  modelValue: string | null          // 已选厂家名
  placeholder?: string
}>(), { placeholder: '输入厂家名搜索（登记数据源全部厂家）' })
const emit = defineEmits<{ (e: 'update:modelValue', v: string | null): void }>()

const keyword = ref('')
const open = ref(false)
const loading = ref(false)
const items = ref<string[]>([])       // 服务端返回的候选（已按关键字过滤）
const total = ref(0)
const rootEl = ref<any>(null)
let timer: any = null

async function fetchFactories(kw: string) {
  loading.value = true
  try {
    const data = await $fetch<any>('/api/admin/regdata/factories', {
      query: { keyword: kw || undefined, page: 1, pageSize: 100 },
    })
    items.value = data?.rows || []
    total.value = data?.total || 0
  } catch {
    items.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function onInput(v: string) {
  keyword.value = v
  open.value = true
  clearTimeout(timer)
  timer = setTimeout(() => { fetchFactories(v.trim()) }, 300)
}
function pick(name: string) {
  keyword.value = ''
  emit('update:modelValue', name)
  open.value = false
}
function clearVal() {
  keyword.value = ''
  emit('update:modelValue', null)
  open.value = true
  fetchFactories('')
}
function toggle() {
  open.value = !open.value
  if (open.value && !items.value.length) {
    keyword.value = ''
    fetchFactories('')
  }
}
function onDocClick(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => { clearTimeout(timer); document.removeEventListener('click', onDocClick) })
</script>

<template>
  <!-- 根容器点击展开候选面板（UInput @focus 透传不可靠，2026-09-07 改 click 驱动） -->
  <div ref="rootEl" class="relative" @click="open = true">
    <div class="flex w-full items-center">
      <UInput
        :model-value="keyword || modelValue || ''"
        :placeholder="placeholder"
        class="w-full"
        :loading="loading"
        @update:model-value="onInput"
      >
        <template #trailing>
          <button
            v-if="modelValue && !keyword"
            type="button"
            tabindex="-1"
            class="flex h-6 w-6 items-center justify-center text-[var(--b-text-muted)] hover:text-[var(--b-text-title)]"
            @mousedown.prevent
            @click.stop="clearVal"
          >
            <UIcon name="i-lucide-x" class="h-3.5 w-3.5" />
          </button>
          <button
            v-else
            type="button"
            tabindex="-1"
            class="flex h-6 w-6 items-center justify-center text-[var(--b-text-muted)] hover:text-[var(--b-text-title)]"
            @mousedown.prevent
            @click.stop="toggle"
          >
            <UIcon :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="h-3.5 w-3.5" />
          </button>
        </template>
      </UInput>
    </div>
    <!-- 候选面板（@click.stop：防选中后冒泡重新展开） -->
    <div
      v-if="open && !loading"
      class="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded border border-[var(--b-border)] bg-white py-1 shadow-lg"
      @click.stop
    >
      <button
        v-for="name in items"
        :key="name"
        type="button"
        class="block w-full px-3 py-1.5 text-left text-xs leading-relaxed text-[var(--b-text-regular)] transition-colors hover:bg-[var(--b-fill)]/80"
        :class="{ 'bg-[var(--b-fill)]/60 font-medium': name === modelValue }"
        @mousedown.prevent
        @click="pick(name)"
      >
        {{ name }}
      </button>
      <div v-if="!items.length" class="px-3 py-1.5 text-xs text-[var(--b-text-muted)]">
        {{ keyword ? '无匹配厂家，请调整关键字' : '暂无厂家数据' }}
      </div>
      <div v-if="items.length && total > items.length" class="px-3 py-1.5 text-center text-xs text-[var(--b-text-muted)]">
        共 {{ total }} 家厂家，输入关键字可精确搜索
      </div>
    </div>
  </div>
</template>
