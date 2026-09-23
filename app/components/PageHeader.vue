<script setup lang="ts">
defineProps<{
  title: string
  showBack?: boolean
}>()
const router = useRouter()
</script>

<template>
  <header
    class="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border/50 bg-default/90 px-4 backdrop-blur-md lg:top-16 lg:mx-auto lg:w-full lg:max-w-6xl lg:px-8"
  >
    <div class="flex w-12 items-center">
      <UButton v-if="showBack" variant="ghost" color="neutral" square icon="i-lucide-arrow-left" aria-label="返回" @click="router.back()" />
    </div>
    <h1 class="text-base font-semibold text-default">{{ title }}</h1>
    <div class="flex min-w-12 items-center justify-end gap-1">
      <slot name="right" />
    </div>
  </header>
</template>
