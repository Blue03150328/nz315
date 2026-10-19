<script setup lang="ts">
withDefaults(defineProps<{ title?: string }>(), { title: '使用说明' })
</script>

<template>
  <details class="b-help-panel">
    <summary>{{ title }}</summary>
    <div class="b-help-content"><slot /></div>
  </details>
</template>
