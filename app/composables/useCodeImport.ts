import type { ImportResult, CodeImportPreview } from '#shared/types/import-report'

// 上传流程的请求状态集中管理；网络重试复用标识，内容或批次变更则作为新提交。
export function useCodeImport() {
  const parsing = ref(false)
  const importing = ref(false)
  const parseResult = ref<CodeImportPreview | null>(null)
  const lastResult = ref<ImportResult | null>(null)
  let requestKey = ''
  let previousPayload = ''
  const parse = async (content: string, fileName: string) => {
    parsing.value = true
    try {
      parseResult.value = await $fetch<CodeImportPreview>('/api/admin/codes/parse', { method: 'POST', body: { content, fileName, includeCodes: false } })
      requestKey = ''; previousPayload = ''
    } finally { parsing.value = false }
  }
  const submit = async (body: Record<string, unknown>) => {
    if (importing.value) return null
    const payload = JSON.stringify(body)
    if (!requestKey || previousPayload !== payload) {
      requestKey = crypto.randomUUID()
      previousPayload = payload
    }
    importing.value = true
    try {
      lastResult.value = await $fetch<ImportResult>('/api/admin/codes/import', { method: 'POST', body: { ...body, requestKey } })
      return lastResult.value
    } finally { importing.value = false }
  }
  const reset = () => { parseResult.value = null; requestKey = ''; previousPayload = '' }
  return { parsing, importing, parseResult, lastResult, parse, submit, reset }
}
