import { isInputDate } from '../../shared/utils/input-date'

/** 新企业资料校验；服务日期与登录守卫使用同一个数据库当天日期。 */
export function enterpriseCreateInput(body: Record<string, unknown>, today: string) {
  const text = (key: string, label: string, max: number, required = true) => {
    const raw = body[key]
    if (raw !== undefined && raw !== null && typeof raw !== 'string') throw new Error(label + '格式不正确')
    const value = String(raw ?? '').trim()
    if (required && !value) throw new Error('请填写：' + label)
    if (value.length > max) throw new Error(label + '不能超过' + max + '个字符')
    return value
  }
  const name = text('name', '企业名称', 255)
  const creditCode = text('creditCode', '统一社会信用代码', 18).toUpperCase()
  if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(creditCode)) throw new Error('统一社会信用代码应为18位有效字母或数字')
  const unitCode = text('unitCode', '单元识别码', 32, false)
  const contact = text('contact', '联系人', 100)
  const phone = text('phone', '联系电话', 50)
  const legalPerson = text('legalPerson', '法定代表人', 100)
  const licenseNo = text('licenseNo', '农药生产许可证号', 100)
  const qualificationExpire = text('qualificationExpire', '资质到期日', 10)
  const renewExpire = text('renewExpire', '服务到期日', 10)
  for (const [label, value] of [['资质到期日', qualificationExpire], ['服务到期日', renewExpire]]) {
    if (!isInputDate(value!)) throw new Error(label + '请输入有效日期，格式为 YYYY-MM-DD')
  }
  if (renewExpire < today) throw new Error('服务到期日不能早于今天')
  const status = body.status ?? 1
  if (status !== 0 && status !== 1) throw new Error('企业状态不正确')
  return { name, creditCode, unitCode, contact, phone, legalPerson, licenseNo, qualificationExpire, renewExpire, status }
}
