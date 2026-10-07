<script setup lang="ts">
import type { AdminOnboarding } from '#shared/types/admin-onboarding'
const { user, isPlatformAdmin, canWrite } = useUser()
const enterpriseId = useState<number | undefined>('onboarding-enterprise-' + user.value?.id, () => undefined)
const keyword = ref('')
const { data: factories, pending: loadingFactories } = await useFetch<any>('/api/admin/factories', {
  key: 'onboarding-factories-' + user.value?.id,
  immediate: isPlatformAdmin.value,
  query: computed(() => ({ keyword: keyword.value || undefined, pageSize: 100 })),
})
const { data, error, refresh } = await useFetch<AdminOnboarding>('/api/admin/onboarding', {
  key: 'onboarding-' + user.value?.id,
  query: computed(() => ({ enterpriseId: enterpriseId.value })),
})
onActivated(() => refresh())
const steps = computed(() => [
  { label: '维护规格', done: data.value?.specsReady, to: '/admin/specs' },
  { label: '建立产品', done: data.value?.productsReady, to: '/admin/products' },
  { label: '生成或上传追溯码', done: data.value?.codesReady, to: canWrite.value ? '/admin/collection' : '/admin/codes' },
  { label: '查看绑定结果', done: data.value?.bindingReady, to: '/admin/codes' },
])
</script>

<template>
  <div class="b-card">
    <div class="b-card-head"><span class="b-card-title">企业建档指引</span><UButton size="xs" variant="link" @click="refresh()">刷新进度</UButton></div>
    <div class="b-card-body space-y-3">
      <div v-if="isPlatformAdmin" class="flex flex-wrap gap-2">
        <UInput v-model="keyword" placeholder="搜索企业名称" />
        <USelect v-model="enterpriseId" :loading="loadingFactories" :items="(factories?.rows || []).map((r: any) => ({ value: Number(r.id), label: r.name }))" placeholder="选择要查看进度的企业" class="min-w-64" />
        <span v-if="factories?.total > 100" class="b-help">请搜索企业名称缩小范围</span>
      </div>
      <div v-if="error" class="text-sm text-error">建档进度加载失败，请点击刷新进度重试。</div>
      <p v-else-if="!data?.enterpriseId" class="b-help">选择企业后，依据该企业已有资料显示建档进度。</p>
      <template v-else>
        <p class="b-help">{{ data.enterpriseName }} · {{ canWrite ? '按顺序准备资料；已有外部码文件可直接上传，无需先生成。' : '当前为只读账号，可查看资料；建档请联系企业管理员。' }}</p>
        <div class="grid gap-2 md:grid-cols-4">
          <NuxtLink v-for="(step, i) in steps" :key="step.to + i" :to="step.to" class="rounded border border-[var(--b-border)] p-3 text-sm hover:border-primary">
            <span class="mr-2">{{ step.done ? '✓' : i + 1 }}</span>{{ step.label }}
            <span class="mt-1 block text-xs text-muted">{{ step.done ? '已有可用资料' : '尚未完成' }} · {{ canWrite ? '进入查看或维护' : '进入查看' }}</span>
          </NuxtLink>
        </div>
        <p v-if="isPlatformAdmin" class="b-help">以上进度仅属于所选企业；进入管理页后请核对资料的归属企业。</p>
      </template>
    </div>
  </div>
</template>
