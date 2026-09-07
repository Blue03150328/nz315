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

declare module 'xlsx' {
  interface WorkBook {
    SheetNames: string[]
    Sheets: Record<string, WorkSheet>
  }
  // 单元格地址键 + 控制键均允许（'!ref' 等），只读使用不深究结构
  interface WorkSheet {
    [cell: string]: unknown
  }
  const XLSX: {
    read(data: Buffer | ArrayBuffer | Uint8Array, opts?: Record<string, unknown>): WorkBook
    readFile(path: string, opts?: Record<string, unknown>): WorkBook
    utils: {
      sheet_to_json<T = unknown>(ws: WorkSheet, opts?: Record<string, unknown>): T[]
      book_new(): WorkBook
      book_append_sheet(wb: WorkBook, ws: WorkSheet, name?: string): void
      aoa_to_sheet(data: unknown[][]): WorkSheet
    }
  }
  export default XLSX
}
