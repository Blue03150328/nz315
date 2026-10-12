export type ExternalCollectionState = 'active' | 'completed'
export type ExternalReceiptState = 'accepted' | 'duplicate' | 'rejected'

export interface ExternalCollectionEvent {
  eventId: string
  sequence: number
  rawCode: string
  capturedAt: string
}

export interface ExternalCollectionReceipt {
  eventId: string
  sequence: number
  state: ExternalReceiptState
  reason: string
}

export interface ExternalCollectionBatch {
  id: string
  enterprise_id: number
  enterprise_name?: string
  device_id: number
  device_name_snapshot: string
  line_name_snapshot: string
  device_name: string
  line_name: string
  worker_no: string
  state: ExternalCollectionState
  last_sequence: number
  accepted_count: number
  duplicate_count: number
  rejected_count: number
  code_count: number
  product_id: number | null
  product_name_snapshot: string | null
  batch_no: string | null
  produce_date: string | null
  production_quantity: number | null
  effective_production_quantity: number
  created_at: string
  completed_at: string | null
  metadata_updated_at: string | null
  updated_at: string
}
