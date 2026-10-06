import fs from 'node:fs'
import path from 'node:path'
import { requirePlatformAdmin } from '../../../utils/auth'

// 备份仅总部可下载，固定目录和纯数字文件名阻断任意路径读取。
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event)
  const file = String(getQuery(event).file || '')
  if (!/^nz315_[0-9]{14}\.sql$/.test(file)) throw createError({ statusCode: 400, statusMessage: '文件名不合法' })
  const filePath = path.join(process.cwd(), 'backup', file)
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw createError({ statusCode: 404, statusMessage: '备份文件不存在' })
  setResponseHeaders(event, { 'Content-Type': 'application/sql; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + file + '"', 'Cache-Control': 'no-store' })
  return sendStream(event, fs.createReadStream(filePath))
})
