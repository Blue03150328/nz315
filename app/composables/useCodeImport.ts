import type { ImportResult, CodeImportPreview } from '#shared/types/code-import'

// 上传流程的请求状态集中管理，提交中的请求不重复发送。
export function useCodeImport() {
  const parsing = ref(false)
  const importing = ref(false)
  const parseResult = ref<CodeImportPreview | null>(null)
  const lastResult = ref<ImportResult | null>(null)
  let parseSequence = 0
  const parse = async (content: string, fileName: string, productId?: number | null) => {
    const sequence = ++parseSequence
    parsing.value = true
    try {
      const result = await $fetch<CodeImportPreview>('/api/admin/codes/parse', { method: 'POST', body: { content, fileName, productId: productId ?? undefined, includeCodes: false } })
      if (sequence === parseSequence) parseResult.value = result
    } finally { if (sequence === parseSequence) parsing.value = false }
  }
  const submit = async (body: Record<string, unknown>) => {
    if (importing.value) return null
    importing.value = true
    try {
      lastResult.value = await $fetch<ImportResult>('/api/admin/codes/import', { method: 'POST', body })
      return lastResult.value
    } finally { importing.value = false }
  }
  const reset = () => { parseSequence++; parsing.value = false; parseResult.value = null }
  return { parsing, importing, parseResult, lastResult, parse, submit, reset }
}
