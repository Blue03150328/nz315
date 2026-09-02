<script setup lang="ts">
const router = useRouter()
const toast = useToast()
const traceCode = ref('')
const searching = ref(false)

// 统计接口（当前为演示数据，后端需求确认后接入真实数据）
const { data: stats, error: statsError } = await useFetch('/api/stats')

const handleManualQuery = async () => {
  const code = traceCode.value.trim()
  if (!code) {
    toast.add({ title: '请输入32位单元识别代码', color: 'warning' })
    return
  }
  searching.value = true
  await router.push('/trace?code=' + encodeURIComponent(code))
  searching.value = false
}

const handleScan = () => {
  // 跳转扫码页：相机取景实时识别（原「聚焦输入框」占位实现已于本轮替换为真实扫码）
  router.push('/scan')
}
</script>

<template>
  <div class="space-y-5 px-4 pb-6 pt-5 lg:px-0 lg:pt-8">
    <!-- 顶部：标题 -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold text-default">农资315</h1>
        <p class="mt-1 text-sm text-muted">
          农药追溯查询
        </p>
      </div>
    </div>

    <!-- 大扫码按钮 -->
    <div
      class="overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-emerald-600 text-white shadow-lg shadow-primary/30"
    >
      <div class="p-6">
        <button
          type="button"
          class="flex w-full flex-col items-center gap-3 py-6"
          @click="handleScan"
        >
          <div
            class="relative flex h-28 w-28 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm"
          >
            <UIcon name="i-lucide-qr-code" class="h-16 w-16 text-white" />
          </div>
          <div class="text-lg font-semibold">扫一扫，查真伪</div>
          <div class="text-sm text-white/80">
            扫描瓶身二维码 · 一物一码 · 正品保障
          </div>
          <div class="mt-2 flex items-center gap-4 text-xs text-white/90">
            <span class="flex items-center gap-1"><span class="flex h-4 w-4 items-center justify-center rounded-full bg-white/25 text-[10px] font-bold">1</span>扫瓶身二维码</span>
            <span class="flex items-center gap-1"><span class="flex h-4 w-4 items-center justify-center rounded-full bg-white/25 text-[10px] font-bold">2</span>自动出结果</span>
            <span class="flex items-center gap-1"><span class="flex h-4 w-4 items-center justify-center rounded-full bg-white/25 text-[10px] font-bold">3</span>异常可举报</span>
          </div>
        </button>
      </div>
    </div>

    <!-- 手动输入 -->
    <form class="flex gap-2 lg:mx-auto lg:max-w-3xl" @submit.prevent="handleManualQuery">
      <UInput
        id="trace-input"
        v-model="traceCode"
        size="lg"
        placeholder="输入32位单元识别代码"
        class="flex-1"
        :disabled="searching"
      />
      <UButton
        type="submit"
        size="lg"
        :loading="searching"
        class="shrink-0"
        icon="i-lucide-search"
      >
        查询
      </UButton>
    </form>

    <!-- 统计 -->
    <div v-if="statsError" class="rounded-xl border border-error/30 bg-error/5 px-4 py-3 text-sm text-error lg:mx-auto lg:max-w-3xl">
      统计数据加载失败
    </div>
    <div v-else class="grid grid-cols-2 gap-3 lg:mx-auto lg:max-w-3xl">
      <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
        <div class="flex items-center gap-2 text-muted">
          <span class="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary"><UIcon name="i-lucide-eye" class="h-4 w-4" /></span>
          <span class="text-xs">累计查询</span>
        </div>
        <div class="mt-1 text-2xl font-bold text-primary">
          {{ stats?.totalQueries || '--' }}
        </div>
      </div>
      <div class="rounded-xl border border-border bg-elevated p-4 shadow-sm">
        <div class="flex items-center gap-2 text-muted">
          <span class="flex h-8 w-8 items-center justify-center rounded-full bg-error/10 text-error"><UIcon name="i-lucide-alert-triangle" class="h-4 w-4" /></span>
          <span class="text-xs">异常线索</span>
        </div>
        <div class="mt-1 text-2xl font-bold text-error">
          {{ stats?.abnormalClues ?? '--' }}
        </div>
      </div>
    </div>

    <!-- 查询须知 -->
    <div class="rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted lg:mx-auto lg:max-w-3xl">
      <div class="mb-2 flex items-center gap-1.5 font-medium text-default">
        <UIcon name="i-lucide-circle-help" class="h-4 w-4 text-primary" />
        关于追溯码
      </div>
      <p>农药瓶身二维码内含 32 位单元识别代码，符合农业农村部第 1049 号公告。</p>
      <p class="mt-1">
        扫码即可查询产品真伪、登记证信息与查询次数，发现异常可一键举报。
      </p>
    </div>
  </div>
</template>