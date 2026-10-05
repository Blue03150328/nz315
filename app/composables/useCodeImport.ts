import type { ImportResult, CodeImportPreview } from '#shared/types/code-import'

// 上传流程的请求状态集中管理，提交中的请求不重复发送。
export function useCodeImport() {
  const parsing = ref(false)
  const importing = ref(false)
  const parseResult = ref<CodeImportPreview | null>(null)
  const lastResult = ref<ImportResult | null>(null)
  const parse = async (content: string, fileName: string) => {
    parsing.value = true
    try {
      parseResult.value = await $fetch<CodeImportPreview>('/api/admin/codes/parse', { method: 'POST', body: { content, fileName, includeCodes: false } })
    } finally { parsing.value = false }
  }
  const submit = async (body: Record<string, unknown>) => {
    if (importing.value) return null
    importing.value = true
    try {
      lastResult.value = await $fetch<ImportResult>('/api/admin/codes/import', { method: 'POST', body })
      return lastResult.value
    } finally { importing.value = false }
  }
  const reset = () => { parseResult.value = null }
  return { parsing, importing, parseResult, lastResult, parse, submit, reset }
}
