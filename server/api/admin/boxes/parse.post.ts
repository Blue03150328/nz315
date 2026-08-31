// POST /api/admin/boxes/parse —— 外箱码文件解析校验（PRD 5.5.6）
// 文件格式：每行 "外箱码,单品码"（CSV 两列）；外箱码/单品码均 32 位数字
import { query } from '../../../utils/db'
import { requireBackendUser } from '../../../utils/auth'

const CODE_RE = /^\d{32}$/

export default defineEventHandler(async (event) => {
  const user = await requireBackendUser(event)
  const body = await readBody(event) || {}

  let rawLines: string[] = []
  if (Array.isArray(body.codes)) {
    rawLines = body.codes.map((c: any) => String(c))
  } else if (typeof body.content === 'string') {
    rawLines = body.content.split(/\r?\n/)
  } else {
    throw createError({ statusCode: 400, statusMessage: '请上传外箱码文件或粘贴文本' })
  }

  const fid = user.role === 'platform_admin' ? null : user.enterprise_id
  const [fidSql, fidParams] = fid ? [' AND enterprise_id = ?', [fid]] : ['', []]

  // 系统内全部单品码（用于校验存在性）
  const codeRows = await query<any[]>('SELECT code, abnormal_flag, outer_box_code FROM trace_code WHERE 1=1' + fidSql, fidParams)
  const codeMap = new Map(codeRows.map((r: any) => [String(r.code), r]))

  const pairs: { outer: string; inner: string; line: string; error: string }[] = []
  for (const raw of rawLines) {
    const line = String(raw).replace(/^\uFEFF/, '').trim()
    if (!line) continue
    const parts = line.split(/[,\t\s]+/).filter(Boolean)
    const outer = parts[0] || ''
    const inner = parts[1] || ''
    let error = ''
    if (!CODE_RE.test(outer) || !CODE_RE.test(inner)) {
      error = '外箱码/单品码须为32位数字'
    } else {
      const rec = codeMap.get(inner)
      if (!rec) {
        error = '单品码不在系统中'
      } else if (Number(rec.abnormal_flag) !== 0) {
        error = '单品码异常标记非正常（' + (Number(rec.abnormal_flag) === 2 ? '已作废' : '已冻结') + '）'
      } else if (rec.outer_box_code) {
        error = '单品码已归属其他外箱码'
      }
    }
    pairs.push({ outer, inner, line, error })
  }

  // 外箱码唯一性校验（系统内已有外箱码）
  const outerSet = new Set<string>()
  for (const p of pairs.filter(p => !p.error)) {
    outerSet.add(p.outer)
  }
  const outerList = [...outerSet]
  const dupOuters = new Set<string>()
  if (outerList.length) {
    const placeholders = outerList.map(() => '?').join(',')
    const rows = await query<any[]>(
      'SELECT DISTINCT outer_box_code AS code FROM trace_code WHERE outer_box_code IN (' + placeholders + ')' + fidSql,
      [...outerList, ...fidParams])
    for (const r of rows) dupOuters.add(String(r.code))
  }
  // 文件内重复单品码检查
  const seenInner = new Map<string, number>()
  for (const p of pairs) {
    if (!p.error) {
      const prev = seenInner.get(p.inner)
      if (prev !== undefined) {
        p.error = '文件内单品码重复'
        pairs[prev].error = '文件内单品码重复'
      } else {
        seenInner.set(p.inner, pairs.indexOf(p))
      }
    }
  }
  // 外箱码重复标记
  for (const p of pairs) {
    if (!p.error && dupOuters.has(p.outer)) p.error = '外箱码已存在'
  }

  const valid = pairs.filter(p => !p.error)
  const invalid = pairs.filter(p => p.error)
  // 按外箱码分组统计
  const boxGroups = new Map<string, number>()
  for (const p of valid) boxGroups.set(p.outer, (boxGroups.get(p.outer) || 0) + 1)

  return {
    total: pairs.length,
    validCount: valid.length,
    invalidCount: invalid.length,
    reasonCount: invalid.reduce<Record<string, number>>((acc, p) => {
      acc[p.error] = (acc[p.error] || 0) + 1
      return acc
    }, {}),
    boxGroups: [...boxGroups.entries()].map(([code, count]) => ({ code, count })),
    preview: pairs.slice(0, 20),
  }
})
