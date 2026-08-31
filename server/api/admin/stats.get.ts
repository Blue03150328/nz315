// GET /api/admin/stats —— 数据概览统计（PRD 5.2 仪表盘）
// 厂家账号统计本企业；总部管理员统计全局
import { query } from '../../utils/db'
import { requireBackendUser } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const isPlatform = user.role === 'platform_admin'
  const fid = user.enterprise_id

  const fidSql = isPlatform ? '' : ' AND enterprise_id = ?'
  const fidParams = isPlatform ? [] : [fid]

  const [totalCodeRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM trace_code WHERE 1=1' + fidSql, fidParams)
  const [todayCodeRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM trace_code WHERE DATE(created_at) = CURDATE()' + fidSql, fidParams)
  const [totalScanRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM scan_log WHERE 1=1' + fidSql, fidParams)
  const [todayScanRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM scan_log WHERE DATE(scan_time) = CURDATE()' + fidSql, fidParams)
  const [abnormalRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM trace_code WHERE abnormal_flag > 0' + fidSql, fidParams)
  const [pendingAlertRow] = await query<any[]>(
    'SELECT COUNT(*) AS c FROM risk_alert WHERE handle_status = 0' + fidSql, fidParams)
  const statusRows = await query<any[]>(
    'SELECT status, COUNT(*) AS c FROM trace_code WHERE 1=1' + fidSql + ' GROUP BY status', fidParams)
  const flagRows = await query<any[]>(
    'SELECT abnormal_flag, COUNT(*) AS c FROM trace_code WHERE 1=1' + fidSql + ' GROUP BY abnormal_flag', fidParams)
  const productRows = await query<any[]>(
    `SELECT p.name AS name, COUNT(*) AS c FROM trace_code t LEFT JOIN product p ON t.product_id = p.id
     WHERE 1=1` + fidSql + ' GROUP BY t.product_id, p.name ORDER BY c DESC LIMIT 10', fidParams)
  const trendRows = await query<any[]>(
    `SELECT DATE(scan_time) AS d, COUNT(*) AS c FROM scan_log
     WHERE scan_time >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)` + fidSql + ' GROUP BY DATE(scan_time) ORDER BY d', fidParams)

  return {
    totalCodes: Number(totalCodeRow?.c || 0),
    todayCodes: Number(todayCodeRow?.c || 0),
    totalScans: Number(totalScanRow?.c || 0),
    todayScans: Number(todayScanRow?.c || 0),
    abnormalCodes: Number(abnormalRow?.c || 0),
    pendingAlerts: Number(pendingAlertRow?.c || 0),
    statusDist: Object.fromEntries(statusRows.map(r => [Number(r.status), Number(r.c)])),
    flagDist: Object.fromEntries(flagRows.map(r => [Number(r.abnormal_flag), Number(r.c)])),
    productDist: productRows.map(r => ({ name: r.name || '未绑定产品', count: Number(r.c) })),
    scanTrend: trendRows.map(r => ({ date: String(r.d), count: Number(r.c) })),
  }
})