// 直连本机 dev 的 /api/bill，验证接口层本身正常（与前端修复解耦）
import fs from 'node:fs'
const { token } = JSON.parse(fs.readFileSync(new URL('./session.json', import.meta.url), 'utf8'))

const body = {
  billDate: '2026-10-06',
  productName: '接口层验证产品',
  dosage: '悬浮剂',
  category: '杀虫剂',
  crop: '水稻',
  quantity: null,
  unit: '瓶',
  unitPrice: null,
  totalAmount: 112121212,
  channel: '农资店',
  storeName: 'XX 农资店',
  remark: '本机接口验证',
}

const res = await fetch('http://localhost:3100/api/bill', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: 'nz315_consumer=' + token },
  body: JSON.stringify(body),
})
console.log('[接口] status =', res.status)
console.log('[接口] body   =', await res.text())
