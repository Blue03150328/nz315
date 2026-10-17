import { deflateRawSync, inflateRawSync } from 'node:zlib'

const xml = (value: unknown) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[ch]!)
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
function crc32(data: Buffer) {
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** 只处理随应用发布的可信模板，保留其他压缩条目，避免重写工作簿丢失下拉验证和冻结行。 */
export function fillProductTemplate(template: Buffer, specs: any[], enterpriseName: string) {
  const end = template.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0) throw new Error('产品模板文件损坏')
  let pos = template.readUInt32LE(end + 16)
  const count = template.readUInt16LE(end + 10)
  const locals: Buffer[] = [], centrals: Buffer[] = []
  let offset = 0, replaced = false
  for (let i = 0; i < count; i++) {
    const nameLength = template.readUInt16LE(pos + 28), extraLength = template.readUInt16LE(pos + 30), commentLength = template.readUInt16LE(pos + 32)
    const name = template.subarray(pos + 46, pos + 46 + nameLength)
    const localPos = template.readUInt32LE(pos + 42)
    const dataStart = localPos + 30 + template.readUInt16LE(localPos + 26) + template.readUInt16LE(localPos + 28)
    let method = template.readUInt16LE(pos + 10), crc = template.readUInt32LE(pos + 16), size = template.readUInt32LE(pos + 24)
    let packed = template.subarray(dataStart, dataStart + template.readUInt32LE(pos + 20))
    if (name.toString() === 'xl/worksheets/sheet3.xml') {
      if (![0, 8].includes(method)) throw new Error('产品模板压缩格式不支持')
      const source = (method === 8 ? inflateRawSync(packed) : packed).toString('utf8')
      const rows = [['规格代码', '规格', '归属企业', '状态'], ...specs.map(spec => [String(spec.spec_code), String(spec.spec_name), enterpriseName, '启用'])]
      if (!specs.length) rows.push(['', '暂无启用规格，请先在规格管理建档', enterpriseName, ''])
      const prefix = source.includes('<x:sheetData') ? 'x:' : ''
      const header = source.match(/<(?:x:)?row\b[^>]*\br="1"[^>]*>[\s\S]*?<\/(?:x:)?row>/)?.[0]
      if (!header) throw new Error('产品模板缺少规格表头')
      // 动态规格行继承模板数据行的边框、居中和行高，避免下载后恢复默认左对齐。
      const sampleRow = source.match(/<(?:x:)?row\b[^>]*\br="2"[^>]*>[\s\S]*?<\/(?:x:)?row>/)?.[0] || ''
      const rowFormat = sampleRow.match(/^<[^>]*\br="2"([^>]*)>/)?.[1] || ''
      const styles = ['A', 'B', 'C', 'D'].map(col => sampleRow.match(new RegExp('<(?:x:)?c\\b[^>]*\\br="' + col + '2"[^>]*\\bs="(\\d+)"'))?.[1])
      const sheetData = '<' + prefix + 'sheetData>' + header + rows.slice(1).map((row, r) => '<' + prefix + 'row r="' + (r + 2) + '"' + rowFormat + '>' + row.map((value, c) => '<' + prefix + 'c r="' + String.fromCharCode(65 + c) + (r + 2) + '"' + (styles[c] ? ' s="' + styles[c] + '"' : '') + ' t="inlineStr"><' + prefix + 'is><' + prefix + 't xml:space="preserve">' + xml(value) + '</' + prefix + 't></' + prefix + 'is></' + prefix + 'c>').join('') + '</' + prefix + 'row>').join('') + '</' + prefix + 'sheetData>'
      const data = Buffer.from(source.replace(/<(?:x:)?sheetData(?:\s[^>]*)?>[\s\S]*?<\/(?:x:)?sheetData>|<(?:x:)?sheetData\s*\/>/, sheetData).replace(/<(?:x:)?dimension\b[^>]*\/>/, '<' + prefix + 'dimension ref="A1:D' + rows.length + '"/>'))
      packed = deflateRawSync(data); method = 8; size = data.length; crc = crc32(data); replaced = true
    }
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(size, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(local, name, packed); centrals.push(central, name)
    offset += local.length + name.length + packed.length
    pos += 46 + nameLength + extraLength + commentLength
  }
  if (!replaced) throw new Error('产品模板缺少规格对照表')
  const directory = Buffer.concat(centrals), footer = Buffer.alloc(22)
  footer.writeUInt32LE(0x06054b50); footer.writeUInt16LE(count, 8); footer.writeUInt16LE(count, 10); footer.writeUInt32LE(directory.length, 12); footer.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, footer])
}
