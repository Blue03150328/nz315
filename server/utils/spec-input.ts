import { MAX_PACK_QUANTITY, SPEC_PACKS, SPEC_UNITS } from '#shared/utils/specification'

/** 新增和编辑共用字段校验；旧调用省略数量时，新建默认1，编辑保留原数量。 */
export function parseSpecInput(body: any, previousQuantity = 1) {
  const specName = String(body?.specName || '').trim()
  const contentUnit = String(body?.contentUnit || '').trim()
  const packUnit = String(body?.packUnit || '').trim()
  const rawQuantity = body?.packQuantity === undefined ? previousQuantity : body.packQuantity
  const packQuantity = Number(rawQuantity)
  if (!specName || specName.length > 100) throw createError({ statusCode: 400, statusMessage: '规格名称必填且不能超过100字' })
  if (!SPEC_UNITS.includes(contentUnit)) throw createError({ statusCode: 400, statusMessage: '请选择有效的含量单位' })
  if (!SPEC_PACKS.includes(packUnit)) throw createError({ statusCode: 400, statusMessage: '请选择有效的包装单位' })
  if (!['number', 'string'].includes(typeof rawQuantity) || !Number.isInteger(packQuantity) || packQuantity < 1 || packQuantity > MAX_PACK_QUANTITY) {
    throw createError({ statusCode: 400, statusMessage: '数量须为1～999999之间的整数' })
  }
  const netContent = body?.netContent == null ? null : Number(body.netContent)
  if (netContent !== null && (!['number', 'string'].includes(typeof body.netContent) || !/^\d{1,9}(?:\.\d{1,3})?$/.test(String(body.netContent)) || netContent <= 0)) {
    throw createError({ statusCode: 400, statusMessage: '净含量须为正数，最多9位整数和3位小数' })
  }
  return { specName, netContent, contentUnit, packUnit, packQuantity }
}

export function parseSpecCode(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^(?!000)\d{3}$/.test(value)) {
    throw createError({ statusCode: 400, statusMessage: '请选择001～999之间的三位规格码' })
  }
  return value
}
