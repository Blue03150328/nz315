// DELETE /api/admin/backup —— 删除备份文件（PRD 5.12.6）
import fs from 'node:fs'
import path from 'node:path'
import { requirePlatformAdmin } from '../../utils/auth'
import { logOperation } from '../../utils/audit'

const BACKUP_DIR = path.resolve(process.cwd(), 'backup')

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event)
  const q = getQuery(event)
  const file = String(q.file || '')
  // 防路径穿越：仅允许 backup 目录内的 nz315_*.sql 文件
  if (!/^nz315_[0-9]{14}\.sql$/.test(file)) throw createError({ statusCode: 400, statusMessage: '文件名不合法' })
  const filePath = path.join(BACKUP_DIR, file)
  if (!fs.existsSync(filePath)) throw createError({ statusCode: 404, statusMessage: '备份文件不存在' })
  fs.unlinkSync(filePath)
  await logOperation(event, { module: '数据备份', action: '删除备份', content: JSON.stringify({ file }) })
  return { ok: true }
})