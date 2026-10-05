// 站内消息工具（PRD 5.11/5.12.5：风险预警/上传完成/库存预警等自动生成消息）
import { execute } from './db'

export interface NotifyInput {
  enterpriseId: number | null
  type: string        // code_stock/upload_done/risk/account/other
  title: string
  content?: string
  link?: string       // 跳转链接（如 /admin/alerts）
  attempts?: number   // 可选有限重试次数；普通通知沿用一次发送
}

/** 发送站内消息（企业全员） */
export async function sendMessage(input: NotifyInput) {
  const attempts = Math.max(1, Math.min(3, input.attempts || 1))
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
    await execute(
      'INSERT INTO message (enterprise_id, user_id, type, title, content, link, is_read) VALUES (?,NULL,?,?,?,?,0)',
      [input.enterpriseId, input.type, input.title, input.content || null, input.link || null])
      return true
    } catch (e) {
      console.warn('[notify] 消息发送失败:', (e as any)?.message || e)
    }
  }
  return false
}
