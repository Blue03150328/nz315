// POST /api/admin/external-verify：扫描外部二维码并保存一次核验快照
import { execute } from '../../utils/db'
import { requireWritableUser } from '../../utils/auth'
import { triggerAlert } from '../../utils/risk-alert'
import { verifyExternalCode } from '../../utils/external-verification'

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const body = await readBody(event) || {}
  const result = await verifyExternalCode({
    sourceUrl: String(body.sourceUrl || ''),
    code: String(body.code || ''),
    pageText: String(body.pageText || ''),
    enterpriseId: user.enterprise_id,
    userId: user.id,
  })
  const insert = await execute(
    'INSERT INTO external_verification (source_url, source_platform, code, code_parts, source_data, registration_candidates, result, overall_status, created_by, enterprise_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [result.source.sourceUrl || String(body.sourceUrl || ''), result.source.platform, result.source.code,
      JSON.stringify(result.codeParts), JSON.stringify(result.source), JSON.stringify(result.registrationCandidates), JSON.stringify(result), result.overallStatus, user.id, user.enterprise_id ?? null])
  const verificationId = Number(insert.insertId)
  result.id = verificationId
  if (result.overallStatus === 'mismatch') {
    const mismatches = result.items.filter(item => item.status === 'mismatch')
    const alertTypes = new Set(mismatches.map(item => item.key === 'holder-name' ? 6 : item.key === 'product-name' ? 5 : item.key === 'registration-no' || item.key === 'registration-suffix' ? 3 : 7))
    for (const alertType of alertTypes) {
    await triggerAlert(event, {
      alertType,
      enterpriseId: result.localProduct?.enterpriseId ?? user.enterprise_id ?? null,
      productId: result.localProduct?.id ?? null,
      externalVerificationId: verificationId,
      evidence: { verificationId, sourceUrl: result.source.sourceUrl, code: result.source.code, mismatches },
    })
    }
  }
  return result
})
