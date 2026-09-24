<script setup lang="ts">
// 公众端扫码页 /scan：真正的「扫一扫」——相机取景实时识别（取代原首页仅聚焦输入框的占位入口）
// 能力分层（见 useQrScanner）：BarcodeDetector 优先 → zxing 兜底；另提供「相册选图」与「手动输入」降级，
// 微信内置浏览器（iOS 无法网页调起相机）自动展示引导文案。
// 识别命中后跳转 /trace?code={码}（SSR 秒开查询，与扫码 URL 官方格式一致）。
import { useQrScanner } from '~/composables/useQrScanner'
import { extractTraceCode } from '#shared/utils/trace-code'
import { isHttpUrl } from '#shared/utils/trace-code'

definePageMeta({ layout: 'fullbleed' })
useHead({ title: '扫码查询' })

const router = useRouter()
const toast = useToast()
const videoRef = ref<HTMLVideoElement | null>(null)
const fileRef = ref<HTMLInputElement | null>(null)
const manualOpen = ref(false)      // 手动输入区展开开关
const manualCode = ref('')
const decodingImage = ref(false)   // 相册图片解析中
const lastRejected = ref('')       // 上一次已提示过「不含追溯码」的二维码内容（防同一张码反复弹提示）

const { phase, errorMsg, isWechat, mount, start, stop, onResult, onRawResult, decodeImageFile } = useQrScanner()

onMounted(() => { mount(videoRef.value) })
// 页面销毁时释放相机与解码循环（防摄像头指示灯常亮/占用）
onBeforeUnmount(() => { stop() })

// 三种入口共用原始内容处理，完整保存来源网址（包括短链接）。
const navigateRaw = (raw: string) => {
  const code = extractTraceCode(raw)
  if (!/^\d{32}$/.test(code) && !isHttpUrl(raw)) return false
  const query = new URLSearchParams({ code })
  if (isHttpUrl(raw)) query.set('source', raw.trim())
  router.push('/trace?' + query.toString())
  return true
}
onResult((code, raw) => { navigateRaw(raw || code) })
onRawResult((raw) => {
  if (navigateRaw(raw)) return
  if (raw !== lastRejected.value) toast.add({ title: '未识别到追溯码或查询网址', color: 'warning' })
  lastRejected.value = raw
  start()
})

const goBack = () => { router.back() }
const isScanning = computed(() => phase.value === 'scanning')
const busy = computed(() => phase.value === 'starting' || decodingImage.value)

// 相册/拍照选图识别（全环境可用，iOS 微信内的可行扫码路径）
const pickImage = () => {
  stop() // 若相机开着先释放（选图会打断取景）
  fileRef.value?.click()
}
const onFileChange = async (e: Event) => {
  const input = e.target as HTMLInputElement
  const file = input.files && input.files[0]
  if (!file) return
  decodingImage.value = true
  try {
    const code = await decodeImageFile(file, true)
    if (code) {
      toast.add({ title: '识别成功，正在查询', color: 'success' })
      navigateRaw(code)
    } else {
      toast.add({ title: '未识别到追溯码', description: '请确认图片中包含清晰的农药追溯二维码（可稍近拍摄）', color: 'warning' })
    }
  } finally {
    decodingImage.value = false
    input.value = '' // 允许重复选择同一张图片
  }
}

// 手动输入查询
const submitManual = () => {
  const code = manualCode.value.trim()
  if (!code) {
    toast.add({ title: '请输入32位追溯码', color: 'warning' })
    return
  }
  if (!navigateRaw(code)) toast.add({ title: '请输入32位追溯码或完整查询网址', color: 'warning' })

}
</script>

<template>
  <div class="relative flex h-dvh flex-col overflow-hidden bg-[#0c0f0d] text-white">
    <!-- 相机取景画面（仅扫描中显示，object-cover 铺满） -->
    <video
      v-show="isScanning"
      ref="videoRef"
      autoplay
      muted
      playsinline
      class="absolute inset-0 h-full w-full object-cover"
    />

    <!-- 取景遮罩与扫描框（扫描中显示） -->
    <template v-if="isScanning">
      <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div class="scan-frame relative h-[min(62dvh,360px)] w-[min(62dvh,360px)]">
          <!-- 四角标 -->
          <span class="absolute -left-1 -top-1 h-9 w-9 rounded-tl-xl border-l-4 border-t-4 border-emerald-400" />
          <span class="absolute -right-1 -top-1 h-9 w-9 rounded-tr-xl border-r-4 border-t-4 border-emerald-400" />
          <span class="absolute -bottom-1 -left-1 h-9 w-9 rounded-bl-xl border-b-4 border-l-4 border-emerald-400" />
          <span class="absolute -bottom-1 -right-1 h-9 w-9 rounded-br-xl border-b-4 border-r-4 border-emerald-400" />
          <!-- 扫描线动画 -->
          <span class="scanline" />
        </div>
      </div>
      <!-- 顶部提示（渐变压暗保证可读） -->
      <div class="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-4 pb-10 pt-[calc(env(safe-area-inset-top)+12px)] text-center">
        <p class="text-sm text-white/90">将农药包装上的追溯二维码对准取景框</p>
      </div>
    </template>

    <!-- 非扫描状态：中央状态卡片 -->
    <div v-else class="absolute inset-0 flex flex-col items-center justify-center px-8">
      <div class="w-full max-w-sm rounded-2xl bg-white/5 p-6 text-center ring-1 ring-white/10 backdrop-blur-sm">
        <!-- 开启前引导 -->
        <template v-if="phase === 'idle'">
          <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-400/15">
            <UIcon name="i-lucide-scan-line" class="h-8 w-8 text-emerald-400" />
          </div>
          <h2 class="mt-4 text-lg font-semibold">扫码查询农药追溯码</h2>
          <p class="mt-1.5 text-sm leading-relaxed text-white/60">对准瓶身二维码即可查询产品信息、登记证与查询次数</p>
          <button
            type="button"
            class="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 py-3 text-base font-semibold text-emerald-950 transition hover:bg-emerald-300 disabled:opacity-60"
            :disabled="busy"
            @click="start()"
          >
            <UIcon name="i-lucide-camera" class="h-5 w-5" />
            {{ busy ? '正在启动…' : '开启摄像头扫码' }}
          </button>
        </template>

        <!-- 启动中 -->
        <template v-else-if="phase === 'starting'">
          <UIcon name="i-lucide-loader-circle" class="mx-auto h-10 w-10 animate-spin text-emerald-400" />
          <p class="mt-4 text-sm text-white/70">正在启动相机…</p>
        </template>

        <!-- 识别成功 -->
        <template v-else-if="phase === 'success'">
          <UIcon name="i-lucide-check-circle-2" class="mx-auto h-12 w-12 text-emerald-400" />
          <p class="mt-3 text-sm text-white/80">识别成功，正在查询…</p>
        </template>

        <!-- 出错 / 不支持 -->
        <template v-else>
          <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-400/15">
            <UIcon :name="phase === 'unsupported' ? 'i-lucide-circle-alert' : 'i-lucide-camera-off'" class="h-8 w-8 text-amber-400" />
          </div>
          <h2 class="mt-4 text-lg font-semibold">{{ phase === 'unsupported' ? '当前环境不支持相机扫码' : '无法开启相机' }}</h2>
          <p class="mt-1.5 text-sm leading-relaxed text-white/60">{{ errorMsg }}</p>
          <button
            v-if="phase === 'error'"
            type="button"
            class="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 py-3 text-base font-semibold text-emerald-950 transition hover:bg-emerald-300"
            @click="start()"
          >
            <UIcon name="i-lucide-rotate-ccw" class="h-5 w-5" />
            重试
          </button>
        </template>

        <!-- 微信内提示（iOS 微信网页无法调起相机；Android 新版可尝试但失败时同样适用） -->
        <p v-if="isWechat && phase !== 'scanning'" class="mt-4 border-t border-white/10 pt-3 text-xs leading-relaxed text-white/50">
          当前为微信内置浏览器。若无法调起相机，请点右上角「···」选择<b class="text-white/80">在浏览器打开</b>，
          或点击下方「从相册选择」，识别已拍下的码图。
        </p>
      </div>
    </div>

    <!-- 手动输入区（自底部展开） -->
    <div v-if="manualOpen" class="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-20 px-4">
      <form class="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur-md" @submit.prevent="submitManual">
        <p class="mb-2 text-sm text-white/80">手动输入 32 位追溯码</p>
        <div class="flex gap-2">
          <input
            v-model="manualCode"
            type="text"
            inputmode="numeric"
            maxlength="64"
            placeholder="32 位数字追溯码"
            class="min-w-0 flex-1 rounded-lg border border-white/20 bg-black/30 px-3 py-2.5 text-sm text-white placeholder-white/35 outline-none focus:border-emerald-400"
          />
          <button
            type="submit"
            class="shrink-0 rounded-lg bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-emerald-950"
          >查询</button>
        </div>
        <p class="mt-2 text-xs text-white/45">追溯码在农药瓶身二维码旁，通常以数字印刷在标签上</p>
      </form>
    </div>

    <!-- 顶部栏（返回 / 标题 / 相册） -->
    <header class="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-3 pt-[calc(env(safe-area-inset-top)+8px)]">
      <button
        type="button"
        aria-label="返回上一页"
        class="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white ring-1 ring-white/15 backdrop-blur-sm transition hover:bg-black/60"
        @click="goBack"
      >
        <UIcon name="i-lucide-arrow-left" class="h-5 w-5" />
      </button>
      <span class="text-base font-semibold drop-shadow">扫码查询</span>
      <button
        type="button"
        aria-label="从相册选择二维码图片"
        class="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white ring-1 ring-white/15 backdrop-blur-sm transition hover:bg-black/60 disabled:opacity-50"
        :disabled="busy"
        @click="pickImage"
      >
        <UIcon name="i-lucide-image" class="h-5 w-5" />
      </button>
      <!-- 隐藏的相册文件选择框 -->
      <input ref="fileRef" type="file" accept="image/*" class="hidden" @change="onFileChange" />
    </header>

    <!-- 底部工具栏 -->
    <div class="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[calc(env(safe-area-inset-bottom)+14px)] pt-14">
      <div class="flex items-center justify-center gap-3">
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2.5 text-sm text-white ring-1 ring-white/15 backdrop-blur-sm transition hover:bg-white/20 disabled:opacity-50"
          :disabled="busy"
          @click="pickImage"
        >
          <UIcon name="i-lucide-image" class="h-4 w-4" />
          从相册选择
        </button>
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2.5 text-sm text-white ring-1 ring-white/15 backdrop-blur-sm transition hover:bg-white/20"
          @click="manualOpen = !manualOpen"
        >
          <UIcon :name="manualOpen ? 'i-lucide-chevron-down' : 'i-lucide-keyboard'" class="h-4 w-4" />
          手动输入
        </button>
      </div>
      <p v-if="isScanning" class="mt-3 text-center text-xs text-white/55">
        识别到 32 位追溯码即自动查询；其它二维码会给出提示，不会自动跳转
      </p>
    </div>
  </div>
</template>

<style scoped>
/* 取景框：四角内侧高亮、框外压暗（大 box-shadow 技巧，无需额外遮罩层） */
.scan-frame {
  border-radius: 1rem;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.38);
}
/* 扫描线：上下往复移动（移动端 GPU 合成，纯 CSS 无 JS 开销） */
.scanline {
  position: absolute;
  left: 10px;
  right: 10px;
  height: 2px;
  border-radius: 9999px;
  background: linear-gradient(90deg, transparent, #34d399, transparent);
  box-shadow: 0 0 12px 2px rgba(52, 211, 153, 0.55);
  animation: scan-move 2.4s ease-in-out infinite;
}
@keyframes scan-move {
  0%, 100% { top: 12px; }
  50% { top: calc(100% - 14px); }
}
</style>
