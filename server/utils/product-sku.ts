import type { PoolConnection } from 'mysql2/promise'

export const PRODUCT_SKU_DUPLICATE = '该厂家下相同登记证号、规格和商标的产品已存在，请核对规格或商标'

export function parseProductSku(body: any) {
  const specId = Number(body.specId)
  if (!['number', 'string'].includes(typeof body.specId) || !Number.isSafeInteger(specId) || specId <= 0) throw createError({ statusCode: 400, statusMessage: '请选择有效的规格' })
  const trademark = String(body.trademark || '').trim()
  if (trademark.length > 100) throw createError({ statusCode: 400, statusMessage: '产品商标不能超过100字' })
  return { specId, trademark }
}

export async function validateProductSku(conn: PoolConnection, enterpriseId: number, registrationNo: string, specId: number, trademark: string, current?: any) {
  const [[spec]] = await conn.query<any[]>('SELECT id, enterprise_id, status FROM product_spec WHERE id = ? FOR UPDATE', [specId])
  const keepingSpec = Number(current?.spec_id) === specId
  // 旧总部表单可选外厂规格；仅允许原绑定继续编辑，不建立新的跨企业绑定。
  if (!spec || (Number(spec.enterprise_id) !== enterpriseId && !keepingSpec)) throw createError({ statusCode: 400, statusMessage: '请选择该厂家名下的规格' })
  if (Number(spec.status) !== 1 && Number(current?.spec_id) !== specId) throw createError({ statusCode: 400, statusMessage: '该规格已停用，请选择启用的规格' })
  const [[dup]] = await conn.query<any[]>(
    "SELECT id FROM product WHERE enterprise_id = ? AND registration_no = ? AND spec_id = ? AND TRIM(COALESCE(trademark, '')) = ? AND id <> ? LIMIT 1 FOR UPDATE",
    [enterpriseId, registrationNo, specId, trademark, Number(current?.id || 0)])
  if (dup) throw createError({ statusCode: 409, statusMessage: PRODUCT_SKU_DUPLICATE })
}

export function productSkuWriteError(error: any) {
  if (error?.code === 'ER_DUP_ENTRY' && String(error.sqlMessage || error.message).includes('uq_registration_no')) return createError({ statusCode: 503, statusMessage: '产品规格唯一索引尚未更新，请完成产品SKU专用迁移后重试' })
  if (error?.code === 'ER_DUP_ENTRY') return createError({ statusCode: 409, statusMessage: PRODUCT_SKU_DUPLICATE })
  return error
}
