// MySQL 连接池（PRD 6.x：连接配置来自 .env，经 nuxt runtimeConfig 注入）
import mysql from 'mysql2/promise'

let pool: mysql.Pool | null = null

export function getPool(): mysql.Pool {
  if (pool) return pool
  const config = useRuntimeConfig()
  pool = mysql.createPool({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database: config.dbName,
    connectionLimit: 10,
    charset: 'utf8mb4',
    dateStrings: true,
  })
  return pool
}

/** 便捷查询：返回行数组 */
export async function query<T = any>(sql: string, params?: any[]): Promise<T> {
  const [rows] = await getPool().query(sql, params)
  return rows as T
}

/** 便捷执行（INSERT/UPDATE/DELETE）：返回结果集 */
export async function execute(sql: string, params?: any[]): Promise<any> {
  const [result] = await getPool().execute(sql, params)
  return result
}
