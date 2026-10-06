package cn.nz315.collector.scanner

data class ScanInput(val raw: String, val source: String)
interface ScannerPort {
    fun start(onScan: (ScanInput) -> Unit)
    fun stop()
}
data class ScannerConfig(
    val actions: Set<String> = setOf("android.intent.ACTION_DECODE_DATA"),
    val stringExtra: String = "barcode_string",
    val bytesExtra: String = "barcode",
    val lengthExtra: String = "length",
    val stripTerminator: Boolean = true
)
