<script setup lang="ts">
// 归属企业选择器（2026-09-04 需求：无论生产类型都展示完整厂家列表 + 可输入搜索）
// 本地过滤（厂家数量有限）：输入关键字实时过滤企业名，点击候选选中；无候选时可继续输入（提示无匹配）
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: number | null
  items: { id: number; name: string }[]  // 完整厂家列表（不再按生产类型过滤）
  placeholder?: string
}>(), { placeholder: '输入关键字搜索厂家' })
const emit = defineEmits<{ (e: 'update:modelValue', v: number | null): void }>()

const keyword = ref('')
const open = ref(false)
const rootEl = ref<any>(null)

const selectedName = computed(() => props.items.find(it => Number(it.id) === Number(props.modelValue))?.name || '')

// 输入过滤候选（空关键字展示全部）
const filteredItems = computed(() => {
  const kw = keyword.value.trim()
  if (!kw) return props.items
  return props.items.filter(it => it.name.includes(kw))
})

function onInput(v: string) {
  keyword.value = v
  open.value = true
}
function pick(it: { id: number; name: string }) {
  keyword.value = ''
  emit('update:modelValue', Number(it.id))
  open.value = false
}
function clearVal() {
  keyword.value = ''
  emit('update:modelValue', null)
  open.value = true
}
function toggle() {
  if (!props.items.length) return
  open.value = !open.value
  if (open.value && !selectedName.value) keyword.value = ''
}
function onDocClick(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="rootEl" class="relative">
    <div class="flex w-full items-center">
      <UInput
        :model-value="keyword || selectedName"
        :placeholder="placeholder"
        class="w-full"
        @update:model-value="onInput"
        @focus="items.length && (open = true)"
      >
        <template #trailing>
          <button
            v-if="selectedName && !keyword"
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
    <!-- 候选面板 -->
    <div
      v-if="open && items.length"
      class="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded border border-[var(--b-border)] bg-white py-1 shadow-lg"
    >
      <button
        v-for="it in filteredItems"
        :key="it.id"
        type="button"
        class="block w-full px-3 py-1.5 text-left text-xs leading-relaxed text-[var(--b-text-regular)] transition-colors hover:bg-[var(--b-fill)]/80"
        :class="{ 'bg-[var(--b-fill)]/60 font-medium': Number(it.id) === Number(modelValue) }"
        @mousedown.prevent
        @click="pick(it)"
      >
        {{ it.name }}
      </button>
      <div v-if="!filteredItems.length" class="px-3 py-1.5 text-xs text-[var(--b-text-muted)]">无匹配厂家，请调整关键字</div>
    </div>
  </div>
</template>
