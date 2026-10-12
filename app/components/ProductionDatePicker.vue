<script setup lang="ts">
import { parseDate, today, type DateValue } from '@internationalized/date'
import { isInputDate } from '#shared/utils/input-date'

const props = defineProps<{ label: string; disabled?: boolean; min?: string }>()
const model = defineModel<string>({ default: '' })
const open = ref(false)
const selectedDate = computed(() => isInputDate(model.value) ? parseDate(model.value) : undefined)
const minimumDate = computed(() => props.min && isInputDate(props.min) ? parseDate(props.min) : undefined)
const todayDisabled = computed(() => !!minimumDate.value && today('Asia/Shanghai').compare(minimumDate.value) < 0)
function selectDate(value: DateValue | undefined) {
  if (props.disabled) return
  model.value = value?.toString() || ''
  open.value = false
}
watch(() => props.disabled, disabled => { if (disabled) open.value = false })
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'start' }">
    <UButton type="button" color="neutral" variant="outline" icon="i-lucide-calendar-days" :disabled="disabled" :aria-label="'选择' + label" class="w-full justify-start">
      <span :class="{ 'text-muted': !model }">{{ model || '请选择' + label }}</span>
    </UButton>
    <template #content>
      <div class="p-3">
        <UCalendar :model-value="selectedDate" :min-value="minimumDate" :disabled="disabled" :calendar-label="label" locale="zh-CN" :week-starts-on="1"
          :prev-month="{ 'aria-label': '上个月' }" :next-month="{ 'aria-label': '下个月' }"
          :prev-year="{ 'aria-label': '上一年' }" :next-year="{ 'aria-label': '下一年' }"
          :view-control="{ 'aria-label': '选择月份或年份' }" @update:model-value="selectDate" />
        <div class="mt-2 flex justify-between border-t border-default pt-2">
          <UButton type="button" variant="ghost" :disabled="disabled || todayDisabled" @click="selectDate(today('Asia/Shanghai'))">今天</UButton>
          <UButton type="button" variant="ghost" color="neutral" :disabled="disabled" @click="selectDate(undefined)">清除</UButton>
        </div>
      </div>
    </template>
  </UPopover>
</template>
