// 二维码图片渲染工具（PRD 合规第一条：码制采用 QR 码或 DM 码，对应 1049 号公告二维码格式要求）
// 实现参考：离线工具「农药追溯码生成工具」（E:\wokeplace\二维码生成离线软件）main.js 的 renderQrImage / renderDmImage
/// <reference path="../types/cjs-modules.d.ts" />
import QRCode from 'qrcode'
import { DataMatrixWriter, BarcodeFormat } from '@zxing/library'
import { PNG } from 'pngjs'

export type QrImageType = 'QR' | 'DM'

export interface QrImageOptions {
  type: QrImageType      // 码制：QR 码 / DataMatrix 码
  moduleSize: number     // 模块大小（像素/格，印刷推荐 3-6）
  quietZone: number      // 静区白边（模块数，印刷必须 ≥2）
}

// QR 码：qrcode 库渲染 PNG（高容错 H，与原离线工具一致）
export async function renderQrPng(content: string, opts: QrImageOptions): Promise<Buffer> {
  return QRCode.toBuffer(content, {
    errorCorrectionLevel: 'H',   // 高容错（印刷磨损容忍度）
    margin: opts.quietZone,      // 静区（模块数）
    scale: opts.moduleSize,      // 每模块像素
    type: 'png',
  })
}

// DataMatrix 码：zxing 编码矩阵 → pngjs 手工绘制 PNG
export function renderDmPng(content: string, opts: QrImageOptions): Buffer {
  const writer = new DataMatrixWriter()
  const matrix = writer.encode(content, BarcodeFormat.DATA_MATRIX, 0, 0)
  const w = matrix.getWidth()
  const h = matrix.getHeight()
  const scale = opts.moduleSize
  const quiet = opts.quietZone * scale
  const W = w * scale + quiet * 2
  const H = h * scale + quiet * 2
  const png = new PNG({ width: W, height: H })
  // 背景白色
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 255; png.data[i + 1] = 255; png.data[i + 2] = 255; png.data[i + 3] = 255
  }
  // 画黑色模块
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (matrix.get(x, y)) {
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = quiet + x * scale + dx
            const py = quiet + y * scale + dy
            const idx = (py * W + px) << 2
            png.data[idx] = 0; png.data[idx + 1] = 0; png.data[idx + 2] = 0
          }
        }
      }
    }
  }
  return PNG.sync.write(png)
}

/** 按码制渲染单张 PNG */
export async function renderCodePng(content: string, opts: QrImageOptions): Promise<Buffer> {
  if (opts.type === 'DM') return renderDmPng(content, opts)
  return renderQrPng(content, opts)
}