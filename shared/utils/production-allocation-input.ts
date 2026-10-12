/** 领用来源由服务器解析具体码，不允许把数量当作任意码清单。 */
export function productionAllocationInput(body: Record<string, any>) {
  const sourceTaskId = Number(body.sourceTaskId || 0)
  const sourceUploadBatchId = Number(body.sourceUploadBatchId || 0)
  const quantity = Number(body.quantity || 0)
  const codes = [...new Set((Array.isArray(body.codes) ? body.codes : String(body.content || '').split(/\r?\n/)).map((v: unknown) => String(v).trim()).filter(Boolean))].sort() as string[]
  if (![sourceTaskId, sourceUploadBatchId].every(n => Number.isSafeInteger(n) && n >= 0) || (sourceTaskId && sourceUploadBatchId)) throw new Error('请选择一个有效的领用来源')
  if (sourceTaskId || sourceUploadBatchId) {
    if (codes.length || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) throw new Error('按来源领取时请填写1至10000的数量，不需粘贴码清单')
  } else if (!codes.length || codes.length > 10000 || codes.some(c => !/^\d{32}$/.test(c))) throw new Error('请选择领用来源，或提供1至10000个具体32位码')
  return { sourceTaskId, sourceUploadBatchId, quantity, codes }
}
