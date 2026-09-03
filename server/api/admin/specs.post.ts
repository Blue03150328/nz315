// POST /api/admin/specs —— 新增产品规格（PRD 5.3）
import { query, execute } from '../../utils/db'
import { requireWritableUser } from '../../utils/auth'

/** 企业规格码自动分配：取该企业当前最大规格码 + 1 补零 3 位（首个为 001）。
 *  规格码 = 32 位追溯码第 9-11 位（1049 结构强制段），用户无需感知，系统分配保证企业内唯一 */
async function nextSpecCode(fid: number): Promise<string> {
  const [row] = await query<any[]>('SELECT MAX(CAST(spec_code AS UNSIGNED)) AS m FROM product_spec WHERE enterprise_id = ?', [fid])
  const next = Number(row?.m || 0) + 1
  if (next > 999) throw createError({ statusCode: 400, statusMessage: '该企业规格数量已达上限（999 个）' })
  return String(next).padStart(3, '0')
}

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const body = await readBody(event).catch(() => ({}))
  const specName = String(body?.specName || '').trim()
  const netContent = body?.netContent
  const contentUnit = String(body?.contentUnit || '').trim()
  const packUnit = String(body?.packUnit || '').trim()
  const status = body?.status === 0 ? 0 : 1

  // 校验
  if (!specName) throw createError({ statusCode: 400, statusMessage: '请输入规格名称' })
  if (!contentUnit) throw createError({ statusCode: 400, statusMessage: '请选择含量单位' })
  if (!packUnit) throw createError({ statusCode: 400, statusMessage: '请选择包装单位' })

  // 归属企业：平台管理员从请求体指定，企业角色取自身 enterprise_id
  let fid: number
  if (user.role === 'platform_admin') {
    const eid = Number(body?.enterpriseId)
    if (!Number.isInteger(eid) || eid <= 0) throw createError({ statusCode: 400, statusMessage: '请指定有效的企业ID' })
    fid = eid
  } else {
    fid = Number(user.enterprise_id)
    if (!Number.isInteger(fid) || fid <= 0) throw createError({ statusCode: 400, statusMessage: '当前账号未绑定企业，无法创建规格' })
  }

  // 规格名称企业内唯一
  const [dupName] = await query<any[]>(
    'SELECT id FROM product_spec WHERE enterprise_id = ? AND spec_name = ? LIMIT 1', [fid, specName])
  if (dupName) throw createError({ statusCode: 400, statusMessage: '该规格名称已存在' })

  // 自动分配规格码；并发撞唯一键（同企业同码）时换下一码重试（最多 5 次）
  for (let attempt = 0; attempt < 5; attempt++) {
    const specCode = await nextSpecCode(fid)
    try {
      const result = await execute(
        'INSERT INTO product_spec (enterprise_id, spec_name, net_content, content_unit, pack_unit, spec_code, status) VALUES (?,?,?,?,?,?,?)',
        [fid, specName, netContent ?? null, contentUnit, packUnit, specCode, status]
      )
      return { ok: true, id: result.insertId, specCode }
    } catch (e: any) {
      if (e?.code === 'ER_DUP_ENTRY' && String(e?.message || '').includes('uq_enterprise_spec_code')) continue
      throw e
    }
  }
  throw createError({ statusCode: 500, statusMessage: '规格码分配冲突，请重试' })
})
