// 追溯码扫码核心逻辑（公众端 /scan 扫码页专用）
// 能力分层：
//   1. 原生 BarcodeDetector（Android Chrome / iOS Safari 17+ 等）——性能最佳；
//   2. @zxing/library 逐帧兜底解码（依赖已存在，服务端同库生成 DM 码）——仅当 BarcodeDetector 不可用/失败时按需懒加载；
// 约束：
//   - 网页调起摄像头必须 HTTPS（或 localhost）且由用户手势触发（iOS 强制）；
//   - 微信内置浏览器（尤其 iOS）不允许网页使用相机，此时不请求权限、直接给出引导文案；
//   - 识别结果只接受「32 位纯数字追溯码」或「含 /trace?code= 的追溯 URL」，其余二维码一律忽略继续扫描；
//   - 全程中文文案，符合用户全局偏好。

export type ScannerPhase =
  | 'idle'            // 尚未请求权限（等待用户点击开启）
  | 'starting'        // 正在请求相机权限
  | 'scanning'        // 取景识别中
  | 'error'           // 相机启动失败（权限拒绝/无摄像头/微信内等）
  | 'unsupported'     // 当前环境根本不支持网页相机
  | 'success'         // 已识别到追溯码（短暂停留后由页面跳转）

const FRAME_GAP_MS = 180      // 相邻两次解码的最小间隔（毫秒），兼顾流畅与耗电
const MAX_FRAME_SIDE = 960    // 截帧画布最长边上限：太大拖慢 zxing 兜底解码

// 识别结果 → 追溯码：接受纯 32 位数字，或追溯 URL（PRD 3.3 格式，含 /trace?code=）
const traceCodeOf = (text: string): string | null => {
  const t = (text || '').trim()
  if (/^\d{32}$/.test(t)) return t
  const m = t.match(/trace\?code=(\d{32})/)
  return m ? (m[1] ?? null) : null
}

// 是否运行在微信内置浏览器（微信内网页摄像头受限，需单独引导）
const isWechatUA = (): boolean => /MicroMessenger/i.test(navigator.userAgent)

export const useQrScanner = () => {
  const phase = ref<ScannerPhase>('idle')
  const errorMsg = ref('')
  const isWechat = ref(false)

  // 取景视频元素（由页面 <video> 传入，便于模板控制显示/隐藏）
  let videoEl: HTMLVideoElement | null = null
  let stream: MediaStream | null = null
  let canvasEl: HTMLCanvasElement | null = null
  let rafId = 0
  let lastDecodeAt = 0
  let stopped = true
  let decoding = false   // 帧解码进行中标记（防并发重入）
  let resultCb: ((code: string) => void) | null = null
  // 原生扫码器实例（惰性创建；能力不足时为 null 走 zxing 兜底）
  let nativeDetector: any = null

  /** 挂载视频元素并初始化环境检测（页面 onMounted 时调用一次） */
  const mount = (video: HTMLVideoElement | null) => {
    videoEl = video
    if (!import.meta.client) return
    isWechat.value = isWechatUA()
  }

  /** 注册识别成功回调（页面用于跳转 /trace?code=） */
  const onResult = (cb: (code: string) => void) => { resultCb = cb }

  // 创建原生 BarcodeDetector（QR + DM），能力不足返回 false
  const ensureNativeDetector = async (): Promise<boolean> => {
    const BD = (window as any).BarcodeDetector
    if (!BD) return false
    if (nativeDetector) return true
    try {
      nativeDetector = new BD({ formats: ['qr_code', 'data_matrix'] })
    } catch {
      try { nativeDetector = new BD() } catch { nativeDetector = null }
    }
    return !!nativeDetector
  }

  /** 单帧解码：BarcodeDetector 优先，zxing 兜底；返回识别到的追溯码或 null */
  const decodeCanvas = async (cv: HTMLCanvasElement): Promise<string | null> => {
    // 原生优先
    if (await ensureNativeDetector()) {
      try {
        const res = await nativeDetector.detect(cv)
        for (const hit of res || []) {
          const code = traceCodeOf(hit.rawValue)
          if (code) return code
        }
      } catch { /* 该实现不支持 canvas 输入等 → 走 zxing 兜底 */ }
    }
    // zxing 兜底（动态 import：仅在需要时打入客户端分包）
    // 实测 HybridBinarizer 对特定图像宽度存在「解不出」相位（520/600px 失败而相邻宽度成功），
    // 故按 1x / 0.8x / 0.6x 多尺度重试，直到解出或全部失败。
    const zx = await import('@zxing/library')
    for (const factor of [1, 0.8, 0.6]) {
      const text = await zxingDecodeOnce(zx, cv, factor)
      if (text) {
        const code = traceCodeOf(text)
        if (code) return code
      }
    }
    return null
  }

  /** 单尺度 zxing 解码：factor 为缩放比例（1=原图），返回二维码文本或 null */
  const zxingDecodeOnce = async (zx: any, cv: HTMLCanvasElement, factor: number): Promise<string | null> => {
    const w = Math.max(2, Math.round(cv.width * factor / 2) * 2)
    const h = Math.max(2, Math.round(cv.height * factor / 2) * 2)
    const src = factor === 1 ? cv : cv
    const work = factor === 1 ? cv : document.createElement('canvas')
    if (factor !== 1) {
      work.width = w
      work.height = h
      const wctx = work.getContext('2d', { willReadFrequently: true })
      if (!wctx) return null
      wctx.drawImage(src, 0, 0, w, h)
    }
    const ctx = work.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    const img = ctx.getImageData(0, 0, w, h)
    // RGBA → 灰度（亮度源要求一像素一字节）
    const lum = new Uint8ClampedArray(w * h)
    const d = img.data
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      // noUncheckedIndexedAccess：数组索引可能为 undefined，用 ?? 0 兜底（实际不会发生）
      lum[p] = ((d[i] ?? 0) * 299 + (d[i + 1] ?? 0) * 587 + (d[i + 2] ?? 0) * 114) / 1000
    }
    try {
      const source = new zx.RGBLuminanceSource(lum, w, h)
      const bitmap = new zx.BinaryBitmap(new zx.HybridBinarizer(source))
      const hints = new Map()
      hints.set(zx.DecodeHintType.TRY_HARDER, true)
      // 显式按 QR → DataMatrix 顺序尝试：不用 MultiFormatReader——
      // 其内部对每个失败的 reader 打 console.warn，相机逐帧解码失败时会刷屏（解码失败是本路径预期，不应有噪音）
      const readers = [new zx.QRCodeReader(), new zx.DataMatrixReader()]
      for (const reader of readers) {
        try {
          const result = reader.decode(bitmap, hints)
          if (result) return result.getText()
        } catch { /* 该格式未命中，尝试下一种 */ }
      }
      return null
    } catch { return null }
  }

  // 截取视频当前帧到画布（限宽保证解码速度）
  const grabFrame = (): HTMLCanvasElement | null => {
    if (!videoEl || !videoEl.videoWidth) return null
    if (!canvasEl) canvasEl = document.createElement('canvas')
    const vw = videoEl.videoWidth
    const vh = videoEl.videoHeight
    const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(vw, vh))
    const w = Math.max(2, Math.round(vw * scale / 2) * 2)
    const h = Math.max(2, Math.round(vh * scale / 2) * 2)
    if (canvasEl.width !== w) canvasEl.width = w
    if (canvasEl.height !== h) canvasEl.height = h
    const ctx = canvasEl.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(videoEl, 0, 0, w, h)
    return canvasEl
  }

  // 解码循环（RAF 节流 + 防重入：上一帧解码未完成时跳过，避免并发叠加）
  const loop = async () => {
    if (stopped || phase.value !== 'scanning' || decoding) return
    rafId = requestAnimationFrame(loop)
    const now = Date.now()
    if (now - lastDecodeAt < FRAME_GAP_MS) return
    lastDecodeAt = now
    const cv = grabFrame()
    if (!cv) return
    decoding = true
    try {
      const code = await decodeCanvas(cv)
      if (code) {
        hitCode(code)
        return
      }
      // 非追溯码内容静默忽略，继续扫描
    } finally {
      decoding = false
    }
  }

  // 识别命中：停循环、释放相机、回调页面
  const hitCode = (code: string) => {
    stopLoop()
    stopStream()
    phase.value = 'success'
    if (resultCb) resultCb(code)
  }

  const stopLoop = () => {
    stopped = true
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
  }

  const stopStream = () => {
    if (stream) {
      stream.getTracks().forEach(t => t.stop())
      stream = null
    }
    if (videoEl) videoEl.srcObject = null
  }

  /** 停止扫码并释放相机（页面卸载/离开时调用） */
  const stop = () => {
    stopLoop()
    stopStream()
    if (phase.value === 'scanning' || phase.value === 'starting') phase.value = 'idle'
  }

  // 相机权限错误 → 中文提示
  const errText = (e: any): string => {
    const name = String(e?.name || '')
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return '未获得相机权限，请在浏览器地址栏允许使用相机后重试'
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '未检测到可用摄像头'
    if (name === 'NotReadableError') return '摄像头被其他应用占用，请关闭后重试'
    if (name === 'OverconstrainedError') return '摄像头不满足扫码要求，请重试'
    return '相机启动失败，请检查浏览器是否支持扫码'
  }

  /** 启动相机扫码（须由用户点击触发） */
  const start = async (): Promise<void> => {
    if (!import.meta.client || !videoEl) return
    if (phase.value === 'starting' || phase.value === 'scanning') return
    // 环境预检
    if (!window.isSecureContext) {
      phase.value = 'error'
      errorMsg.value = '扫码需在 HTTPS 安全页面使用（本地测试可用 http://localhost）'
      return
    }
    const md = navigator.mediaDevices
    if (!md || !md.getUserMedia) {
      phase.value = 'unsupported'
      return
    }
    phase.value = 'starting'
    errorMsg.value = ''
    try {
      stream = await md.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      if (!videoEl) { stopStream(); return }
      videoEl.srcObject = stream
      // 等待首帧可绘制后再进入取景循环
      await new Promise<void>((resolve) => {
        const t0 = Date.now()
        const chk = () => {
          if (videoEl && videoEl.videoWidth > 0) resolve()
          else if (Date.now() - t0 > 8000) resolve() // 超时兜底（仍会尝试取帧）
          else setTimeout(chk, 120)
        }
        chk()
      })
      stopped = false
      lastDecodeAt = 0
      phase.value = 'scanning'
      rafId = requestAnimationFrame(loop)
    } catch (e: any) {
      phase.value = 'error'
      errorMsg.value = errText(e)
    }
  }

  /** 相册/拍照选图识别：返回追溯码（非追溯二维码返回 null），全环境可用（含 iOS 微信） */
  const decodeImageFile = (file: File): Promise<string | null> => {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = async () => {
        try {
          // 限长边 1280 防止超大原图卡死
          const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight))
          const w = Math.max(2, Math.round(img.naturalWidth * scale))
          const h = Math.max(2, Math.round(img.naturalHeight * scale))
          const cv = document.createElement('canvas')
          cv.width = w
          cv.height = h
          const ctx = cv.getContext('2d', { willReadFrequently: true })
          if (!ctx) { resolve(null); return }
          // 现代浏览器 drawImage 会自动应用照片 EXIF 方向
          ctx.drawImage(img, 0, 0, w, h)
          const code = await decodeCanvas(cv)
          resolve(code)
        } catch { resolve(null) }
        finally { URL.revokeObjectURL(url) }
      }
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
      img.src = url
    })
  }

  return {
    phase,
    errorMsg,
    isWechat,
    mount,
    start,
    stop,
    onResult,
    decodeImageFile,
  }
}

export { traceCodeOf }