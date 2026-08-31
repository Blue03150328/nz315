// POST /api/admin/backup —— 手动数据备份（PRD 5.12.6，mysqldump）
// 仅总部管理员；备份文件存 backup/ 目录（已 gitignore）
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { requirePlatformAdmin } from '../../utils/auth'
import { logOperation } from '../../utils/audit'

const execFileAsync = promisify(execFile)
const BACKUP_DIR = path.resolve(process.cwd(), 'backup')

export default defineEventHandler(async (event) => {
  const user = await requirePlatformAdmin(event)
  const config = useRuntimeConfig()
  // 文件名纯数字（YYYYMMDDHHMMSS），便于下载/删除的正则校验与排序
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:-]/g, '')
  const fileName = 'nz315_' + timestamp + '.sql'
  const filePath = path.join(BACKUP_DIR, fileName)

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true })

  // mysqldump 全库备份（--single-transaction 保证一致性，不锁表）
  const mysqldump = 'C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqldump.exe'
  try {
    await execFileAsync(mysqldump, [
      '-h', config.dbHost, '-P', String(config.dbPort),
      '-u', config.dbUser, '-p' + config.dbPassword,
      '--single-transaction', '--default-character-set=utf8mb4',
      config.dbName,
    ], { maxBuffer: 512 * 1024 * 1024 })
      .then(({ stdout }) => {
        fs.writeFileSync(filePath, stdout, 'utf8')
      })
    const size = fs.statSync(filePath).size
    await logOperation(event, { module: '数据备份', action: '手动备份', content: JSON.stringify({ file: fileName, size }) })
    return { ok: true, file: fileName, size, time: timestamp }
  } catch (e: any) {
    console.error('[backup] 备份失败:', e?.message || e)
    throw createError({ statusCode: 500, statusMessage: '备份失败：' + (e?.message || '未知错误') })
  }
})