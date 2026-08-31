// GET /api/admin/codes/qrcode-download?token=xxx —— 下载二维码图片 zip 包（PRD 5.5.1：文件导出供印刷）
// 生成任务由 POST /api/admin/codes/qrcode 创建；下载后清理临时文件（token 一次性 + 60 分钟过期）
/// <reference path="../../../types/cjs-modules.d.ts" />
import archiver from 'archiver'
import { rm } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import { requireBackendUser } from '../../../utils/auth'
import { getQrTask, consumeQrTask } from './qrcode.post'

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const token = String(getQuery(event).token || '')
  if (!token) throw createError({ statusCode: 400, statusMessage: '缺少下载凭证' })

  const task = getQrTask(token)
  if (!task) throw createError({ statusCode: 400, statusMessage: '下载凭证无效或已过期，请重新生成' })
  if (task.userId !== user.id) throw createError({ statusCode: 403, statusMessage: '无权下载该文件' })

  // 打包前移除任务（一次性凭证，防止重复下载；打包失败由过期清理兜底）
  consumeQrTask(token)

  // zip 打包并流式返回
  const archive = archiver('zip', { zlib: { level: 9 } })
  archive.on('error', () => {})
  archive.directory(task.dir, false) // 不带顶层目录，zip 根下直接是 png 文件

  const date = new Date()
  const d = String(date.getFullYear()) + String(date.getMonth() + 1).padStart(2, '0') + String(date.getDate()).padStart(2, '0')
  setResponseHeader(event, 'Content-Type', 'application/zip')
  setResponseHeader(event, 'Content-Disposition', 'attachment; filename="trace-qrcodes-' + d + '.zip"')

  // 流式发送
  // archiver 实例是 Node Readable 流（本地声明为简化接口，此处做真实类型断言）
  const stream = sendStream(event, archive as unknown as Readable)
  archive.finalize()

  // 响应结束后清理临时目录
  try {
    await stream
  } finally {
    rm(task.dir, { recursive: true, force: true }).catch(() => {})
  }
})