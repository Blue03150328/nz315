import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

export const PRICE_FIELDS = [
  ['供货价', 'supply_price'], ['批发价', 'wholesale_price'], ['会员价', 'member_price'],
  ['销售价', 'sale_price'], ['参考价', 'reference_price'], ['划线价', 'list_price'],
  ['最低售价', 'minimum_price'],
]
export const PRODUCT_HEADERS = [
  '商品ID', '商品名称', '商品编码', '商品品牌', '商品状态', '规格名称', '规格值', 'SKU ID',
  ...PRICE_FIELDS.map(([label]) => label), '库存', '重量', '生产日期', '保质期', '起购量',
  '优惠券权限', '商品卖点', '总销量', '创建时间', '更新时间', '图片地址', '供应商名称',
  '服务评分', '店铺类型', '详情页图片地址',
]
export const LISTING_HEADERS = ['店铺ID', '店铺名称', '商品ID', '商品名称']
const DAY = 86400000
export const hash = value => createHash('sha256').update(value).digest('hex')

export function sourceDate(fileName) {
  const match = /^阿尔法农资全平台产品价格表_(\d{4}-\d{2}-\d{2})\.xlsx$/.exec(fileName)
  if (!match || !Number.isFinite(Date.parse(`${match[1]}T00:00:00Z`))
      || new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) !== match[1]) {
    throw new Error('阿尔法文件名称或采集日期不正确')
  }
  return match[1]
}

export function selectLatest(names) {
  const candidates = names.filter(name => /^阿尔法农资全平台产品价格表_.*\.xlsx$/.test(name))
    .map(name => ({ name, date: sourceDate(name) })).sort((a, b) => b.date.localeCompare(a.date))
  if (!candidates.length) throw new Error('未找到阿尔法全平台价格表')
  return candidates[0].name
}

export function checkFreshness(date, now = new Date(), maxAgeDays = 4) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now)
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY
  if (!Number.isInteger(age) || age < 0 || age > maxAgeDays) {
    throw new Error(`采集日期 ${date} 不在最近 ${maxAgeDays} 天内，保留数据库原有资料`)
  }
}

export function syncDue(completedAt, now = new Date(), intervalDays = 15) {
  return !completedAt || now.getTime() - new Date(completedAt).getTime() >= intervalDays * DAY
}

function text(value, label, maxLength, required = false) {
  const valueText = String(value ?? '').trim()
  if ((required && !valueText) || [...valueText].length > maxLength) throw new Error(`${label}为空或过长`)
  return valueText
}

function id(value, label) {
  const result = text(value, label, 64, true)
  if (!/^\d+$/.test(result)) throw new Error(`${label}必须为数字标识，禁止丢失或猜测标识`)
  return result
}

function price(value, label) {
  const result = text(value, label, 30)
  if (!result) return null
  if (!/^\d{1,14}(?:\.\d{1,4})?$/.test(result)) throw new Error(`${label}不是可保存的非负价格`)
  return result
}

export function normalizeSnapshot(productRows, listingRows) {
  if (!productRows.length || !listingRows.length) throw new Error('价格表或店铺上架表为空，拒绝同步')
  const skus = new Set()
  const products = productRows.map((row, index) => {
    const raw = Object.fromEntries(PRODUCT_HEADERS.map(label => [label, String(row[label] ?? '').trim()]))
    const skuId = id(raw['SKU ID'], `第${index + 2}行SKU ID`)
    if (skus.has(skuId)) throw new Error(`文件中SKU ID重复：${skuId}`)
    skus.add(skuId)
    const rawJson = JSON.stringify(raw)
    return [skuId, id(raw['商品ID'], '商品ID'), text(raw['商品名称'], '商品名称', 500, true),
      text(raw['商品编码'], '商品编码', 200), text(raw['商品品牌'], '商品品牌', 200),
      text(raw['规格值'], '规格值', 500), text(raw['供应商名称'], '供应商名称', 500),
      ...PRICE_FIELDS.map(([label]) => price(raw[label], label)), rawJson, hash(rawJson)]
  })
  const listingsSeen = new Set()
  const listings = listingRows.map(row => {
    const shopId = id(row['店铺ID'], '店铺ID')
    const productId = id(row['商品ID'], '店铺商品ID')
    const key = `${shopId}:${productId}`
    if (listingsSeen.has(key)) throw new Error(`店铺上架关系重复：${key}`)
    listingsSeen.add(key)
    return [shopId, productId, text(row['店铺名称'], '店铺名称', 500, true),
      text(row['商品名称'], '店铺商品名称', 500, true)]
  })
  return { products, listings }
}

export function rowsFromSheet(XLSX, sheet, requiredHeaders, label) {
  if (!sheet) throw new Error(`缺少工作表：${label}`)
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false })
  const headers = (matrix.shift() || []).map(value => String(value).trim())
  if (new Set(headers).size !== headers.length || requiredHeaders.some(header => !headers.includes(header))) {
    throw new Error(`${label}表头缺失或重复，拒绝按列位置猜测数据`)
  }
  return matrix.filter(row => row.some(value => String(value).trim() !== '')).map(row =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])))
}

// 单连接数据库锁由调用方持有；整个快照和成功记录在同一事务中落库。
export async function applySnapshot(conn, snapshot, metadata, options = {}) {
  const { products, listings } = snapshot
  const [lastRows] = await conn.query('SELECT * FROM alpha_sync_run ORDER BY completed_at DESC LIMIT 1')
  const last = lastRows[0]
  if (last && metadata.date < last.source_date) throw new Error('拒绝用旧采集日期覆盖较新资料')
  const [same] = await conn.query('SELECT id FROM alpha_sync_run WHERE source_date=? AND file_sha256=?',
    [metadata.date, metadata.sha256])
  if (same.length) return { status: 'skipped', reason: '这份采集文件已经同步', syncId: same[0].id }
  if (last && (products.length < last.price_count * 0.6 || listings.length < last.listing_count * 0.6)) {
    throw new Error('采集条数较上次减少超过40%，需核查采集完整性后再同步')
  }
  const [existing] = await conn.query('SELECT sku_id, row_hash, present_in_latest FROM alpha_product_price')
  const previous = new Map(existing.map(row => [row.sku_id, row]))
  const stats = { inserted: 0, updated: 0, unchanged: 0, missing: 0 }
  for (const product of products) {
    const old = previous.get(product[0])
    stats[!old ? 'inserted' : old.row_hash !== product[15] || !old.present_in_latest ? 'updated' : 'unchanged']++
    previous.delete(product[0])
  }
  stats.missing = [...previous.values()].filter(row => row.present_in_latest).length
  const syncId = randomUUID()
  const now = options.now || new Date()
  const productColumns = ['sku_id', 'product_id', 'product_name', 'product_code', 'brand', 'specification',
    'supplier_name', ...PRICE_FIELDS.map(([, column]) => column), 'raw_data', 'row_hash', 'source_date', 'sync_id', 'synced_at']
  const listingColumns = ['shop_id', 'product_id', 'shop_name', 'product_name', 'source_date', 'sync_id', 'synced_at']
  async function upsert(table, columns, rows, keyColumns) {
    const updates = columns.filter(column => !keyColumns.includes(column)).map(column => `\`${column}\`=VALUES(\`${column}\`)`)
    updates.push('present_in_latest=1')
    for (let offset = 0; offset < rows.length; offset += 300) {
      const batch = rows.slice(offset, offset + 300).map(row => [...row, metadata.date, syncId, now])
      await conn.query(`INSERT INTO ${table} (${columns.map(column => `\`${column}\``).join(',')}) VALUES ? ON DUPLICATE KEY UPDATE ${updates.join(',')}`, [batch])
    }
    // 来源文件中消失的记录保留，只标记本轮未出现，不推断其已下架。
    await conn.query(`UPDATE ${table} SET present_in_latest=0 WHERE sync_id<>? AND present_in_latest=1`, [syncId])
  }
  await conn.beginTransaction()
  try {
    await upsert('alpha_product_price', productColumns, products, ['sku_id'])
    await upsert('alpha_shop_listing', listingColumns, listings, ['shop_id', 'product_id'])
    await conn.execute(`INSERT INTO alpha_sync_run
      (id,source_date,file_name,file_sha256,price_count,listing_count,inserted_count,updated_count,unchanged_count,missing_count,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [syncId, metadata.date, path.basename(metadata.file), metadata.sha256,
      products.length, listings.length, stats.inserted, stats.updated, stats.unchanged, stats.missing, now])
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  }
  return { status: 'success', syncId, sourceDate: metadata.date, prices: products.length, listings: listings.length, ...stats }
}
