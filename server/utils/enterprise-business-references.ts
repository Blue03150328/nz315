import { getPool } from './db'

const BASE_TABLES = ['product', 'product_spec', 'batch', 'upload_batch', 'trace_code']
const EXTERNAL_TABLES = ['external_collection_batch', 'external_trace_code']

/** 新模块尚未迁移时沿用原有保护，已建外部表必须纳入厂家删除检查。 */
export async function enterpriseBusinessReferenceTables(connection: any = getPool()): Promise<string[]> {
  const [rows] = await connection.query(
    'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?)',
    EXTERNAL_TABLES,
  )
  return [...BASE_TABLES, ...rows.map((row: any) => String(row.name)).filter((name: string) => EXTERNAL_TABLES.includes(name))]
}
