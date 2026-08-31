// GET /api/admin/backup —— 备份历史（PRD 5.12.6）
import fs from 'node:fs'
import path from 'node:path'
import { requirePlatformAdmin } from '../../utils/auth'

const BACKUP_DIR = path.resolve(process.cwd(), 'backup')

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event)
  if (!fs.existsSync(BACKUP_DIR)) return { rows: [] }
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('nz315_') && f.endsWith('.sql'))
    .map(f => {
      const st = fs.statSync(path.join(BACKUP_DIR, f))
      return { file: f, size: st.size, time: st.mtime.toISOString().slice(0, 19).replace('T', ' ') }
    })
    .sort((a, b) => b.time.localeCompare(a.time))
  return { rows: files }
})
