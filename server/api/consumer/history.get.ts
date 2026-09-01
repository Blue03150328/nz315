// 个人中心「我的查询记录」：直接取自真实扫码日志 scan_log（登录后扫码才会归属到本人）
// 说明：本项目「查询档案」与「查询历史」为同一份数据，不额外维护收藏表
import { requireConsumer } from '~~/server/utils/consumer-auth'
import { query } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const consumer = await requireConsumer(event)
  const q = getQuery(event)
  const page = Math.max(1, Number(q.page || 1))
  const pageSize = Math.min(50, Math.max(1, Number(q.pageSize || 20)))
  const offset = (page - 1) * pageSize

  const rows = await query<any[]>(
    `SELECT s.id, s.code, s.scan_time, s.province, s.city, s.scan_device,
            p.name AS product_name, p.holder_name,
            ps.spec_name,
            t.abnormal_flag, t.status AS code_status
     FROM scan_log s
     LEFT JOIN product p ON p.id = s.product_id
     LEFT JOIN product_spec ps ON ps.id = p.spec_id
     LEFT JOIN trace_code t ON t.code = s.code
     WHERE s.consumer_id = ?
     ORDER BY s.id DESC
     LIMIT ? OFFSET ?`,
    [consumer.id, pageSize, offset],
  )
  const [cnt] = await query<any[]>('SELECT COUNT(*) AS total FROM scan_log WHERE consumer_id = ?', [consumer.id])

  return {
    total: Number(cnt?.total || 0),
    page,
    pageSize,
    rows: rows.map(r => ({
      id: Number(r.id),
      code: r.code,
      scanTime: r.scan_time,
      location: [r.province, r.city].filter(Boolean).join(''),
      device: r.scan_device,
      productName: r.product_name,
      holderName: r.holder_name,
      spec: r.spec_name || '',
      abnormalFlag: r.abnormal_flag === null ? null : Number(r.abnormal_flag),
      codeStatus: r.code_status === null ? null : Number(r.code_status),
    })),
  }
})
