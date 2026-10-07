package cn.nz315.collector.core

enum class CodeMode { INTERNAL, EXTERNAL }
enum class ScanTarget { BOX, PRODUCT }
enum class TaskStatus { OPEN, COMPLETED }

data class TaskInfo(
    val name: String, val enterprise: String = "", val product: String = "",
    val specification: String = "", val batchNo: String = "", val produceDate: String = "",
    val qualityCertNo: String = "", val line: String = "", val operator: String = "", val note: String = ""
) {
    fun missingFields(): List<String> = buildList {
        if (product.isBlank()) add("产品")
        if (batchNo.isBlank()) add("生产批号")
        if (produceDate.isBlank()) add("生产日期")
        if (qualityCertNo.isBlank()) add("质量合格证号")
        if (line.isBlank()) add("产线")
        if (operator.isBlank()) add("操作员")
    }
}

data class CollectionTask(
    val id: String, val info: TaskInfo, val mode: CodeMode, val boxing: Boolean,
    val internalBase: String, val createdAt: Long, val status: TaskStatus = TaskStatus.OPEN,
    val currentGroupId: String, val target: ScanTarget
)
data class BoxGroup(
    val id: String, val taskId: String, val ordinal: Int, val boxRaw: String? = null,
    val sealed: Boolean = false, val createdAt: Long
)
data class CollectedCode(
    val id: String, val taskId: String, val groupId: String, val value: String,
    val scannedAt: Long, val source: String
)
data class AuditEvent(val id: String, val taskId: String, val action: String, val detail: String, val at: Long)
data class TaskSnapshot(val task: CollectionTask, val groups: List<BoxGroup>, val codes: List<CollectedCode>, val events: List<AuditEvent>)
data class TaskSummary(val task: CollectionTask, val codeCount: Int, val boxCount: Int, val pendingCount: Int)
data class ScanReceipt(val message: String, val value: String)
class RuleViolation(message: String) : IllegalArgumentException(message)

/** 数据层负责真实事务，设备接入和界面不得直接改写采集记录。 */
interface CollectionStore {
    fun <T> transaction(block: () -> T): T
    fun task(id: String): CollectionTask
    fun saveTask(task: CollectionTask)
    fun group(id: String): BoxGroup
    fun groups(taskId: String): List<BoxGroup>
    fun saveGroup(group: BoxGroup)
    fun findCode(taskId: String, value: String): CollectedCode?
    fun firstCode(taskId: String): CollectedCode?
    fun code(id: String): CollectedCode
    fun codes(taskId: String): List<CollectedCode>
    fun countInGroup(groupId: String): Int
    fun saveCode(code: CollectedCode)
    fun deleteCode(id: String)
    fun audit(event: AuditEvent)
}
