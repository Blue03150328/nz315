<script setup lang="ts">
// 外部二维码核验：总部后台首版入口，保存来源页面快照并只核验前 8 位
import type { ExternalVerificationResult } from '#shared/types/external-verification'
import { extractTraceCode, isHttpUrl } from '#shared/utils/trace-code'

definePageMeta({ layout: 'admin', middleware: 'backend-guard' })
useHead({ title: '外部二维码核验' })

const { canWrite } = useUser()
const toast = useToast()
const sourceUrl = ref('')
const code = ref('')
const pageText = ref('')
const busy = ref(false)
const result = ref<ExternalVerificationResult | null>(null)
const showScanner = ref(false)
const videoRef = ref<HTMLVideoElement | null>(null)
const { phase, errorMsg, mount, start, stop, onResult, onRawResult } = useQrScanner()

const sampleUrl = 'http://www.wla1.cn/p?id=12618401501000000000003780168217'

const verify = async () => {
  if (!canWrite.value) return
  if (!sourceUrl.value.trim() && !code.value.trim() && !pageText.value.trim()) {
    toast.add({ title: '请粘贴外部二维码链接、32位追溯码，或来源页面内容', color: 'warning' })
    return
  }
  busy.value = true
  try {
    result.value = await $fetch<ExternalVerificationResult>('/api/admin/external-verify', { method: 'POST', body: { sourceUrl: sourceUrl.value.trim(), code: code.value.trim(), pageText: pageText.value.trim() } })
    toast.add({ title: result.value.overallStatus === 'mismatch' ? '核验完成，发现信息差异' : '核验完成', color: result.value.overallStatus === 'mismatch' ? 'warning' : 'success' })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '核验失败', color: 'error' })
  } finally { busy.value = false }
}

const useSample = () => { sourceUrl.value = sampleUrl; code.value = '' }

/**
 * 扫码结果落地：能从内容里提取到码就填「追溯码」，内容本身是网址再顺带填「来源链接」。
 * 两个回调都必须接：扫到「纯 32 位裸码」时 useQrScanner 会按「本站码」走 onResult 分支，
 * 此前本页只注册了 onRawResult —— 于是相机停了、页面却毫无反应（不报错、不填值、不提示）。
 */
const applyScan = (raw: string) => {
  const text = String(raw || '').trim()
  const scannedCode = extractTraceCode(text)
  const scannedUrl = isHttpUrl(text) ? text : ''
  code.value = scannedCode
  sourceUrl.value = scannedUrl
  showScanner.value = false
  if (scannedCode && scannedUrl) toast.add({ title: '已识别：来源链接与追溯码均已填入，点击开始核验', color: 'success' })
  else if (scannedCode) toast.add({ title: '已识别二维码中的追溯码，点击开始核验', color: 'success' })
  else if (scannedUrl) toast.add({ title: '已填入来源链接，但链接里没有追溯码，请手动补充码值', color: 'warning' })
  else toast.add({ title: '该二维码里没有识别到追溯码，请手动粘贴来源页面内容', color: 'warning' })
}

onMounted(() => mount(videoRef.value))
onBeforeUnmount(() => stop())
onResult((raw) => applyScan(raw))
onRawResult((raw) => applyScan(raw))
watch(showScanner, async (open) => { if (open) { await nextTick(); mount(videoRef.value); await start() } else stop() })
const statusText: Record<string, string> = { match: '信息相符', mismatch: '发现差异', insufficient: '资料不足', 'not-applicable': '不适用' }
const statusClass: Record<string, string> = { match: 'b-tag-success', mismatch: 'b-tag-danger', insufficient: 'b-tag-warning', 'not-applicable': 'b-tag-default' }
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="b-page-title">外部二维码核验</h1>
      <p class="b-page-desc">扫描系统外二维码，获取来源页面信息，并核验单元识别码前 8 位及登记资料。</p>
    </div>

    <div class="b-card space-y-4">
      <div class="b-card-head"><span class="b-card-title">输入外部二维码</span><UButton variant="link" color="neutral" size="xs" @click="useSample">填入示例链接</UButton></div>
      <div class="grid gap-4 lg:grid-cols-2">
        <div>
          <label class="b-label">外部扫码链接</label>
          <UInput v-model="sourceUrl" placeholder="例如 http://www.wla1.cn/p?id=..." />
          <a
            v-if="sourceUrl.trim().startsWith('http')"
            :href="sourceUrl.trim()"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-1 inline-block text-xs text-primary underline"
          >在新窗口打开来源页面（便于复制内容）</a>
        </div>
        <div><label class="b-label">或直接输入追溯码</label><UInput v-model="code" placeholder="至少32位数字" class="font-code" /></div>
      </div>
      <div>
        <label class="b-label">粘贴来源页面内容（可选 · 供纯脚本渲染的外部平台使用）</label>
        <UTextarea
          v-model="pageText"
          :rows="4"
          class="w-full"
          placeholder="部分外部平台的页面由脚本异步渲染，服务端抓不到正文。请在浏览器打开该二维码链接，把页面上的「基本信息 / 产品信息」整段文字复制到这里 —— 解析走通用规则，不区分平台。"
        />
        <p class="mt-1 text-xs text-muted">填写后会优先使用你粘贴的内容（比服务端抓取结果更完整）。</p>
      </div>
      <p class="text-xs text-muted">仅核验第1—8位：登记类别、登记证号后六位、生产类型。第9位以后保留原码但不参与判定；规格、生产日期等只展示来源页面提供的内容。</p>
      <UButton v-if="canWrite" color="primary" :loading="busy" icon="i-lucide-search-check" @click="verify">开始核验</UButton>
      <UButton v-if="canWrite" variant="outline" color="neutral" icon="i-lucide-camera" @click="showScanner = true">扫描外部二维码</UButton>
    </div>

    <div v-if="showScanner" class="b-card">
      <div class="flex items-center justify-between"><span class="b-card-title">扫描外部二维码</span><UButton size="xs" variant="ghost" color="neutral" @click="showScanner = false">关闭</UButton></div>
      <video ref="videoRef" autoplay muted playsinline class="mt-3 aspect-video w-full rounded-lg bg-black object-cover" />
      <p v-if="errorMsg" class="mt-2 text-sm text-error">{{ errorMsg }}</p>
      <p v-else class="mt-2 text-xs text-muted">{{ phase === 'scanning' ? '请将二维码放入取景框' : '正在启动相机…' }}</p>
      <p class="mt-2 text-xs text-muted">支持任意平台的二维码：识别到追溯码会自动填入码值框，识别到链接会填入来源链接框。</p>
    </div>

    <div v-if="result" class="space-y-4">
      <div class="b-card">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div><div class="text-sm text-muted">核验结论</div><div class="mt-1 text-xl font-semibold">{{ result.overallStatus === 'mismatch' ? '发现信息差异' : result.overallStatus === 'match' ? '已核验项目未发现差异' : '部分资料不足，无法完全判断' }}</div></div>
          <span class="b-tag" :class="statusClass[result.overallStatus]">{{ statusText[result.overallStatus] }}</span>
        </div>
        <div class="mt-4 grid gap-3 text-sm md:grid-cols-4">
          <div><span class="text-muted">来源平台</span><div class="mt-1 font-medium">{{ result.source.platform }}</div></div>
          <div><span class="text-muted">完整码长度</span><div class="mt-1 font-code font-medium">{{ result.codeParts.length }} 位</div></div>
          <div><span class="text-muted">编码前8位</span><div class="mt-1 font-code font-medium">{{ result.source.code.slice(0, 8) }}</div></div>
          <div><span class="text-muted">生产类型</span><div class="mt-1 font-medium">{{ result.codeParts.productionTypeLabel }}</div></div>
        </div>
      </div>

      <div class="b-card b-card-clip">
        <div class="b-card-head"><span class="b-card-title">逐项核验结果</span></div>
        <div class="b-scroll-x"><table class="b-table"><thead><tr><th>核验项目</th><th>结果</th><th>来源页面</th><th>登记资料 / 参考值</th><th>说明</th></tr></thead><tbody>
          <tr v-for="item in result.items" :key="item.key"><td class="font-medium">{{ item.label }}</td><td><span class="b-tag" :class="statusClass[item.status]">{{ statusText[item.status] }}</span></td><td>{{ item.sourceValue || '未提供' }}</td><td>{{ item.referenceValue || '未确定' }}</td><td class="text-xs text-muted">{{ item.reason }}</td></tr>
        </tbody></table></div>
      </div>

      <div class="b-card">
        <div class="b-card-head"><span class="b-card-title">来源页面数据（只展示，不参与本轮真实性判定）</span></div>
        <div class="grid gap-3 text-sm md:grid-cols-3">
          <div><span class="text-muted">产品名称</span><div class="mt-1">{{ result.source.productName || '来源页面未提供' }}</div></div>
          <div><span class="text-muted">规格</span><div class="mt-1">{{ result.source.spec || '来源页面未提供' }}</div></div>
          <div><span class="text-muted">生产日期</span><div class="mt-1">{{ result.source.produceDate || '来源页面未提供' }}</div></div>
          <div><span class="text-muted">生产批次</span><div class="mt-1">{{ result.source.batchNo || '来源页面未提供' }}</div></div>
          <div><span class="text-muted">登记证号</span><div class="mt-1 font-code">{{ result.source.registrationNo || '来源页面未提供' }}</div></div>
          <div><span class="text-muted">剂型</span><div class="mt-1">{{ result.source.formulation || '来源页面未提供' }}</div></div>
          <div><span class="text-muted">毒性</span><div class="mt-1">{{ result.source.toxicity || '来源页面未提供' }}</div></div>
          <div><span class="text-muted">有效期至</span><div class="mt-1">{{ result.source.expireDate || '来源页面未提供' }}</div></div>
          <div><span class="text-muted">来源链接</span><div class="mt-1 max-w-full truncate" :title="result.source.sourceUrl">{{ result.source.sourceUrl || '未提供' }}</div></div>
        </div>
      </div>
    </div>
  </div>
</template>
