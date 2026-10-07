import type { PoolConnection } from 'mysql2/promise'

/** 文件聚合快照取实际码值；混合值置空，防止局部修正误标整文件。 */
export async function refreshUploadSnapshots(conn: PoolConnection, uploadIds: number[]) {
  for (const uploadId of [...new Set(uploadIds)].filter(Boolean).sort((a, b) => a - b)) {
    await conn.execute(`UPDATE upload_batch ub JOIN (
      SELECT upload_batch_id,
        IF(COUNT(DISTINCT COALESCE(batch_id, 0)) = 1, MAX(batch_id), NULL) AS bid,
        IF(COUNT(DISTINCT COALESCE(batch_no, '')) = 1, MAX(batch_no), NULL) AS bno,
        IF(COUNT(DISTINCT COALESCE(produce_date, '')) = 1, MAX(produce_date), NULL) AS pdate,
        IF(COUNT(DISTINCT COALESCE(quality_cert_no, '')) = 1, MAX(quality_cert_no), NULL) AS cert
      FROM trace_code WHERE upload_batch_id = ? GROUP BY upload_batch_id
    ) t ON t.upload_batch_id = ub.id SET ub.batch_id = t.bid, ub.batch_no = t.bno, ub.produce_date = t.pdate, ub.quality_cert_no = t.cert`, [uploadId])
  }
}
