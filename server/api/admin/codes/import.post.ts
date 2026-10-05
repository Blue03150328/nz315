import { requireWritableUser } from '../../../utils/auth'
import { importCodes } from '../../../utils/code-import'

// 接口只负责认证和读取请求，入库与报告事务由业务模块管理。
export default defineEventHandler(async event => {
  const user = await requireWritableUser(event)
  return importCodes(user, await readBody(event) || {})
})
