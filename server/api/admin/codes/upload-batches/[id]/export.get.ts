// GET /api/admin/codes/upload-batches/:id/export —— 导出「生成入库」留档批次的追溯码（2026-10-10）
// 背景：生成页（generator）生成的码不落库，若未及时下载文件且页面已刷新/关闭，码将无法找回；
//       用户在此前先「入库留档」后，本接口提供按批次重新导出的出口，使留档成为真正可回捞的保险箱。
// 范围裁定（用户 2026-10-10）：**仅「生成入库」留档批次**开放导出 —— 生产采集上传的批次本就源自客户本地文件，
//       无须再导出，收窄范围也可避免把该接口当成任意批次的批量导出通道。
// 权限：登录即可（导出属读取行为，只读账号 viewer 亦可用）；企业隔离与非 platform_admin 全量口径同其他码库接口。
// 格式：txt（每行一个 32 位码）/ urls（每行完整扫码 URL，供离线生图工具导入）/ csv（sn 清单，列对齐生成页导出）。
// 大文件：单批上限 50 万条（txt ≈ 16MB / csv ≈ 80MB），故用游标分页 + 流式响应，避免一次性进内存。
import { Readable } from 'node:stream'
import { query } from '../../../../../utils/db'
import { requireBackendUser } from '../../../../../utils/auth'
import { logOperation } from '../../../../../utils/audit'

// 留档批次文件名前缀：stock-in.post.ts 建档时固定写入「生成入库 + 时间」
const STOCK_IN_PREFIX = '生成入库'
const CHUNK = 5000

const PRODUCE_TYPE_LABEL: Record<string, string> = { '1': '持有人生产', '2': '委托加工', '3': '委托分装' }
const CSV_HEADER = 'sn,农药名称,登记证号,生产企业,生产类型,规格码,生成时间,绑定状态,登记类别,登记证后6位,自定义段'

const csvCell = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
const pad2 = (n: number) => String(n).padStart(2, '0')

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const ubId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(ubId) || ubId <= 0) throw createError({ statusCode: 400, statusMessage: '无效的上传批次ID' })

  const format = String(getQuery(event).format || 'txt')
  if (!['txt', 'urls', 'csv'].includes(format)) throw createError({ statusCode: 400, statusMessage: '导出格式不支持' })

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [ub] = await query<any[]>(
    `SELECT ub.id, ub.file_name, ub.created_at, ub.enterprise_id,
       p.name AS product_name, p.registration_no, p.produce_type,
       s.spec_name, s.spec_code,
       e.name AS company_name
     FROM upload_batch ub
     LEFT JOIN product p ON p.id = ub.product_id
     LEFT JOIN product_spec s ON p.spec_id = s.id
     LEFT JOIN enterprise e ON e.id = ub.enterprise_id
     WHERE ub.id = ?` + (fid ? ' AND ub.enterprise_id = ?' : ''),
    fid ? [ubId, fid] : [ubId])
  if (!ub) throw createError({ statusCode: 404, statusMessage: '上传批次不存在或不属于本企业' })
  if (!String(ub.file_name || '').startsWith(STOCK_IN_PREFIX)) {
    throw createError({ statusCode: 403, statusMessage: '仅「生成入库」留档批次支持导出（生产采集上传的批次请使用原始文件）' })
  }

  const codeWhere = ' WHERE upload_batch_id = ?' + (fid ? ' AND enterprise_id = ?' : '')
  const codeParams = fid ? [ubId, fid] : [ubId]
  const [cntRow] = await query<any[]>('SELECT COUNT(*) AS c FROM trace_code' + codeWhere, codeParams)
  const total = Number(cntRow?.c || 0)
  if (total <= 0) throw createError({ statusCode: 400, statusMessage: '该批次没有可导出的追溯码' })

  // 文件命名对齐生成页导出规则（PRD 5.5.1 强制命名），日期取批次建档日
  const d = new Date(String(ub.created_at).replace(' ', 'T'))
  const ymd = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate())
  const safe = (s: unknown) => String(s ?? '').replace(/[\\/:*?"<>|]/g, '_')
  const base = safe(ub.enterprise_id) + '_' + safe(ub.product_name) + '_' + safe(ub.spec_name) + '_' + ymd
  const fileName = format === 'urls'
    ? safe(ub.registration_no) + '_' + safe(ub.product_name) + '_' + total + '_' + ymd + '_urls.txt'
    : base + (format === 'csv' ? '.csv' : '.txt')

  const traceBaseUrl = String(useRuntimeConfig().public?.traceBaseUrl || 'https://www.nz315.cn/trace?code=')
  const genTime = String(ub.created_at).slice(0, 19)
  const sep = format === 'csv' ? '\r\n' : '\n'

  const lineOf = (r: any): string => {
    const code = String(r.code)
    if (format === 'txt') return code
    if (format === 'urls') return traceBaseUrl + code
    // noUncheckedIndexedAccess 下 seg[i] 为 string | undefined，索引前先补空串（避免 undefined 进 CSV 或当索引）
    const seg = [code.slice(0, 1), code.slice(1, 7), code.slice(7, 8), code.slice(8, 11), code.slice(11, 32)]
    const produceType = seg[2] ?? ''
    return [
      code,
      csvCell(ub.product_name),
      csvCell(ub.registration_no),
      csvCell(ub.company_name),
      csvCell(PRODUCE_TYPE_LABEL[produceType] || produceType),
      csvCell(seg[3] ?? ''),
      csvCell(genTime),
      Number(r.status) === 2 ? '已绑定' : '未绑定',
      seg[0] ?? '', seg[1] ?? '', seg[4] ?? '',
    ].join(',')
  }

  // 游标分页（id > lastId）而非 OFFSET：50 万条时 OFFSET 深翻页会明显拖慢
  async function* emit() {
    yield format === 'csv' ? '\uFEFF' + CSV_HEADER + '\r\n' : '\uFEFF'
    let lastId = 0
    while (true) {
      const rows = await query<any[]>(
        'SELECT id, code, status FROM trace_code' + codeWhere + ' AND id > ? ORDER BY id ASC LIMIT ?',
        [...codeParams, lastId, CHUNK])
      if (!rows.length) break
      yield rows.map(lineOf).join(sep) + sep
      lastId = Number(rows[rows.length - 1].id)
      if (rows.length < CHUNK) break
    }
  }

  setResponseHeaders(event, {
    'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8',
    // 中文文件名必须走 RFC 5987（filename*），否则部分浏览器会把中文名截断/乱码
    'Content-Disposition': 'attachment; filename="' + (format === 'csv' ? 'codes.csv' : format === 'urls' ? 'codes_urls.txt' : 'codes.txt') + '"; filename*=UTF-8\'\'' + encodeURIComponent(fileName),
    'Cache-Control': 'no-store',
  })
  await logOperation(event, {
    module: '码库管理',
    action: '导出留档码',
    content: JSON.stringify({ uploadBatchId: ubId, fileName: ub.file_name, format, count: total }),
  })
  return sendStream(event, Readable.from(emit()))
})
