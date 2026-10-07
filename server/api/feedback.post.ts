// POST /api/feedback —— 公众端扫码反馈（PRD 8 类异常-7「扫码信息与标签不符」的入口 + 核实工单）
//
// 关键设计（2026-09-23 新增，缺陷清单 N2）：**复用 `risk_alert`（alert_type=7）⇒ 零 DDL、不新建后台页面**。
//   PRD 要的「核实工单」，后台的**风险预警中心就是现成的工单系统**（列表 / 详情 / 证据 /
//   "已核实合规"、"已确认违规" 处理动作 / 导出）⇒ 消费者反馈直接落 `risk_alert`，
//   并沿用「同码未处理则累计 repeat_count」的合并语义（**但合并键与 `triggerAlert` 不同，见下方 🔴**）。
//
// 🔴 这是一条**新的公众可写路径**（本项目历史上第一个匿名写接口），安全上必须盯住：
//   1. **限流是唯一防线**：同 IP 同码 5 分钟 1 次 + 同 IP 每小时 5 次（进程内计数，PM2 fork 单实例有效）；
//   2. **长度限制**：content 10–500 字；contact ≤64 字；
//   3. **不完全信任入参**：`resultType` 走白名单（否则可把任意字符串写进 evidence）；`code` 必须 ≥32 位数字；
//   4. **不落任何敏感信息**：只存消费者主动填的内容 + IP（IP 供后台判断是否同源刷单）。
//
// 🔴 三条业务边界：
//   1. **消费者提交的内容 = 线索，不是结论** —— 绝不能自动把码标成"存疑/作废"；处理动作必须留在
//      后台由人点（现有 `alerts/[id].patch.ts` 的"已核实合规 / 已确认违规"）。
//   2. **非本平台码也允许反馈**（消费者的现实场景）⇒ 此时 `enterprise_id / code_id / product_id`
//      全为 null，落一条**不属于任何企业**的预警。已核 `alerts.get.ts`：`platform_admin` 分支
//      **不加企业过滤** ⇒ 平台管理员能看见（不会被埋）；企业侧看不到（本就不该看到别人家的码被反馈）。
//   3. **企业站内信会被"首次触发"唤起**（对新预警发站内信）⇒ 可能被用来骚扰企业。
//      缓解：同码合并（同码多次反馈只累加 repeat_count）+ 限流。
//      ⚠️ 残留风险：攻击者可以**换着码**提交（每个新码建一条新预警 + 一条站内信）⇒ 限流是唯一防线；
//      若日后骚扰成灾，再加"全局每小时上限"（本次不做）。
import { query, execute } from '../utils/db'
import { sendMessage } from '../utils/notify'
import { ALERT_TYPES } from '../utils/risk-alert'
import { clientIpOf } from '../utils/audit'
import { allowRequest } from '../utils/rate-limit'
import { isTraceCode } from '#shared/utils/trace-code'

/**
 * 允许回传的结果类型白名单（`shared/types/trace.ts` 的 TraceResultType 全集）。
 * 不信任入参：只允许这些值落进 evidence，防止被人塞任意字符串。
 * 注：`mismatch` 目前 `trace.get.ts` 不产出，保留在白名单里是为将来口径补上时不用改这里。
 */
const ALLOWED_RESULT_TYPES = new Set([
  'genuine', 'not-found', 'external-reg', 'reg-expired', 'expired', 'repeat', 'frozen', 'voided', 'mismatch',
])

const CONTENT_MIN = 10
const CONTENT_MAX = 500
const CONTACT_MAX = 64
const IP_LIMIT_PER_HOUR = 5
const SAME_CODE_INTERVAL_MS = 5 * 60 * 1000

export default defineEventHandler(async (event) => {
  const ip = clientIpOf(event) || 'unknown'

  const body = await readBody(event) || {}
  const code = String(body.code || '').trim()
  const content = String(body.content || '').trim()
  const contact = String(body.contact || '').trim().slice(0, CONTACT_MAX)
  const resultType = String(body.resultType || '')

  if (!isTraceCode(code)) {
    throw createError({ statusCode: 400, statusMessage: '追溯码格式不正确' })
  }
  if (content.length < CONTENT_MIN || content.length > CONTENT_MAX) {
    throw createError({ statusCode: 400, statusMessage: '反馈内容请填写 ' + CONTENT_MIN + '–' + CONTENT_MAX + ' 字' })
  }

  // 🔴 限流刻意放在**入参校验之后**（2026-09-23 实测后修正）：
  //    校验失败的请求**不消耗配额** —— 正常用户填错一次内容不该被扣掉一次机会。
  //    （实测教训：放在最前时，连续几次 400 会把「5 次/小时」吃光，用户还没成功提交过就被锁 1 小时。）
  //    理由：400 路径**无任何副作用**（不落库、不发站内信、不打外部调用），不需要限流保护；
  //    真正要保护的是下面这条「落库 + 发站内信」的路径。
  // 第一道（更精确、先判）：同 IP 同码 5 分钟 1 次 —— 同一个人对同一个码反复提交没有意义
  if (!allowRequest('feedback:code:' + ip + ':' + code, 1, SAME_CODE_INTERVAL_MS)) {
    throw createError({ statusCode: 429, statusMessage: '该追溯码刚提交过反馈，请稍后再试' })
  }
  // 第二道：同 IP 每小时 5 次（防"换着码刷"，此时同码检查都会被放过）
  if (!allowRequest('feedback:ip:' + ip, IP_LIMIT_PER_HOUR, 60 * 60 * 1000)) {
    throw createError({ statusCode: 429, statusMessage: '反馈提交过于频繁，请稍后再试' })
  }

  // 查本平台是否签发过这个码 —— **非本平台码也允许反馈**（此时关联字段全为 null，见边界 2）
  const [codeRow] = await query<any[]>(
    'SELECT id, product_id, enterprise_id FROM trace_code WHERE code = ? LIMIT 1', [code])
  const enterpriseId = codeRow?.enterprise_id ?? null

  const evidence = JSON.stringify({
    source: 'consumer-feedback',
    code,
    resultType: ALLOWED_RESULT_TYPES.has(resultType) ? resultType : null,
    content,
    contact: contact || null,
    scanTime: new Date().toISOString(),
    ip,
  })

  // 🔴 为什么不复用 `triggerAlert`（2026-09-23 实施后实测发现并修正）：
  //    它的合并键是 `enterprise_id <=> ? AND code_id <=> ? AND product_id <=> ? AND external_verification_id <=> ?`，
  //    而**非本平台码的 code_id / product_id 恒为 NULL** ⇒ 所有非本平台码的反馈会被并成**同一条**记录
  //    （实测：6 个不同码 → 1 条记录 / repeat_count=6，且 evidence 被最后一次覆盖
  //     ⇒ 后台既看不出有几个码被反馈，也看不到各自的反馈内容）。
  //    ⇒ 这里改为**按 code 字符串合并**（本平台码与非本平台码一视同仁）。
  //    不动共用的 `triggerAlert`，是为了零风险影响其他调用点（它们各自有正确的区分键）。
  const [exist] = await query<any[]>(
    "SELECT id, repeat_count FROM risk_alert WHERE alert_type = 7 AND enterprise_id <=> ? AND handle_status = 0 AND JSON_UNQUOTE(JSON_EXTRACT(evidence, '$.code')) = ? LIMIT 1",
    [enterpriseId, code])

  if (exist) {
    await execute(
      'UPDATE risk_alert SET repeat_count = repeat_count + 1, evidence = ? WHERE id = ?',
      [evidence, exist.id])
    // 与 `triggerAlert` 同语义：仅在「合并首次触发」时通知，累计不重复打扰
    if (Number(exist.repeat_count) === 1) {
      await sendMessage({ enterpriseId, type: 'risk', title: '风险预警：' + ALERT_TYPES[7], content: '预警累计触发，请前往风险预警中心处理', link: '/admin/alerts' })
    }
  } else {
    await execute(
      'INSERT INTO risk_alert (enterprise_id, alert_type, code_id, product_id, evidence, trigger_time, repeat_count) VALUES (?,?,?,?,?,NOW(),1)',
      [enterpriseId, 7, codeRow?.id ?? null, codeRow?.product_id ?? null, evidence])
    // 站内消息通知（PRD 5.12.5：风险预警 → 站内信）
    await sendMessage({ enterpriseId, type: 'risk', title: '风险预警：' + ALERT_TYPES[7], content: '请前往风险预警中心核实处理', link: '/admin/alerts' })
  }

  return { ok: true }
})
