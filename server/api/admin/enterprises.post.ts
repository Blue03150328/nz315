// 总部专用企业入驻；权限校验先于读取资料和写库，其他后台账号无法自行创建企业。
import { requirePlatformAdmin } from '../../utils/auth'
import { query, execute } from '../../utils/db'
import { logOperation } from '../../utils/audit'
import { enterpriseCreateInput } from '../../utils/enterprise-input'

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event)
  const body = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: '请填写企业资料' })
  }
  const [clock] = await query<any[]>('SELECT CURDATE() AS today')
  let input
  try {
    input = enterpriseCreateInput(body, String(clock.today).slice(0, 10))
  } catch (error: any) {
    throw createError({ statusCode: 400, statusMessage: error.message })
  }
  let result
  try {
    // 信用代码唯一索引同时拦截重复点击和并发创建，不依赖先查后写。
    result = await execute(
      `INSERT INTO enterprise (name, credit_code, unit_code, contact, phone, legal_person,
         license_no, qualification_expire, renew_expire, status) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [input.name, input.creditCode, input.unitCode || null, input.contact, input.phone, input.legalPerson,
        input.licenseNo, input.qualificationExpire, input.renewExpire, input.status],
    )
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') {
      throw createError({ statusCode: 409, statusMessage: '该统一社会信用代码已入驻，请查询已有企业' })
    }
    throw error
  }
  const id = Number(result.insertId)
  await logOperation(event, {
    module: '系统设置', action: '新增企业',
    content: JSON.stringify({ id, name: input.name, creditCode: input.creditCode, renewExpire: input.renewExpire, status: input.status }),
  })
  return { ok: true, id, name: input.name }
})
