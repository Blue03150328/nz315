// POST /api/admin/codes/qrcode —— 二维码图片批量生成（PRD 5.5.1 + 合规第一条：QR/DM 码制，供印刷厂赋码）
// 流程：生成 PNG 到临时目录 → 返回前 3 张预览 + 下载 token（GET /api/admin/codes/qrcode-download?token= 打包 zip 下载）
/// <reference path="../../../types/cjs-modules.d.ts" />
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { requireBackendUser } from '../../../utils/auth'
import { renderCodePng, type QrImageType, type QrImageOptions } from '../../../utils/qr-image'

// 临时文件任务存储（token → 任务信息；60 分钟过期，惰性清理）
interface QrTask { userId: number; dir: string; createdAt: number; total: number }
const taskStore = new Map<string, QrTask>()

function cleanupExpired() {
  const now = Date.now()
  for (const [token, task] of taskStore) {
    if (now - task.createdAt > 60 * 60 * 1000) {
      taskStore.delete(token)
      rm(task.dir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

export function getQrTask(token: string): QrTask | undefined {
  return taskStore.get(token)
}

export function consumeQrTask(token: string): QrTask | undefined {
  const t = taskStore.get(token)
  taskStore.delete(token)
  return t
}

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const body = await readBody(event) || {}

  // 参数校验（与离线工具一致：模块 1-20、静区 0-20、数量上限 1 万）
  const codes = Array.isArray(body.codes) ? (body.codes as unknown[]).map(c => String(c)).filter((s: string) => s.trim()) : []
  if (codes.length === 0) throw createError({ statusCode: 400, statusMessage: '没有可生成的追溯码，请先生成追溯码' })
  if (codes.length > 10000) throw createError({ statusCode: 400, statusMessage: '单次图片生成不超过 1 万张' })

  const type: QrImageType = body.type === 'DM' ? 'DM' : 'QR'
  const moduleSize = Math.max(1, Math.min(20, Number(body.moduleSize) || 4))
  const quietZone = Math.max(0, Math.min(20, Number(body.quietZone) || 2))
  const prefix = String(body.prefix || 'bar_').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
  const startIndex = Math.max(1, Number(body.startIndex) || 1)
  let count = Number(body.count)
  if (!Number.isInteger(count) || count < 1 || count > codes.length) count = codes.length

  // 生成到临时目录
  const token = randomUUID()
  const dir = join(tmpdir(), 'nz315-qr-' + token)
  await mkdir(dir, { recursive: true })

  const opts: QrImageOptions = { type, moduleSize, quietZone }
  const pad = String(startIndex + count - 1).length
  const start = Date.now()
  const previews: string[] = []
  let done = 0
  let failed = 0

  for (let i = 0; i < count; i++) {
    const name = prefix + String(startIndex + i).padStart(pad, '0') + '.png'
    try {
      const buf = await renderCodePng(String(codes[i]).trim(), opts)
      await writeFile(join(dir, name), buf)
      if (previews.length < 3) previews.push(buf.toString('base64'))
      done++
    } catch {
      failed++ // 内容过长或格式问题，跳过（与离线工具一致）
    }
  }

  if (done === 0) {
    await rm(dir, { recursive: true, force: true })
    throw createError({ statusCode: 400, statusMessage: '全部生成失败，请检查码内容与参数' })
  }

  cleanupExpired()
  taskStore.set(token, { userId: user.id, dir, createdAt: Date.now(), total: done })

  return {
    ok: true,
    token,
    type,
    done,
    failed,
    total: done,
    elapsedMs: Date.now() - start,
    previews,
    exampleName: prefix + String(startIndex).padStart(pad, '0') + '.png',
  }
})