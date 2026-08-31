// PUT /api/admin/settings/notify —— 保存通知配置（PRD 5.12.5）
import { query, execute } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'
import { logOperation } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const body = await readBody(event) || {}
  const enterpriseId = user.role === 'platform_admin' ? null : user.enterprise_id

  const allowed = ['stockThreshold', 'dailyReportTime', 'notifyCodeStock', 'notifyUpload', 'notifyRisk', 'notifyAccount', 'notifyDaily']
  for (const k of allowed) {
    if (body[k] !== undefined && body[k] !== null) {
      const v = String(body[k])
      const [exist] = await query<any[]>(
        'SELECT id FROM system_setting WHERE enterprise_id <=> ? AND k = ?', [enterpriseId, k])
      if (exist) {
        await execute('UPDATE system_setting SET v = ? WHERE id = ?', [v, exist.id])
      } else {
        await execute('INSERT INTO system_setting (enterprise_id, k, v) VALUES (?,?,?)', [enterpriseId, k, v])
      }
    }
  }
  await logOperation(event, { module: '系统设置', action: '修改通知配置', content: JSON.stringify(body) })
  return { ok: true }
})
