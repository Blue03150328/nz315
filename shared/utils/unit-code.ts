// 32 位单元识别代码结构解析 + 展示文案（前后端共用，无任何外部依赖）
//
// 为什么放 shared：解析规则要被三处共用，任何一处自己写一套就会再次漂移（已经踩过一次坑，
// 见 shared/utils/trace-code.ts 的文件头）：
//   ① 服务端「外部二维码核验」  server/utils/external-verification.ts
//   ② 服务端「登记资料库兜底」  server/utils/registry-lookup.ts（公众端 /api/trace）
//   ③ 前端结果页展示（编码结构解析卡）app/components/TraceExternal.vue · TraceNotFound.vue
//
// 结构（农业农村部公告第1049号 32 位单元识别代码）：
//   第 1 位     农药类别（1=PD 类，2=WP 类）
//   第 2-7 位   农药登记证号后 6 位
//   第 8 位     生产类型（1=登记证持有人生产，2=委托加工，3=委托分装）
//   第 9-32 位  自定义段（规格码 + 流水 + 校验位等；本平台仅留证，不据此判定真伪）
import type { ExternalCodeParts } from '#shared/types/external-verification'

/** 单元识别代码最小长度校验：至少 32 位纯数字 */
export const UNIT_CODE_RE = /^\d{32,}$/

/** 解析 32 位单元识别代码的前 8 位结构（各段含义见文件头注释） */
export function parseUnitCode(code: string): ExternalCodeParts {
  const value = String(code || '')
  const categoryCode = value.slice(0, 1)
  const productionTypeCode = value.slice(7, 8)
  return {
    length: value.length,
    categoryCode,
    categoryLabel: categoryCode === '1' ? 'PD' : categoryCode === '2' ? 'WP' : '未知',
    registrationLast6: value.slice(1, 7),
    productionTypeCode,
    productionTypeLabel: productionTypeCode === '1' ? '登记证持有人生产' : productionTypeCode === '2' ? '委托加工' : productionTypeCode === '3' ? '委托分装' : '未知',
    suffix: value.slice(8),
    validLength: UNIT_CODE_RE.test(value),
    validCategory: categoryCode === '1' || categoryCode === '2',
    validProductionType: ['1', '2', '3'].includes(productionTypeCode),
  }
}

/** 前 8 位结构整体是否合规（结构都不合规的码，基本可按伪造对待） */
export function isUnitCodeStructureValid(
  parts: Pick<ExternalCodeParts, 'validLength' | 'validCategory' | 'validProductionType'> | undefined | null,
): boolean {
  return !!parts && parts.validLength && parts.validCategory && parts.validProductionType
}

/** 农药类别展示文案（不合规时写明规则，而不是只显示「未知」） */
export function unitCodeCategoryText(label: string): string {
  if (label === 'PD' || label === 'WP') return label + ' 类'
  return '不符合规则（应为 1=PD 类 / 2=WP 类）'
}

/** 生产类型展示文案（不合规时写明规则） */
export function unitCodeProductionTypeText(label: string): string {
  if (label === '未知') return '不符合规则（应为 1=持有人生产 / 2=委托加工 / 3=委托分装）'
  return label
}
