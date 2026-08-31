// 第三方 CJS 库类型声明（离线环境无 @types 包，本地声明；仅覆盖本项目使用到的 API 面）
// ⚠️ 本文件必须保持「全局脚本」形态（无 import/export）——TS7 下模块化 d.ts 经三斜线引用不生效（已验证）
declare module 'archiver' {
  interface Archiver extends NodeJS.ReadableStream {
    directory(dirpath: string, destpath: string | false): Archiver
    finalize(): Promise<void>
    on(event: string, listener: (...args: any[]) => void): this
  }
  function archiver(format: string, options?: Record<string, unknown>): Archiver
  export default archiver
}

declare module 'qrcode' {
  interface QrCodeOptions {
    errorCorrectionLevel?: string
    margin?: number
    scale?: number
    type?: string
  }
  const QRCode: {
    toBuffer(text: string, options?: QrCodeOptions): Promise<Buffer>
  }
  export default QRCode
}

declare module 'pngjs' {
  interface PngOptions {
    width?: number
    height?: number
  }
  export class PNG {
    constructor(options?: PngOptions)
    data: Buffer
    width: number
    height: number
    static sync: {
      write(png: PNG, options?: Record<string, unknown>): Buffer
    }
  }
}
