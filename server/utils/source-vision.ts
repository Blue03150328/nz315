// 外部动态页面的视觉兜底：浏览器截图后交给 DeepSeek 视觉模型提取字段。
// 这是可选能力。未配置密钥或 Playwright 时直接返回 null，不影响原有抓取链路。
import type { SourceDeclaration } from '../../shared/types/source-snapshot'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

type VisionField = { value?: unknown; confidence?: unknown }
type VisionResult = {
  pageCode?: VisionField
  productName?: VisionField
  commodityName?: VisionField
  registrationNo?: VisionField
  holderName?: VisionField
  manufacturer?: VisionField
  formulation?: VisionField
  toxicity?: VisionField
  content?: VisionField
  ingredients?: VisionField
  spec?: VisionField
  produceDate?: VisionField
  batchNo?: VisionField
  productExpiry?: VisionField
  originals?: Array<{ ingredient?: VisionField; regNo?: VisionField; company?: VisionField }>
}

const text = (field: VisionField | undefined, min = 0.72) => {
  const value = String(field?.value ?? '').trim()
  const confidence = Number(field?.confidence ?? 0)
  return value && Number.isFinite(confidence) && confidence >= min ? value : undefined
}

function platformOf(url: string): string {
  try { return new URL(url).hostname } catch { return '' }
}

function parseJson(content: string): VisionResult {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const parsed = JSON.parse(cleaned) as VisionResult
  if (!parsed || typeof parsed !== 'object') throw new Error('视觉模型返回格式无效')
  return parsed
}

function declarationFrom(result: VisionResult, sourceUrl: string, code: string): SourceDeclaration | null {
  const originals = (Array.isArray(result.originals) ? result.originals : []).slice(0, 50).map(item => ({
    ingredient: text(item.ingredient),
    regNo: text(item.regNo) || '',
    company: text(item.company) || '',
  })).filter(item => item.ingredient || item.regNo || item.company)
  const source: SourceDeclaration = {
    sourceUrl,
    platform: platformOf(sourceUrl),
    code,
    pageCode: text(result.pageCode),
    productName: text(result.productName),
    commodityName: text(result.commodityName),
    registrationNo: text(result.registrationNo),
    holderName: text(result.holderName),
    manufacturer: text(result.manufacturer),
    formulation: text(result.formulation),
    toxicity: text(result.toxicity),
    content: text(result.content),
    ingredients: text(result.ingredients),
    spec: text(result.spec),
    produceDate: text(result.produceDate),
    batchNo: text(result.batchNo),
    productExpiry: text(result.productExpiry),
    productFields: [],
    originals,
  }
  if (!source.productName && !source.commodityName && !source.registrationNo && !source.holderName && !originals.length) return null
  const labels: Array<[string, string | undefined]> = [
    ['产品名称', source.productName], ['商品名称', source.commodityName], ['登记证号', source.registrationNo],
    ['登记证持有人', source.holderName], ['剂型', source.formulation], ['毒性', source.toxicity],
    ['含量', source.content], ['规格', source.spec], ['生产日期', source.produceDate],
    ['生产批次', source.batchNo], ['有效期至', source.productExpiry],
  ]
  source.productFields = labels.filter(([, value]) => value).map(([label, value]) => ({ label, value: value! }))
  return source
}

/** 使用浏览器渲染外部页面，再用 DeepSeek 视觉模型提取可核验字段。 */
export async function extractSourceByVision(sourceUrl: string, code: string): Promise<{ source: SourceDeclaration; document: string } | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey || process.env.DEEPSEEK_VISION_ENABLED === '0') return null
  let workDir = ''
  try {
    // 优先使用环境变量；Windows 开发机默认尝试 Chrome 和 Edge。
    const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH?.trim() ||
      (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'chromium')
    workDir = await mkdtemp(join(tmpdir(), 'nz315-vision-'))
    const imagePath = join(workDir, 'page.png')
    // Chrome 自带 headless 截图能力，给页面 5 秒执行 XHR 和渲染脚本。
    await execFileAsync(executablePath, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--window-size=1440,1600', '--virtual-time-budget=5000', `--screenshot=${imagePath}`, sourceUrl,
    ], { timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 })
    const image = await readFile(imagePath)
    if (image.length > 8 * 1024 * 1024) throw new Error('来源页面截图超过大小限制')
    const base64 = image.toString('base64')
    const endpoint = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '') + '/chat/completions'
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model: process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash',
        temperature: 0,
        max_tokens: 1800,
        messages: [{ role: 'user', content: [
          { type: 'text', text: `你是农药追溯资料提取器。只读取截图中明确显示的文字，不要猜测，不要补全，不要把页面固定说明当成产品数据。所有字段用“值+置信度”返回，置信度为0到1。找不到就返回空值和0。只输出严格 JSON，不要 Markdown。结构：{"pageCode":{"value":"","confidence":0},"productName":{"value":"","confidence":0},"commodityName":{"value":"","confidence":0},"registrationNo":{"value":"","confidence":0},"holderName":{"value":"","confidence":0},"manufacturer":{"value":"","confidence":0},"formulation":{"value":"","confidence":0},"toxicity":{"value":"","confidence":0},"content":{"value":"","confidence":0},"ingredients":{"value":"","confidence":0},"spec":{"value":"","confidence":0},"produceDate":{"value":"","confidence":0},"batchNo":{"value":"","confidence":0},"productExpiry":{"value":"","confidence":0},"originals":[{"ingredient":{"value":"","confidence":0},"regNo":{"value":"","confidence":0},"company":{"value":"","confidence":0}}]}` },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}`, detail: 'original' } },
        ] }] })
    })
    if (!response.ok) throw new Error(`视觉模型请求失败（HTTP ${response.status}）`)
    const payload = await response.json() as any
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('视觉模型未返回文本结果')
    const source = declarationFrom(parseJson(content), sourceUrl, code)
    return source ? { source, document: '[视觉模型截图提取]' } : null
  } catch {
    return null
  } finally { if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined) }
}
