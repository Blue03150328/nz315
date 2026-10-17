import type { PoolConnection } from 'mysql2/promise'
import type { ProductImportError, ProductImportWarning, ProductImportRow } from '#shared/utils/product-import'
import { lockSpecEnterprise } from './spec-code'
import { normalizeProductSpecCode, prepareImportedProduct, productImportToday } from './product-import-input'
import { validateProductSku, productSkuWriteError } from './product-sku'
import { normalizeOrgName } from './regdata'

/** 企业行锁协调规格变更与并发导入，每行保存点；业务异常逐行返回，数据库故障整批回滚。 */
export async function importProducts(conn: PoolConnection, enterpriseId: number, rows: ProductImportRow[]) {
  const errors: ProductImportError[] = [], warnings: ProductImportWarning[] = []
  let success = 0
  await conn.beginTransaction()
  try {
    await lockSpecEnterprise(conn, enterpriseId)
    const [[enterprise]] = await conn.query<any[]>('SELECT name FROM enterprise WHERE id = ?', [enterpriseId])
    const [specs] = await conn.query<any[]>('SELECT * FROM product_spec WHERE enterprise_id = ? FOR UPDATE', [enterpriseId])
    const numbers = [...new Set(rows.flatMap(row => ['登记证号', '原药登记证号1', '原药登记证号2', '原药登记证号3'].map(key => String(row.values[key] || '').trim().toUpperCase())).filter(Boolean))]
    const [registry] = numbers.length ? await conn.query<any[]>('SELECT * FROM pesticide_reg WHERE registration_no IN (?)', [numbers]) : [[]]
    const registryMap = new Map(registry.map((reg: any) => [String(reg.registration_no).toUpperCase(), reg]))
    const today = productImportToday()
    for (const row of rows) {
      await conn.query('SAVEPOINT product_import_row')
      try {
        const code = normalizeProductSpecCode(row.values['规格代码'])
        const matches = specs.filter(spec => String(spec.spec_code) === code)
        if (!matches.length) throw createError({ statusCode: 400, statusMessage: '本企业不存在规格代码「' + code + '」，请先在规格库建档或更正代码' })
        if (matches.length > 1) throw createError({ statusCode: 400, statusMessage: '规格代码匹配到多个历史记录，请先核对规格库' })
        const spec = matches[0]
        if (Number(spec.status) !== 1) throw createError({ statusCode: 400, statusMessage: '规格「' + code + '」已停用，请先核实并启用' })
        const p = prepareImportedProduct(row.values, registryMap.get(String(row.values['登记证号'] || '').trim().toUpperCase()), spec, registryMap, today)
        if (p.produceType === 1 && normalizeOrgName(p.holderName) !== normalizeOrgName(String(enterprise.name))) throw createError({ statusCode: 400, statusMessage: '持有人生产须使用本企业持有的登记证；委托加工或委托分装请按实际选择生产类型' })
        await validateProductSku(conn, enterpriseId, p.registrationNo, Number(spec.id), p.trademark)
        const [product]: any = await conn.query(
          `INSERT INTO product (enterprise_id,trademark,name,registration_no,registration_expire,reg_category,
            holder_name,produce_type,dosage,content,spec_id,category,toxicity,is_restricted,status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [enterpriseId, p.trademark, p.name, p.registrationNo, p.registrationExpire, p.regCategory, p.holderName,
            p.produceType, p.dosage, p.content, spec.id, p.category, p.toxicity, p.isRestricted, p.status])
        for (const original of p.originals) await conn.query(
          'INSERT INTO product_original (product_id,ingredient,reg_no,company) VALUES (?,?,?,?)',
          [product.insertId, original.ingredient || null, original.regNo, original.company])
        await conn.query('RELEASE SAVEPOINT product_import_row')
        success++
        warnings.push(...p.warnings.map(reason => ({ row: row.row, reason })))
      } catch (error: any) {
        const e = productSkuWriteError(error)
        if (![400, 409].includes(Number(e?.statusCode))) throw e
        await conn.query('ROLLBACK TO SAVEPOINT product_import_row')
        await conn.query('RELEASE SAVEPOINT product_import_row')
        errors.push({ row: row.row, value: row.values['登记证号'] || '', reason: e.statusMessage, values: row.values })
      }
    }
    await conn.commit()
    return { ok: true, success, createdSpecs: 0, failed: errors.length, errors, warnings }
  } catch (error) {
    await conn.rollback().catch(() => {})
    throw error
  }
}
