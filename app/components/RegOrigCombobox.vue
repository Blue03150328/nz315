<script setup lang="ts">
// 原药字段组合框：同时支持「下拉选择候选」与「手动输入任意内容」
// 用法：原药登记证号与原药生产企业名称各放一个实例（items 同一候选集，valueOf 指定点击选项时回填的字段值）
// 联动逻辑由父级 watch 两个 v-model 完成（选中/输入匹配候选 → 另一字段自动带出；不匹配 → 清空对方）
import { ref, computed, watch, onBeforeUnmount, onMounted } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  items: { registration_no: string; company: string }[]  // 原药候选集
  valueOf: 'reg' | 'company'                             // 点击选项时 emit 的值字段（reg=登记证号 / company=企业名）
  placeholder?: string
}>(), { placeholder: '' })
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const open = ref(false)
const rootEl = ref<any>(null)
const inputEl = ref<any>(null)

// 候选中当前值是否命中（用于选项高亮提示可省；仅展示用）
const filteredItems = computed(() => {
  const kw = String(props.modelValue || '').trim()
  if (!kw) return props.items
  return props.items.filter(it => (it.registration_no + ' ' + it.company).includes(kw))
})

function onInput(v: string) {
  emit('update:modelValue', v)
  if (props.items.length) open.value = true
}
function pick(it: { registration_no: string; company: string }) {
  emit('update:modelValue', props.valueOf === 'reg' ? it.registration_no : it.company)
  open.value = false
}
function toggle() {
  if (!props.items.length) return
  open.value = !open.value
}
function onDocClick(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <!-- 根容器点击展开面板：UInput @focus 透传链不可靠（2026-09-07 实测点击聚焦不开面板），改 click 驱动 + 输入事件双保险 -->
  <div ref="rootEl" class="relative" @click="items.length && (open = true)">
    <div class="flex w-full items-center">
      <UInput
        ref="inputEl"
        :model-value="modelValue"
        :placeholder="placeholder"
        class="w-full"
        :ui="{ trailing: { pointer: '' } }"
        @update:model-value="onInput"
        @focus="items.length && (open = true)"
      >
        <template v-if="items.length" #trailing>
          <button type="button" tabindex="-1" class="flex h-6 w-6 items-center justify-center text-[var(--b-text-muted)] hover:text-[var(--b-text-title)]" @mousedown.prevent @click.stop="toggle">
            <UIcon :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="h-3.5 w-3.5" />
          </button>
        </template>
      </UInput>
    </div>
    <!-- 候选下拉面板（@click.stop：防选中候选后冒泡到根容器重新展开） -->
    <div
      v-if="open && items.length"
      class="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded border border-[var(--b-border)] bg-white py-1 shadow-lg"
      @click.stop
    >
      <button
        v-for="it in filteredItems"
        :key="it.registration_no"
        type="button"
        class="block w-full px-3 py-1.5 text-left text-xs leading-relaxed text-[var(--b-text-regular)] transition-colors hover:bg-[var(--b-fill)]/80"
        @mousedown.prevent
        @click="pick(it)"
      >
        <span class="font-code font-medium text-[var(--b-text-title)]">{{ it.registration_no }}</span>
        <span class="text-[var(--b-text-muted)]"> | {{ it.company }}（原药）</span>
      </button>
      <div v-if="!filteredItems.length" class="px-3 py-1.5 text-xs text-[var(--b-text-muted)]">无匹配候选，可继续手动输入</div>
    </div>
  </div>
</template>
