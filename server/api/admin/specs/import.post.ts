// POST /api/admin/specs/import —— 规格批量导入（Excel，2026-09-07）
// 模板（public/templates/spec-import-template.xlsx，与用户标准模板同构）：仅一列「规格」，
// 支持单件「200毫升/瓶」和成组「500ml/瓶✖10」；单位及乘号规范化后查重。
import XLSX from 'xlsx'
import { getPool, query } from '../../../utils/db'
import { requireWritableUser } from '../../../utils/auth'
import { lockSpecEnterprise, readAvailableSpecCodes } from '../../../utils/spec-code'
import { parseSpecification } from '#shared/utils/specification'
import { logOperation } from '../../../utils/audit'

const HEADER_RE = /^(规格|规格名称|名称)$/
const MAX_ROWS = 5000 // 单次导入上限（PRD 5.3：单次上限 5000 条）

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)

  // 归属企业：平台管理员从 multipart 字段 enterpriseId 指定（前端弹窗提供企业下拉），企业角色取自身
  let fid: number | null = null
  if (user.role !== 'platform_admin') {
    fid = Number(user.enterprise_id)
    if (!Number.isInteger(fid) || fid <= 0) throw createError({ statusCode: 400, statusMessage: '当前账号未绑定企业，无法导入规格' })
  }

  // 解析 multipart：字段部分取 enterpriseId（platform_admin 场景），文件部分取首个 xlsx
  const parts = await readMultipartFormData(event).catch(() => undefined)
  if (!parts?.length) throw createError({ statusCode: 400, statusMessage: '请选择要导入的 Excel 文件' })
  // 文件 part 判据：h3 multipart 中带 filename 的即为文件（普通字段无 filename，type 属性并不存在）
  let file: { data: Buffer; filename?: string } | undefined
  for (const p of parts as any[]) {
    if (p?.filename !== undefined && p?.data?.length) { file = p as { data: Buffer; filename?: string }; continue }
    if (user.role === 'platform_admin' && p?.name === 'enterpriseId' && p?.data) {
      const eid = Number(String(p.data).trim())
      if (Number.isInteger(eid) && eid > 0) fid = eid
    }
  }
  if (user.role === 'platform_admin' && (!Number.isInteger(fid) || (fid as number) <= 0)) {
    throw createError({ statusCode: 400, statusMessage: '请指定有效的企业ID' })
  }
  if (!file?.data?.length) throw createError({ statusCode: 400, statusMessage: '请选择要导入的 Excel 文件' })
  const name = String(file.filename || '')
  if (!/\.(xlsx|xls)$/i.test(name)) throw createError({ statusCode: 400, statusMessage: '仅支持 .xlsx / .xls 格式的 Excel 文件' })
  if (file.data.length > 10 * 1024 * 1024) throw createError({ statusCode: 400, statusMessage: '文件过大（上限 10MB）' })

  // 解析 Excel（取第一个工作表）
  let rows: string[][]
  try {
    const wb = XLSX.read(file.data, { type: 'buffer', cellDates: false })
    const ws = wb.Sheets[wb.SheetNames[0] ?? '']
    if (!ws) throw createError({ statusCode: 400, statusMessage: 'Excel 中没有工作表' })
    rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Excel 文件解析失败，请确认文件未损坏且为有效的工作簿' })
  }
  if (!rows.length) throw createError({ statusCode: 400, statusMessage: 'Excel 中没有数据' })

  const errors: { row: number; value: string; reason: string }[] = []
  const okRows: { name: string; net: number; unit: string; pack: string; quantity: number; row: number; raw: string }[] = []
  const seen = new Set<string>() // 文件内名称去重

  for (let i = 0; i < rows.length; i++) {
    const excelRow = i + 1 // Excel 行号（1 基，含表头行）
    const raw = String(rows[i]?.[0] ?? '').trim()
    if (!raw) continue // 空行跳过
    if (excelRow === 1 && HEADER_RE.test(raw)) continue // 表头行（首行「规格」等）
    const parsed = parseSpecification(raw)
    if (!parsed) {
      errors.push({ row: excelRow, value: raw, reason: '格式无法识别：如500毫升×10瓶，兼容500ml/瓶✖10；数量须为1～999999整数' })
      continue
    }
    if (seen.has(parsed.name)) {
      errors.push({ row: excelRow, value: raw, reason: '与文件中第 ' + (i + 1) + ' 行之前的同名规格重复（文件内名称须唯一）' })
      continue
    }
    seen.add(parsed.name)
    okRows.push({ ...parsed, row: excelRow, raw })
  }
  if (okRows.length > MAX_ROWS) {
    throw createError({ statusCode: 400, statusMessage: '有效数据超过单次上限（' + MAX_ROWS + ' 条），请拆分后分批导入' })
  }
  if (!okRows.length) {
    return { ok: true, success: 0, failed: errors.length, errors } // 全失败：无写入，直接返回明细
  }

  // 库内名称查重（一次取全，避免逐行查询）；注意：query() 返回行数组本身，勿用数组解构（AGENTS 踩坑）
  const dupMap = new Map<string, number>()
  // 同企业至多999个规格码，新旧标准名称归一查重，自定义名称保持原文。
  const dups = await query<any[]>('SELECT spec_name FROM product_spec WHERE enterprise_id = ?', [fid])
  dups.forEach((d: any) => dupMap.set(parseSpecification(String(d.spec_name))?.name || String(d.spec_name), 1))
  const finalOk: typeof okRows = []
  for (const r of okRows) {
    if (dupMap.has(r.name)) {
      errors.push({ row: r.row, value: r.raw, reason: '该规格名称已存在' })
    } else {
      finalOk.push(r)
    }
  }
  if (!finalOk.length) {
    return { ok: true, success: 0, failed: errors.length, errors }
  }

  // 与手动新增共用企业锁，锁后重新查重并一次读取全部空闲码，允许使用编号空洞。
  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await lockSpecEnterprise(conn, fid as number)
    const [currentRows] = await conn.query<any[]>('SELECT spec_name FROM product_spec WHERE enterprise_id = ?', [fid])
    const currentNames = new Set(currentRows.map(row => parseSpecification(String(row.spec_name))?.name || String(row.spec_name)))
    const insertedRows = finalOk.filter(row => {
      if (!currentNames.has(row.name)) return true
      errors.push({ row: row.row, value: row.raw, reason: '该规格名称已存在' })
      return false
    })
    finalOk.splice(0, finalOk.length, ...insertedRows)
    const available = await readAvailableSpecCodes(conn, fid as number)
    if (finalOk.length > available.length) throw createError({ statusCode: 400, statusMessage: '空闲规格码不足，本次导入未写入，请减少导入数量' })
    for (let i = 0; i < finalOk.length; i++) {
      const r = finalOk[i]!
      const specCode = available[i]!
      await conn.execute(
        'INSERT INTO product_spec (enterprise_id, spec_name, net_content, content_unit, pack_unit, pack_quantity, spec_code, status) VALUES (?,?,?,?,?,?,?,1)',
        [fid, r.name, r.net, r.unit, r.pack, r.quantity, specCode])
    }
    await conn.commit()
  } catch (e: any) {
    await conn.rollback().catch(() => {})
    // 并发撞名称/规格码唯一键 → 提示重试
    if (e?.code === 'ER_DUP_ENTRY') {
      conn.release()
      throw createError({ statusCode: 400, statusMessage: '导入数据与库内规格冲突（名称或规格码），请刷新后重试' })
    }
    conn.release()
    throw e
  }
  conn.release()

  // 审计：统计 + 失败明细前 10 条（防 content 过大）
  await logOperation(event, {
    module: '规格管理',
    action: '批量导入规格',
    content: JSON.stringify({ fileName: name, success: finalOk.length, failed: errors.length, firstErrors: errors.slice(0, 10) }),
  })
  // 错误按 Excel 行号升序返回（去重后的错误需与最终一致排序）
  errors.sort((a, b) => a.row - b.row)
  return { ok: true, success: finalOk.length, failed: errors.length, errors }
})
