// POST /api/admin/products —— 新增产品（PRD 5.4）
// 原药（母药）信息多行化（2026-09-04）：body.originals = [{ regNo, company }]，
// 至少 1 行且每行两字段必填；写入 product + product_original（事务）
import { getPool, query } from '../../utils/db'
import { requireWritableUser } from '../../utils/auth'
import { normalizeOrgName, registrationExistsInRegistry } from '../../utils/regdata'
import { triggerAlert } from '../../utils/risk-alert'

/** 厂家名（登记数据源 company）→ 系统企业 id：企业名称归一化相等匹配；未入驻返回 null */
async function resolveEnterpriseByCompany(companyName: string): Promise<number | null> {
  const norm = normalizeOrgName(companyName)
  if (!norm) return null
  const rows = await query<any[]>('SELECT id, name FROM enterprise WHERE status = 1')
  for (const ent of rows) {
    if (normalizeOrgName(String(ent.name || '')) === norm) return Number(ent.id)
  }
  return null
}

export default defineEventHandler(async (event) => {
  const user = await requireWritableUser(event)
  const body = await readBody(event) || {}

  const name = String(body.name || '').trim()
  const registrationNo = String(body.registrationNo || '').trim().toUpperCase()
  if (!registrationNo) throw createError({ statusCode: 400, statusMessage: '请输入登记证号' })
  if (!name) throw createError({ statusCode: 400, statusMessage: '请输入农药名称' })
  if (!body.specId) throw createError({ statusCode: 400, statusMessage: '请选择规格（来自产品规格主数据）' })
  if (!String(body.category || '').trim()) throw createError({ statusCode: 400, statusMessage: '请选择产品类别' })

  // 原药行校验：至少 1 行，每行登记证号与企业名称必填（含手动输入的自定义内容，需非空）
  const originals = Array.isArray(body.originals) ? body.originals : []
  if (!originals.length) throw createError({ statusCode: 400, statusMessage: '原药信息至少保留 1 行' })
  const validOriginals = originals.filter((row: any) => String(row.regNo || '').trim() || String(row.company || '').trim() || String(row.ingredient || '').trim())
  if (!validOriginals.length) throw createError({ statusCode: 400, statusMessage: '原药信息至少保留 1 行有效记录' })
  for (const row of validOriginals) if (!String(row.regNo || '').trim() || !String(row.company || '').trim()) throw createError({ statusCode: 400, statusMessage: '原药登记证号与原药生产企业名称需同时填写' })

  // 登记证号全局唯一（PRD 5.4 业务规则1）
  const [dup] = await query<any[]>('SELECT id FROM product WHERE registration_no = ? LIMIT 1', [registrationNo])
  if (dup) throw createError({ statusCode: 400, statusMessage: '该登记证号已存在' })

  let fid: number | null = user.enterprise_id
  if (user.role === 'platform_admin') {
    // 2026-09-07：归属厂家 = 登记数据源厂家名（company 参数）→ 解析为已入驻系统企业（归一化名称相等）
    const companyName = String(body.company || '').trim()
    const entIdByCompany = companyName ? await resolveEnterpriseByCompany(companyName) : null
    if (entIdByCompany) {
      fid = entIdByCompany
    } else {
      fid = Number(body.enterpriseId)
      if (!Number.isInteger(fid) || (fid as number) <= 0) {
        throw createError({
          statusCode: 400,
          statusMessage: companyName
            ? '厂家「' + companyName.slice(0, 40) + '」尚未入驻平台（无系统企业账号），无法归属建档；请先在系统设置创建该企业，或选择已入驻厂家'
            : '请指定有效的企业ID',
        })
      }
    }
  }

  // 🔴 N1 修复（2026-09-23）：登记证号必须存在于国家农药登记资料库（`pesticide_reg`）。
  //    PRD 5.9 异常清单第 3 条要求「后台预警 + 产品建档时阻断」——此前两半都没做：
  //    本文件只校验**非空**与**本系统内重复**，从不查登记库。
  //    位置刻意放在**归属企业解析之后**：豁免留痕要把预警归到正确的 enterprise_id 上。
  //    豁免通道（用户 2026-09-23 裁定「开一个豁免通道方便新证收录」）：仅 `platform_admin`
  //    可带 `regExempt: true` 放行 —— 登记资料库是《2026农药登记证大全》静态导入，
  //    新批登记证不会自动进来，硬阻断会把真实新证堵死。
  //    豁免**不是静默放行**：落库后写 `risk_alert(alert_type=3)` 留痕，供后台核实并补录登记库。
  const regExempt = body.regExempt === true && user.role === 'platform_admin'
  if (!(await registrationExistsInRegistry(registrationNo)) && !regExempt) {
    throw createError({
      statusCode: 400,
      statusMessage: '登记证号「' + registrationNo + '」在农药登记资料库中不存在，无法建档。如确为新增登记（登记库尚未收录），请由平台管理员勾选「新证豁免」后提交',
    })
  }

  const pool = getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [result]: any[] = await conn.query(
      `INSERT INTO product (enterprise_id, trademark, name, registration_no, registration_expire, reg_category,
         holder_name, produce_type, dosage, content, spec_id,
         category, toxicity, is_restricted, label_image, manual_image, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [fid,
       String(body.trademark || '').trim(),
       name, registrationNo,
       body.registrationExpire || null,
       body.regCategory !== undefined ? Number(body.regCategory) : 1,
       String(body.holderName || '').trim(),
       body.produceType !== undefined ? Number(body.produceType) : 1,
       String(body.dosage || '').trim(), String(body.content || '').trim(),
       Number(body.specId),
       String(body.category || '').trim(), String(body.toxicity || '').trim(),
       body.isRestricted ? 1 : 0,
       String(body.labelImage || '').trim() || null,
       String(body.manualImage || '').trim() || null,
       body.status === 0 ? 0 : 1]
    )
    // 原药行批量写入
    for (const row of validOriginals) {
      await conn.query(
        'INSERT INTO product_original (product_id, ingredient, reg_no, company) VALUES (?,?,?,?)',
        [result.insertId, String(row.ingredient || '').trim() || null, String(row.regNo).trim(), String(row.company).trim()]
      )
    }
    await conn.commit()
    // 豁免建档留痕：**必须带 product_id** —— `triggerAlert` 的合并键是
    // (enterprise_id, code_id, product_id, external_verification_id, alert_type, handle_status)，
    // 若 product_id 为 null，同企业的所有豁免会合并成一条、`evidence` 被逐次覆盖（N2 踩过同款坑）。
    // 用事件本体在事务之外调用：预警写失败不得回滚已建档的产品（triggerAlert 内部已自行 try/catch）。
    if (regExempt) {
      await triggerAlert({
        alertType: 3,
        enterpriseId: fid,
        productId: result.insertId,
        evidence: { registrationNo, productName: name, action: 'create', exempt: true, operator: user.username },
      })
    }
    return { ok: true, id: result.insertId }
  } catch (e: any) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
})
