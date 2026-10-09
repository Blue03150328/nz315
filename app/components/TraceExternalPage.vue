<script setup lang="ts">
// ⚠️ 2026-10-09 起**已无任何引用**：外码页（TraceExternal.vue）改为纯外链出口，不再内嵌厂家原页
//    （跨站多被 X-Frame-Options / CSP 拒绝，本组件那套「/api/source-frame 预检 + 8 秒 hint + 收起展开」
//     绝大多数时候的产出就是一句「请打开厂家原页查看」）。
//    保留文件与 server 侧 /api/source-frame（含 tests/source-frame.test.mjs）是为了不引入「上线包删除文件」
//    的清理清单负担；若确定不再回到内嵌方案，可连同 server/api/source-frame.get.ts、server/utils/source-frame.ts
//    一起删除（删除需在部署时补 rm -f 清单，见 MEMORY「判包过期」条）。
const props = defineProps<{ sourceUrl?: string; platform?: string }>()
const result = ref<{ allowed: boolean; url?: string; message: string }>()
const checking = ref(false)
const showing = ref(true)
const hint = ref(false)
let requestId = 0
let timer: ReturnType<typeof setTimeout> | undefined
const safeUrl = computed(() => {
  try {
    const url = new URL(props.sourceUrl || '')
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch { return '' }
})
// 原页可否显示与资料比对独立；浏览器不能可靠告知跨站页面是否加载成功。
onMounted(() => watch(safeUrl, async url => {
  const id = ++requestId
  checking.value = false
  clearTimeout(timer)
  result.value = undefined
  hint.value = false
  showing.value = true
  if (!url) return
  if (!url.startsWith('https://')) {
    result.value = { allowed: false, message: '这个厂家网址未使用安全连接，请通过原页入口查看。' }
    return
  }
  checking.value = true
  try {
    const response = await $fetch('/api/source-frame', { query: { url } })
    if (id !== requestId) return
    result.value = response
    if (response.allowed) timer = setTimeout(() => { hint.value = true }, 8000)
  } catch {
    if (id === requestId) result.value = { allowed: false, message: '原页暂时不能在此显示，请打开厂家原页查看。' }
  } finally { if (id === requestId) checking.value = false }
}, { immediate: true }))
onBeforeUnmount(() => { requestId++; clearTimeout(timer) })
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-border bg-elevated">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
      <div>
        <h2 class="text-base font-semibold">厂家原查询页</h2>
        <p class="mt-1 text-xs text-muted">来源：{{ platform || '外部追溯平台' }} · 厂家页面内容由来源平台提供</p>
      </div>
      <a v-if="safeUrl" :href="safeUrl" target="_blank" rel="noopener noreferrer" class="text-sm font-medium text-primary underline">打开厂家原页 ↗</a>
    </div>
    <div class="px-4 py-3 text-sm text-muted">
      <p v-if="checking">正在检查厂家原页是否支持在此显示…</p>
      <p v-else-if="!safeUrl">没有取得厂家网址，请核对包装上的追溯说明。</p>
      <p v-else>{{ result?.message || '正在准备厂家页面；下方资料为本次读取的厂家声明。' }}</p>
      <p v-if="hint && showing" class="mt-2">若下方空白或无法操作，可打开厂家原页，或收起原页查看已读取的资料。</p>
      <button v-if="result?.allowed" type="button" class="mt-2 text-primary underline" @click="showing = !showing">{{ showing ? '收起原页，查看厂家资料' : '展开厂家原页' }}</button>
    </div>
    <iframe v-if="result?.allowed && result.url && showing" :src="result.url" title="厂家原追溯查询页" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" class="block h-[70vh] min-h-[480px] w-full border-0 bg-white" />
  </section>
</template>
