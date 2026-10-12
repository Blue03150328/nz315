/** 下载单次外部采集的原始码清单，文件内容由服务器按批次范围生成。 */
export function useExternalCollectionExport() {
  const downloading = ref(false)
  const toast = useToast()
  async function download(batchId: string, format: 'csv' | 'txt') {
    if (downloading.value) return
    downloading.value = true
    try {
      const response = await fetch(`/api/admin/external-collections/${encodeURIComponent(batchId)}/export?format=${format}`)
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        throw new Error(result.statusMessage || '下载未完成，请重试')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `外部溯源码_${batchId}.${format}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      // 给浏览器留出读取下载对象的时间，随后释放内存。
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.add({ title: `已开始下载 ${format.toUpperCase()} 文件`, color: 'success' })
    } catch (error: any) {
      toast.add({ title: error?.message || '下载未完成，请重试', color: 'error' })
    } finally {
      downloading.value = false
    }
  }
  return { downloading, download }
}
