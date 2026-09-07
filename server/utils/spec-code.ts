// 企业规格码自动分配（单条新增与批量导入共用）
// 规格码 = 32 位追溯码第 9-11 位（1049 结构强制段），用户无需感知，系统分配保证企业内唯一
import { query } from './db'

/** 取该企业当前最大规格码 + 1 补零 3 位（首个为 001；上限 999 报错） */
export async function nextSpecCode(fid: number): Promise<string> {
  const [row] = await query<any[]>('SELECT MAX(CAST(spec_code AS UNSIGNED)) AS m FROM product_spec WHERE enterprise_id = ?', [fid])
  const next = Number(row?.m || 0) + 1
  if (next > 999) throw createError({ statusCode: 400, statusMessage: '该企业规格数量已达上限（999 个）' })
  return String(next).padStart(3, '0')
}

/** 取当前最大规格码数值（批量导入在事务内基于基线内存递增，避免 REPEATABLE READ 快照读看不到自插行的坑） */
export async function maxSpecCodeNum(fid: number): Promise<number> {
  const [row] = await query<any[]>('SELECT MAX(CAST(spec_code AS UNSIGNED)) AS m FROM product_spec WHERE enterprise_id = ?', [fid])
  return Number(row?.m || 0)
}
