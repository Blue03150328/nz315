// 后台业务入口集中定义，指标和通知共用同一筛选地址。
export const adminLinks = {
  pendingAlerts: () => '/admin/alerts?status=0',
  frozenCodes: () => '/admin/codes?abnormalFlag=1',
  voidedCodes: () => '/admin/codes?abnormalFlag=2',
  uploadBatch: (id: number) => '/admin/codes?uploadBatchId=' + id,
}
