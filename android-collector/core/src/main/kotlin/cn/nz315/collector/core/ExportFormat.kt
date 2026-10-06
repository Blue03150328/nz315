package cn.nz315.collector.core

object ExportFormat {
    const val SCHEMA_VERSION = 1
    /** 原始CSV保留全部字符；供表格查看的副本另加文本前缀，防止长码精度损失及公式执行。 */
    fun csvCell(value: String, spreadsheet: Boolean = false): String {
        val text = if (spreadsheet && value.isNotEmpty()) "'" + value else value
        return "\"" + text.replace("\"", "\"\"") + "\""
    }
    fun csvRow(vararg values: String, spreadsheet: Boolean = false): String =
        values.joinToString(",") { csvCell(it, spreadsheet) } + "\r\n"
    fun folderName(name: String, taskId: String, exportId: String): String =
        name.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").take(50).trim().ifBlank { "采集任务" } +
            "_" + taskId.take(8) + "_" + exportId.take(8)
    fun qrContent(task: CollectionTask, code: CollectedCode): String =
        if (task.mode == CodeMode.INTERNAL) task.internalBase + code.value else code.value
}
