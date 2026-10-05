import { query } from './db'
import { cleanLine } from './code-validator'
import type { ImportContext } from './import-validation'
import type { PoolConnection } from 'mysql2/promise'

// 解析与最终入库共用上下文加载；只查询当前文件中的已有码，不读取整企业码库。
export async function loadImportContext(rawLines: string[], enterpriseId?: number, connection?: PoolConnection) {
  // 入库事务复用自己的连接，避免并发上传占满连接池后等待额外连接。
  const readRows = async (sql: string, values: any[]) => connection ? (await connection.query<any[]>(sql, values))[0] : query<any[]>(sql, values)
  const scope = enterpriseId ? ' AND enterprise_id = ?' : ''
  const params = enterpriseId ? [enterpriseId] : []
  const products = await readRows('SELECT id, name, registration_no FROM product WHERE status = 1' + scope, params)
  const specs = await readRows('SELECT spec_code FROM product_spec WHERE status = 1' + scope, params)
  const existingSet = new Set<string>()
  const codes = [...new Set(rawLines.map(cleanLine).filter(c => /^\d{32}$/.test(c)))]
  for (let i = 0; i < codes.length; i += 5000) {
    const chunk = codes.slice(i, i + 5000)
    const rows = await readRows('SELECT code FROM trace_code WHERE code IN (' + chunk.map(() => '?').join(',') + ')', chunk)
    rows.forEach(r => existingSet.add(String(r.code)))
  }
  const context: ImportContext = {
    regLast6Map: new Map(products.map(p => [String(p.registration_no).slice(-6), Number(p.id)])),
    specCodeSet: new Set(specs.map(s => String(s.spec_code))), existingSet,
  }
  return { context, products }
}
