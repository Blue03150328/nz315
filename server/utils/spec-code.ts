// 规格码由企业共用001～999空闲号码池；占用状态包含停用规格。
import type { PoolConnection } from 'mysql2/promise'
import { availableSpecCodes } from '#shared/utils/specification'

/** 企业行锁串行化同企业的新增及批量导入，唯一索引作为最后防线。 */
export async function lockSpecEnterprise(conn: PoolConnection, fid: number) {
  const [rows] = await conn.query<any[]>('SELECT id FROM enterprise WHERE id = ? FOR UPDATE', [fid])
  if (!rows.length) throw createError({ statusCode: 400, statusMessage: '归属企业不存在' })
}

export async function readAvailableSpecCodes(conn: PoolConnection, fid: number): Promise<string[]> {
  const [rows] = await conn.query<any[]>('SELECT spec_code FROM product_spec WHERE enterprise_id = ?', [fid])
  return availableSpecCodes(rows.map(row => String(row.spec_code)))
}
