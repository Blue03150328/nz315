// 使用标准 ZIP 的存储模式，浏览器本机打包文本；UTF-8 文件名兼容中文，避免多文件下载被拦截。
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value >>> 0
})

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}

/** 顺序构建归档，避免为大批次额外拼接整份二进制数组。 */
export class TextZip {
  private parts: BlobPart[] = []
  private directory: BlobPart[] = []
  private offset = 0
  private directorySize = 0
  private count = 0

  add(name: string, text: string) {
    const encoder = new TextEncoder()
    const filename = encoder.encode(name)
    const data = encoder.encode(text)
    if (filename.length > 65535 || this.count >= 65535 || this.offset + 30 + filename.length + data.length > 0xffffffff) {
      throw new Error('导出文件过大，请减少本次导出数量')
    }
    const crc = crc32(data)
    const header = new Uint8Array(30)
    const local = new DataView(header.buffer)
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true)
    local.setUint16(12, 33, true) // DOS 日期：1980-01-01，保证合法日期。
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, filename.length, true)
    this.parts.push(header, filename, data)

    const central = new Uint8Array(46)
    const entry = new DataView(central.buffer)
    entry.setUint32(0, 0x02014b50, true)
    entry.setUint16(4, 20, true)
    entry.setUint16(6, 20, true)
    entry.setUint16(8, 0x0800, true)
    entry.setUint16(14, 33, true)
    entry.setUint32(16, crc, true)
    entry.setUint32(20, data.length, true)
    entry.setUint32(24, data.length, true)
    entry.setUint16(28, filename.length, true)
    entry.setUint32(42, this.offset, true)
    this.directory.push(central, filename)
    this.directorySize += central.length + filename.length
    this.offset += header.length + filename.length + data.length
    this.count++
  }

  toBlob() {
    if (!this.count) throw new Error('没有可导出的文件')
    const end = new Uint8Array(22)
    const view = new DataView(end.buffer)
    view.setUint32(0, 0x06054b50, true)
    view.setUint16(8, this.count, true)
    view.setUint16(10, this.count, true)
    view.setUint32(12, this.directorySize, true)
    view.setUint32(16, this.offset, true)
    return new Blob([...this.parts, ...this.directory, end], { type: 'application/zip' })
  }
}
