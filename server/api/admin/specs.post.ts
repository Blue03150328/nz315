// POST /api/admin/specs —— 新增产品规格（PRD 5.3）
import { getPool } from '../../utils/db'
import { requireWritableUser } from '../../utils/auth'
import { lockSpecEnterprise, readAvailableSpecCodes } from '../../utils/spec-code'
import { parseSpecCode, parseSpecInput } from '../../utils/spec-input'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const body = await readBody(event).catch(() => ({}))
  const { specName, netContent, contentUnit, packUnit, packQuantity } = parseSpecInput(body)
  const requestedCode = parseSpecCode(body?.specCode)
  const status = body?.status === 0 ? 0 : 1

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

  // 新增与批量导入共用企业行锁；手动选号冲突时返回409，不擅自更换用户选中的号码。
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    await lockSpecEnterprise(conn, fid)
    const [duplicates] = await conn.query<any[]>('SELECT id FROM product_spec WHERE enterprise_id = ? AND spec_name = ? LIMIT 1', [fid, specName])
    if (duplicates.length) throw createError({ statusCode: 400, statusMessage: '该规格名称已存在' })
    const available = await readAvailableSpecCodes(conn, fid)
    const specCode = requestedCode ?? available[0]
    if (!specCode) throw createError({ statusCode: 400, statusMessage: '该企业001～999规格码已全部占用' })
    if (!available.includes(specCode)) throw createError({ statusCode: 409, statusMessage: '该规格码已被占用，请重新选号' })
    const [result]: any = await conn.execute(
      'INSERT INTO product_spec (enterprise_id, spec_name, net_content, content_unit, pack_unit, pack_quantity, spec_code, status) VALUES (?,?,?,?,?,?,?,?)',
      [fid, specName, netContent, contentUnit, packUnit, packQuantity, specCode, status])
    await conn.commit()
    return { ok: true, id: result.insertId, specCode }
  } catch (error: any) {
    await conn.rollback()
    if (error?.code === 'ER_DUP_ENTRY') throw createError({ statusCode: 409, statusMessage: '规格名称或规格码已被占用，请刷新后重试' })
    throw error
  } finally {
    conn.release()
  }
})
