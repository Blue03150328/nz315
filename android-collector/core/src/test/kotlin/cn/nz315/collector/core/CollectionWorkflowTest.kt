package cn.nz315.collector.core

import org.junit.Assert.*
import org.junit.Test

class CollectionWorkflowTest {
    private class MemoryStore : CollectionStore {
        val tasks = linkedMapOf<String, CollectionTask>()
        val boxes = linkedMapOf<String, BoxGroup>()
        val entries = linkedMapOf<String, CollectedCode>()
        val events = mutableListOf<AuditEvent>()
        var failAudit = false
        override fun <T> transaction(block: () -> T): T {
            val beforeTasks = tasks.toMap(); val beforeBoxes = boxes.toMap(); val beforeCodes = entries.toMap(); val beforeEvents = events.toList()
            try { return block() } catch (error: Exception) {
                tasks.clear(); tasks.putAll(beforeTasks); boxes.clear(); boxes.putAll(beforeBoxes)
                entries.clear(); entries.putAll(beforeCodes); events.clear(); events.addAll(beforeEvents); throw error
            }
        }
        override fun task(id: String) = tasks.getValue(id)
        override fun saveTask(task: CollectionTask) { tasks[task.id] = task }
        override fun group(id: String) = boxes.getValue(id)
        override fun groups(taskId: String) = boxes.values.filter { it.taskId == taskId }
        override fun saveGroup(group: BoxGroup) { boxes[group.id] = group }
        override fun findCode(taskId: String, value: String) = entries.values.firstOrNull { it.taskId == taskId && it.value == value }
        override fun firstCode(taskId: String) = codes(taskId).firstOrNull()
        override fun code(id: String) = entries.getValue(id)
        override fun codes(taskId: String) = entries.values.filter { it.taskId == taskId }
        override fun countInGroup(groupId: String) = entries.values.count { it.groupId == groupId }
        override fun saveCode(code: CollectedCode) { entries[code.id] = code }
        override fun deleteCode(id: String) { entries.remove(id) }
        override fun audit(event: AuditEvent) { if (failAudit) error("模拟磁盘失败"); events.add(event) }
    }
    private val store = MemoryStore()
    private var counter = 0
    private val workflow = CollectionWorkflow(store, { 1000L + counter }, { "记录${++counter}" })
    private val a = "12011031001" + "0".repeat(20) + "1"
    private val b = "12011031001" + "0".repeat(20) + "2"
    private fun task(mode: CodeMode = CodeMode.INTERNAL, boxing: Boolean = true, first: Boolean = true) =
        workflow.create(TaskInfo("测试采集"), mode, boxing, first, CodePolicy.DEFAULT_BASE)
    private fun scan(task: CollectionTask, value: String) = workflow.scan(task.id, value, "测试扫码头")
    private fun reject(text: String, block: () -> Unit) {
        try { block(); fail("应拒绝：$text") } catch (error: RuleViolation) { assertTrue(error.message.orEmpty(), error.message.orEmpty().contains(text)) }
    }
    @Test fun boxFirstPersistsRelation() {
        val t = task(); scan(t, "箱1"); scan(t, a); scan(t, b)
        workflow.seal(t.id); workflow.complete(t.id)
        assertEquals("箱1", store.group(t.currentGroupId).boxRaw)
        assertEquals(2, store.countInGroup(t.currentGroupId))
        assertEquals(TaskStatus.COMPLETED, store.task(t.id).status)
    }
    @Test fun productFirstWaitsForBox() {
        val t = task(first = false); scan(t, a)
        assertNull(store.group(t.currentGroupId).boxRaw)
        reject("先采集箱码") { workflow.seal(t.id) }
        workflow.target(t.id, ScanTarget.BOX); scan(t, "箱2"); workflow.seal(t.id)
        assertEquals(t.currentGroupId, store.codes(t.id).single().groupId)
    }
    @Test fun duplicatePureCodeAndUrlNormalizeTogether() {
        val t = task(first = false); scan(t, a)
        reject("已采集") { scan(t, CodePolicy.DEFAULT_BASE + a) }
        assertEquals(1, store.codes(t.id).size)
    }
    @Test fun duplicateAcrossBoxesRejected() {
        val t = task(); scan(t, "箱1"); scan(t, a); workflow.seal(t.id); workflow.next(t.id, true); scan(t, "箱2")
        reject("其他箱") { scan(t, a) }
    }
    @Test fun boxReuseRejected() {
        val t = task(); scan(t, "箱1"); scan(t, a); workflow.seal(t.id); workflow.next(t.id, true)
        reject("已在本任务使用") { scan(t, "箱1") }
    }
    @Test fun noPrematureNextBox() { val t = task(); reject("先完成") { workflow.next(t.id, true) } }
    @Test fun emptyBoxCannotSeal() { val t = task(); scan(t, "箱1"); reject("尚无产品码") { workflow.seal(t.id) } }
    @Test fun cannotCollectIntoSealedBox() {
        val t = task(); scan(t, "箱1"); scan(t, a); workflow.seal(t.id); reject("本箱已完成") { scan(t, b) }
    }
    @Test fun boxCodeNotTruncatedEvenInInternalMode() {
        val t = task(); val raw = "https://box.example/箱?code=$a&extra=1"; scan(t, raw)
        assertEquals(raw, store.group(t.currentGroupId).boxRaw)
    }
    @Test fun externalRetainsWhitespaceChineseAndParameters() {
        val t = task(CodeMode.EXTERNAL, first = false); val raw = " https://example.org/产品?x=001&code=abc#原页 "
        scan(t, raw); assertEquals(raw, store.codes(t.id).single().value)
    }
    @Test fun externalRetainsMultilineText() {
        val t = task(CodeMode.EXTERNAL, first = false); val raw = "第一行\n第二行\r\n"; scan(t, raw)
        assertEquals(raw, store.codes(t.id).single().value)
    }
    @Test fun externalDistinctQueriesStayDistinct() {
        val t = task(CodeMode.EXTERNAL, first = false); scan(t, "https://x/?id=1"); scan(t, "https://x/?id=2")
        assertEquals(2, store.codes(t.id).size)
    }
    @Test fun rejectsLongNumericSuffixInsteadOfSlicing() { val t = task(first = false); reject("未识别") { scan(t, a + "1") } }
    @Test fun rejectsDifferentProductSpecificationPrefix() {
        val t = task(first = false); scan(t, a); reject("不一致") { scan(t, "22011031001" + "0".repeat(20) + "3") }
    }
    @Test fun rejectsForeignInternalHost() { val t = task(first = false); reject("不是本任务") { scan(t, "https://www.nz315.cn.evil.com/trace?code=$a") } }
    @Test fun rejectsWrongPath() { val t = task(first = false); reject("不是本任务") { scan(t, "https://www.nz315.cn/other?code=$a") } }
    @Test fun rejectsAmbiguousCodeParameter() { val t = task(first = false); reject("唯一") { scan(t, "https://www.nz315.cn/trace?code=$a&code=$b") } }
    @Test fun acceptsAdditionalUrlParameter() {
        val t = task(first = false); scan(t, "https://www.nz315.cn/trace?from=phone&code=$a"); assertEquals(a, store.codes(t.id).single().value)
    }
    @Test fun customInternalBasePersisted() {
        val t = workflow.create(TaskInfo("自定义"), CodeMode.INTERNAL, false, false, "https://trace.example/t?code=")
        scan(t, "https://trace.example/t?code=$a"); assertEquals("https://trace.example/t?code=$a", ExportFormat.qrContent(t, store.codes(t.id).single()))
    }
    @Test fun rejectsHttpBase() { reject("HTTPS") { CodePolicy.base("http://example.org/t?code=") } }
    @Test fun rejectsEmptyAndNullCharacter() {
        val t = task(CodeMode.EXTERNAL, first = false); reject("为空") { scan(t, "   ") }; reject("无效字符") { scan(t, "a\u0000b") }
    }
    @Test fun oversizedPayloadRejected() { val t = task(CodeMode.EXTERNAL, first = false); reject("过长") { scan(t, "a".repeat(8193)) } }
    @Test fun plainModeHasNoBoxRequirement() {
        val t = task(boxing = false); scan(t, a); workflow.seal(t.id); workflow.complete(t.id)
        assertEquals(TaskStatus.COMPLETED, store.task(t.id).status)
    }
    @Test fun plainModeRejectsBoxTarget() { val t = task(boxing = false); reject("未启用") { workflow.target(t.id, ScanTarget.BOX) } }
    @Test fun replacingBoxKeepsProductAndAudit() {
        val t = task(); scan(t, "误扫箱"); scan(t, a); workflow.replaceBox(t.id, "实际箱")
        assertEquals("实际箱", store.group(t.currentGroupId).boxRaw); assertEquals(1, store.codes(t.id).size)
        assertTrue(store.events.any { it.action == "更正箱码" && it.detail.contains("误扫箱") })
    }
    @Test fun clearingMisreadBoxKeepsPendingProducts() {
        val t = task(); scan(t, "误扫箱"); scan(t, a); workflow.clearBox(t.id)
        assertNull(store.group(t.currentGroupId).boxRaw); assertEquals(1, store.codes(t.id).size)
        assertEquals(ScanTarget.BOX, store.task(t.id).target)
    }
    @Test fun clearingEmptyMisreadBoxDoesNotBlockTaskCompletion() {
        val t = task(); scan(t, "箱1"); scan(t, a); workflow.seal(t.id); workflow.next(t.id, true)
        scan(t, "误扫空箱"); workflow.clearBox(t.id); workflow.complete(t.id)
        assertEquals(TaskStatus.COMPLETED, store.task(t.id).status)
    }
    @Test fun cannotSilentlyReplaceByScanningAgain() {
        val t = task(); scan(t, "箱1"); workflow.target(t.id, ScanTarget.BOX); reject("已有箱码") { scan(t, "箱2") }
    }
    @Test fun sealedBoxRequiresReopenForCorrection() {
        val t = task(); scan(t, "箱1"); scan(t, a); workflow.seal(t.id); reject("重新打开") { workflow.replaceBox(t.id, "箱2") }
    }
    @Test fun moveRequiresBothBoxesOpenAndKeepsTime() {
        val t = task(); scan(t, "箱1"); scan(t, a); val code = store.codes(t.id).single()
        workflow.seal(t.id); workflow.next(t.id, true); scan(t, "箱2"); val destination = store.task(t.id).currentGroupId
        reject("重新打开") { workflow.move(t.id, code.id, destination) }
        workflow.reopenGroup(t.id, code.groupId); workflow.move(t.id, code.id, destination)
        assertEquals(code.scannedAt, store.code(code.id).scannedAt); assertEquals(destination, store.code(code.id).groupId)
    }
    @Test fun cannotMoveAcrossTasks() {
        val t = task(first = false); scan(t, a); val other = task()
        reject("同一任务") { workflow.move(t.id, store.codes(t.id).single().id, other.currentGroupId) }
    }
    @Test fun deleteRequiresReopenAndLeavesAudit() {
        val t = task(); scan(t, "箱1"); scan(t, a); val code = store.codes(t.id).single(); workflow.seal(t.id)
        reject("重新打开") { workflow.delete(t.id, code.id) }; workflow.reopenGroup(t.id, code.groupId); workflow.delete(t.id, code.id)
        assertTrue(store.codes(t.id).isEmpty()); assertTrue(store.events.any { it.action == "删除误扫" })
    }
    @Test fun completedTaskRejectsWritesUntilReopen() {
        val t = task(boxing = false); scan(t, a); workflow.seal(t.id); workflow.complete(t.id)
        reject("已完成") { scan(t, b) }; workflow.reopenTask(t.id); workflow.reopenGroup(t.id, t.currentGroupId); scan(t, b)
    }
    @Test fun completingTaskRejectsUnfinishedGroup() {
        val t = task(first = false); scan(t, a); reject("未完成") { workflow.complete(t.id) }
    }
    @Test fun missingMetadataMarkedRatherThanFabricated() {
        val t = task(); assertEquals("", t.info.batchNo); assertTrue(t.info.missingFields().contains("生产批号"))
    }
    @Test fun impossibleDateRejected() { reject("真实日期") { task().let { workflow.updateInfo(it.id, TaskInfo("测试", produceDate = "2026-02-30")) } } }
    @Test fun updateMetadataDoesNotRewriteCodesOrBoxes() {
        val t = task(); scan(t, "箱1"); scan(t, a); workflow.updateInfo(t.id, TaskInfo("补充任务", batchNo = "批次A"))
        assertEquals(a, store.codes(t.id).single().value); assertEquals("箱1", store.group(t.currentGroupId).boxRaw)
    }
    @Test fun diskFailureRollsBackScanAndSuccessState() {
        val t = task(); store.failAudit = true
        try { scan(t, "箱1"); fail("应模拟失败") } catch (_: IllegalStateException) { }
        assertNull(store.group(t.currentGroupId).boxRaw); assertEquals(ScanTarget.BOX, store.task(t.id).target)
    }
    @Test fun diskFailureRollsBackProductInsertion() {
        val t = task(first = false); store.failAudit = true
        try { scan(t, a); fail("应模拟失败") } catch (_: IllegalStateException) { }
        assertTrue(store.codes(t.id).isEmpty())
    }
    @Test fun exportCsvPreservesQuotesAndMultiline() {
        assertEquals("\"a\"\"b\nc\"", ExportFormat.csvCell("a\"b\nc"))
        assertEquals("\"'=1+1\"", ExportFormat.csvCell("=1+1", true))
    }
    @Test fun exportFolderCannotEscapeChosenDirectory() {
        val name = ExportFormat.folderName("../a\\b:name", "task123456", "export123456")
        assertFalse(name.contains('/')); assertFalse(name.contains('\\')); assertFalse(name.contains(':'))
    }
    @Test fun externalQrReconstructionUsesOriginalContent() {
        val t = task(CodeMode.EXTERNAL, first = false); scan(t, "https://厂家.example/?x=001")
        assertEquals(store.codes(t.id).single().value, ExportFormat.qrContent(t, store.codes(t.id).single()))
    }
}
