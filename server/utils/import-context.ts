import { query } from './db'
import { cleanLine } from './code-validator'
import { headOf } from './code-head'
import type { ImportContext } from './import-validation'
import type { PoolConnection } from 'mysql2/promise'

// 解析与最终入库共用上下文加载；只查询当前文件中的已有码，不读取整企业码库。
export async function loadImportContext(rawLines: string[], enterpriseId?: number, connection?: PoolConnection) {
  // 入库事务复用自己的连接，避免并发上传占满连接池后等待额外连接。
  const readRows = async (sql: string, values: any[]) => connection ? (await connection.query<any[]>(sql, values))[0] : query<any[]>(sql, values)
  const scope = enterpriseId ? ' AND p.enterprise_id = ?' : ''
  const params = enterpriseId ? [enterpriseId] : []
  const products = await readRows('SELECT p.id, p.name, p.registration_no, p.reg_category, p.produce_type, s.spec_code FROM product p JOIN product_spec s ON s.id = p.spec_id AND s.enterprise_id = p.enterprise_id AND s.status = 1 WHERE p.status = 1' + scope, params)
  const existingSet = new Set<string>()
  const codes = [...new Set(rawLines.map(cleanLine).filter(c => /^\d{32}$/.test(c)))]
  for (let i = 0; i < codes.length; i += 5000) {
    const chunk = codes.slice(i, i + 5000)
    const rows = await readRows('SELECT code FROM trace_code WHERE code IN (' + chunk.map(() => '?').join(',') + ')', chunk)
    rows.forEach(r => existingSet.add(String(r.code)))
  }
  const context: ImportContext = {
    products: products.map(p => ({ id: Number(p.id), head: headOf(p) })), existingSet,
  }
  return { context, products }
}
