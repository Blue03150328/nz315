package cn.nz315.collector.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import cn.nz315.collector.core.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class PersistenceTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "测试_${UUID.randomUUID()}.db"
    private lateinit var db: CollectorDatabase
    private lateinit var flow: CollectionWorkflow
    @Before fun setup() { db = CollectorDatabase(context, name); flow = CollectionWorkflow(db) }
    @After fun cleanup() { db.close(); context.deleteDatabase(name) }
    private fun task(boxing: Boolean = true) = flow.create(TaskInfo("持久化验收"), CodeMode.EXTERNAL, boxing, false, CodePolicy.DEFAULT_BASE)
    @Test fun closingDatabaseRestoresPendingGroupAndTarget() {
        val task = task(); flow.scan(task.id, "https://厂家.example/?id=001", "扫码头")
        db.close(); db = CollectorDatabase(context, name)
        val snapshot = db.snapshot(task.id)
        assertEquals(1, snapshot.codes.size); assertNull(snapshot.groups.single().boxRaw)
        assertEquals(ScanTarget.PRODUCT, snapshot.task.target)
        assertEquals(1, db.summary(snapshot.task).pendingCount)
    }
    @Test fun updatingTaskDoesNotDeleteForeignKeyChildren() {
        val task = task(); flow.scan(task.id, "产品1", "扫码头")
        flow.updateInfo(task.id, TaskInfo("补资料", batchNo = "实际批次"))
        assertEquals(1, db.snapshot(task.id).codes.size); assertEquals(1, db.groups(task.id).size)
    }
    @Test fun auditFailureRollsBackCodeInsertion() {
        val task = task()
        db.writableDatabase.execSQL("CREATE TRIGGER test_fail BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'故障测试'); END")
        try { flow.scan(task.id, "不能保存的码", "扫码头"); fail("应回滚") } catch (_: android.database.SQLException) { }
        assertEquals(0, db.codes(task.id).size)
    }
    @Test fun concurrentDuplicateScansPersistExactlyOnce() {
        val task = task(); val pool = java.util.concurrent.Executors.newFixedThreadPool(4)
        val jobs = (1..12).map { pool.submit { runCatching { flow.scan(task.id, "相同产品", "并发扫码") } } }
        jobs.forEach { it.get() }; pool.shutdown()
        assertEquals(1, db.codes(task.id).size)
    }
    @Test fun twoOrdersRemainCorrectAfterReopen() {
        val task = task(); flow.scan(task.id, "产品1", "扫码头"); flow.target(task.id, ScanTarget.BOX); flow.scan(task.id, "箱1", "扫码头")
        flow.seal(task.id); flow.next(task.id, true); flow.scan(task.id, "箱2", "扫码头"); flow.scan(task.id, "产品2", "扫码头"); flow.seal(task.id)
        db.close(); db = CollectorDatabase(context, name)
        val snapshot = db.snapshot(task.id)
        assertEquals(listOf("箱1", "箱2"), snapshot.groups.map { it.boxRaw })
        assertEquals(snapshot.groups.map { it.id }, snapshot.codes.map { it.groupId })
        assertEquals(0, db.summary(snapshot.task).pendingCount)
    }
    @Test fun tenThousandCodesRemainOrderedAndDeduplicated() {
        val task = task(false)
        for (i in 1..10000) flow.scan(task.id, "https://example.org/code/$i", "规模验收")
        assertEquals(10000, db.codes(task.id).size)
        assertEquals(10000, db.summary(db.task(task.id)).codeCount)
        assertEquals(80, db.recentCodes(task.id, 0).size)
        assertEquals("https://example.org/code/10000", db.recentCodes(task.id, 0).first().value)
        assertEquals(1, db.snapshot(task.id).groups.size)
    }
    @Test fun currentGroupPreviewIsLimitedAndStableForSameTimestamp() {
        val task = task()
        db.transaction {
            for (i in 1..8) db.saveCode(CollectedCode("产品$i", task.id, task.currentGroupId, "码$i", 100L, "预览测试"))
        }
        flow.target(task.id, ScanTarget.BOX); flow.scan(task.id, "箱1", "预览测试")
        flow.seal(task.id); flow.next(task.id, true)
        flow.scan(task.id, "箱2", "预览测试"); flow.scan(task.id, "另一箱的码", "预览测试")
        assertEquals(listOf("码8", "码7", "码6", "码5", "码4"), db.recentCodesInGroup(task.currentGroupId).map { it.value })
        assertEquals(listOf("另一箱的码"), db.recentCodesInGroup(db.task(task.id).currentGroupId).map { it.value })
    }
}
