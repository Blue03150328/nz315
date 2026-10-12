<script setup lang="ts">
const props = defineProps<{ total: number; itemsPerPage: number; disabled?: boolean }>()
const page = defineModel<number>('page', { default: 1 })
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.itemsPerPage)))
</script>

<template>
  <nav aria-label="分页" class="flex items-center gap-2">
    <UButton type="button" color="neutral" variant="outline" size="sm" :disabled="disabled || page <= 1" @click="page--">上一页</UButton>
    <span class="b-help whitespace-nowrap">{{ page }} / {{ pages }}</span>
    <UButton type="button" color="neutral" variant="outline" size="sm" :disabled="disabled || page >= pages" @click="page++">下一页</UButton>
  </nav>
</template>
