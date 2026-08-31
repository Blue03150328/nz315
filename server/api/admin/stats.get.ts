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
     WHERE scan_time >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)` + fidSql + ' GROUP BY DATE(scan_time) ORDER BY d', fidParams)

  // 码库存预警（PRD 5.5.8）：按产品统计总码/已生成可用/作废占比，低于阈值或作废占比异常时提醒
  const [stockThresholdRow] = await query<any[]>(
    'SELECT v FROM system_setting WHERE enterprise_id <=> NULL AND k = ? LIMIT 1', ['stockThreshold'])
  const stockThreshold = Number(stockThresholdRow?.[0]?.v ?? 10000)
  const VOID_RATIO_LIMIT = 0.1 // 作废码占比告警阈值（PRD 5.5.8 默认口径）
  const stockRows = await query<any[]>(
    `SELECT p.name AS name,
       COUNT(*) AS total,
       SUM(CASE WHEN t.status = 1 THEN 1 ELSE 0 END) AS gen_count,
       SUM(CASE WHEN t.abnormal_flag = 2 THEN 1 ELSE 0 END) AS voided
     FROM trace_code t LEFT JOIN product p ON t.product_id = p.id
     WHERE t.product_id IS NOT NULL` + fidSql.replace('enterprise_id', 't.enterprise_id') +
    ' GROUP BY t.product_id, p.name HAVING total > 0 ORDER BY gen_count ASC', fidParams)
  const stockAlerts = stockRows
    .map(r => {
      const total = Number(r.total)
      const generated = Number(r.gen_count)
      const voided = Number(r.voided)
      const voidRatio = total ? voided / total : 0
      return {
        name: r.name || '未绑定产品',
        total,
        generated,
        voided,
        voidRatio: Number(voidRatio.toFixed(4)),
        lowStock: generated < stockThreshold,   // 可用码（已生成）低于配置阈值 → 低库存
        voidAbnormal: voidRatio > VOID_RATIO_LIMIT, // 作废占比超阈值 → 印刷/采集环节排查提示
      }
    })
    .filter((r: any) => r.lowStock || r.voidAbnormal)
    .slice(0, 10)

  // 近 30 天补零：保证返回连续 30 个日期点（缺失日期按 0 计）
  const trendMap = new Map(trendRows.map(r => [String(r.d), Number(r.c)]))
  const scanTrend: { date: string; count: number }[] = []
  const fmt = (d: Date) => {
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return d.getFullYear() + '-' + m + '-' + day
  }
  for (let i = 29; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    scanTrend.push({ date: fmt(d), count: trendMap.get(fmt(d)) || 0 })
  }

  return {
    stockThreshold,
    stockAlerts,
    totalCodes: Number(totalCodeRow?.c || 0),
    todayCodes: Number(todayCodeRow?.c || 0),
    totalScans: Number(totalScanRow?.c || 0),
    todayScans: Number(todayScanRow?.c || 0),
    abnormalCodes: Number(abnormalRow?.c || 0),
    pendingAlerts: Number(pendingAlertRow?.c || 0),
    statusDist: Object.fromEntries(statusRows.map(r => [Number(r.status), Number(r.c)])),
    flagDist: Object.fromEntries(flagRows.map(r => [Number(r.abnormal_flag), Number(r.c)])),
    productDist: productRows.map(r => ({ name: r.name || '未绑定产品', count: Number(r.c) })),
    scanTrend,
  }
})