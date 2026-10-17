/** 厂家只填写七列，产品和原药资料由完整登记证号补齐。 */
export const PRODUCT_IMPORT_HEADERS = ['生产类型', '登记证号', '产标名', '规格代码', '原药登记证号1', '原药登记证号2', '原药登记证号3']
export const PRODUCT_IMPORT_REQUIRED_HEADERS = ['生产类型', '登记证号', '规格代码', '原药登记证号1']
export const PRODUCT_TRADEMARK_HEADERS: Record<string, string> = { 产品商标: '产标名', 商标: '产标名' }
export const PRODUCT_PRODUCE_TYPES = ['持有人生产', '委托加工', '委托分装']
export const PRODUCT_IMPORT_MAX_ROWS = 1000
export const PRODUCT_MAX_ORIGINALS = 3
export type ProductImportError = { row: number; value: string; reason: string; values: Record<string, string> }
export type ProductImportWarning = { row: number; reason: string }
export type ProductImportRow = { row: number; values: Record<string, string> }
