// 风险预警工具（PRD 5.9：8 类异常实时/巡检触发；同码同类合并累计次数）
import { query, execute } from './db'
import { sendMessage } from './notify'

// 异常类型对照（PRD 5.9 清单）
export const ALERT_TYPES: Record<number, string> = {
  1: '重复查询码',
  2: '查无此码',
  3: '登记证号不存在',
  4: '登记证已过期',
  5: '产品名称不符',
  6: '生产厂家不符',
  7: '扫码信息与标签不符',
  8: '限用农药非定点销售',
}

/**
 * 触发预警：同 enterprise+code+type 未处理则累计 repeat_count，已处理则新建
 */
export async function triggerAlert(input: {
  alertType: number       // 1-8
  enterpriseId: number | null
  codeId?: number | null
    productId?: number | null
    externalVerificationId?: number | null
  evidence?: any          // 证据数据（扫码记录/比对结果等）
}) {
  try {
    const { alertType, enterpriseId, codeId, productId, externalVerificationId, evidence } = input
    // 查同码同类未处理预警
    const [exist] = await query<any[]>(
      'SELECT id, repeat_count FROM risk_alert WHERE enterprise_id <=> ? AND code_id <=> ? AND product_id <=> ? AND external_verification_id <=> ? AND alert_type = ? AND handle_status = 0 LIMIT 1',
      [enterpriseId, codeId ?? null, productId ?? null, externalVerificationId ?? null, alertType])
    if (exist) {
      await execute('UPDATE risk_alert SET repeat_count = repeat_count + 1, evidence = ? WHERE id = ?',
        [evidence ? JSON.stringify(evidence) : null, exist.id])
      // 消息：仅合并首次触发时通知（累计不重复打扰）
      if (Number(exist.repeat_count) === 1) {
        await sendMessage({ enterpriseId, type: 'risk', title: '风险预警：' + ALERT_TYPES[alertType], content: '预警累计触发，请前往风险预警中心处理', link: '/admin/alerts' })
      }
    } else {
      await execute(
        'INSERT INTO risk_alert (enterprise_id, alert_type, code_id, product_id, external_verification_id, evidence, trigger_time, repeat_count) VALUES (?,?,?,?,?,?,NOW(),1)',
        [enterpriseId, alertType, codeId ?? null, productId ?? null, externalVerificationId ?? null, evidence ? JSON.stringify(evidence) : null])
      // 站内消息通知（PRD 5.12.5：风险预警 → 站内信）
      await sendMessage({ enterpriseId, type: 'risk', title: '风险预警：' + ALERT_TYPES[alertType], content: '请前往风险预警中心核实处理', link: '/admin/alerts' })
    }
  } catch (e) {
    // 预警写入失败不影响扫码主流程
    console.warn('[risk-alert] 预警触发失败:', (e as any)?.message || e)
  }
}
