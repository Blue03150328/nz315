// 操作日志工具（PRD 5.12.4：记录模块/操作/内容/IP/结果，保留至少3年不可删除）
import { execute } from './db'
import { getHeader } from 'h3'

export interface AuditInput {
  module: string          // 模块：登录/系统设置/用户管理/码库管理/生产采集/产品管理…
  action: string          // 操作类型：新增/修改/删除/上传/导出/登录/重置密码/禁用/启用
  content?: string        // 操作内容（含修改前后值 JSON，可选）
  result?: number         // 0失败 1成功
}

/** 写入操作日志（enterpriseId/userId 可从 event 上下文取） */
export async function logOperation(event: any, input: AuditInput) {
  try {
    const userId = (event.context as any)?.authUser?.id ?? null
    const enterpriseId = (event.context as any)?.authUser?.enterprise_id ?? null
    const ip = clientIpOf(event)
    await execute(
      'INSERT INTO operation_log (enterprise_id, user_id, module, action, content, ip, result) VALUES (?,?,?,?,?,?,?)',
      [enterpriseId, userId, input.module, input.action, input.content || null, ip || null, input.result ?? 1])
  } catch (e) {
    // 日志写入失败不影响主流程
    console.warn('[audit] 操作日志写入失败:', (e as any)?.message || e)
  }
}

/** 取客户端 IP：优先代理头（x-real-ip 防伪造），无代理时回退 TCP socket 地址（本地/内网直连也能记录） */
export function clientIpOf(event: any): string {
  const proxied = (String(getHeader(event, 'x-real-ip') || getHeader(event, 'x-forwarded-for') || '').split(',')[0] || '').trim()
  if (proxied) return proxied
  const sock = (event?.node?.req?.socket as any)?.remoteAddress || ''
  return sock.startsWith('::ffff:') ? sock.slice(7) : sock
}

/** 记录登录日志（PRD 5.1 登录日志：时间/IP/设备） */
export async function logLogin(event: any, userId: number, enterpriseId: number | null, success: boolean, note?: string) {
  const ip = clientIpOf(event)
  const ua = String(getHeader(event, 'user-agent') || '')
  const device = ua.includes('MicroMessenger') ? '微信' : ua.includes('AlipayClient') ? '支付宝' : '浏览器'
  await execute(
    'INSERT INTO operation_log (enterprise_id, user_id, module, action, content, ip, result) VALUES (?,?,?,?,?,?,?)',
    [enterpriseId, userId, '登录', success ? '登录成功' : '登录失败', note || (success ? '账号密码登录成功（' + device + '）' : '账号密码登录失败'), ip || null, success ? 1 : 0])
}
