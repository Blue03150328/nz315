// GET /api/admin/settings/notify —— 通知配置（PRD 5.12.5：类型开关/库存预警阈值/日报时间）
import { query } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'

// 默认配置
const DEFAULTS: Record<string, string> = {
  stockThreshold: '10000',
  dailyReportTime: '08:00',
  notifyCodeStock: 'on',
  notifyUpload: 'on',
  notifyRisk: 'on',
  notifyAccount: 'on',
  notifyDaily: 'off',
}

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const enterpriseId = user.role === 'platform_admin' ? null : user.enterprise_id
  const rows = await query<any[]>(
    'SELECT k, v FROM system_setting WHERE enterprise_id <=> ?', [enterpriseId])
  const kv: Record<string, string> = { ...DEFAULTS }
  for (const r of rows) kv[r.k] = r.v
  return kv
})
