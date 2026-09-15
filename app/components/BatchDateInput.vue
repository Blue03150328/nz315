<script setup lang="ts">
import { isInputDate } from '#shared/utils/input-date'

defineProps<{ label: string }>()
const model = defineModel<string>({ default: '' })
const calendarValue = computed(() => isInputDate(model.value) ? model.value : '')
const selectDate = (event: Event) => {
  model.value = (event.target as HTMLInputElement).value
}
</script>

<template>
  <div class="flex items-center gap-2">
    <UInput v-model="model" :aria-label="label" placeholder="YYYY-MM-DD" maxlength="10" class="min-w-0 flex-1" />
    <div class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-default">
      <UIcon name="i-lucide-calendar-days" class="h-4 w-4" />
      <input type="date" :value="calendarValue" :aria-label="'选择' + label" class="batch-calendar" @change="selectDate">
    </div>
  </div>
</template>

<style scoped>
.batch-calendar { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.batch-calendar::-webkit-calendar-picker-indicator { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
</style>
