package cn.nz315.collector.data

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import cn.nz315.collector.core.*

/** 本地持久化适配器。升级只允许显式迁移，禁止删库重建。 */
class CollectorDatabase(context: Context, name: String = "collector.db") : SQLiteOpenHelper(context, name, null, 1), CollectionStore {
    override fun onConfigure(db: SQLiteDatabase) {
        db.setForeignKeyConstraintsEnabled(true)
    }
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE tasks (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, enterprise TEXT NOT NULL, product TEXT NOT NULL,
            specification TEXT NOT NULL, batch_no TEXT NOT NULL, produce_date TEXT NOT NULL,
            quality_cert_no TEXT NOT NULL, line TEXT NOT NULL, operator TEXT NOT NULL, note TEXT NOT NULL,
            mode TEXT NOT NULL, boxing INTEGER NOT NULL, internal_base TEXT NOT NULL,
            created_at INTEGER NOT NULL, status TEXT NOT NULL, current_group_id TEXT NOT NULL, target TEXT NOT NULL)""")
        db.execSQL("""CREATE TABLE box_groups (
            id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), ordinal INTEGER NOT NULL,
            box_raw TEXT, sealed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
            UNIQUE(task_id, ordinal), UNIQUE(task_id, box_raw))""")
        db.execSQL("""CREATE TABLE codes (
            id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
            group_id TEXT NOT NULL REFERENCES box_groups(id), value TEXT NOT NULL,
            scanned_at INTEGER NOT NULL, source TEXT NOT NULL, UNIQUE(task_id, value))""")
        db.execSQL("CREATE INDEX codes_group ON codes(group_id, scanned_at)")
        db.execSQL("CREATE INDEX codes_task ON codes(task_id, scanned_at)")
        db.execSQL("""CREATE TABLE audit_events (
            id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
            action TEXT NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL)""")
        db.execSQL("CREATE INDEX audit_task ON audit_events(task_id, at)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        throw IllegalStateException("缺少数据库迁移：$oldVersion → $newVersion，已保留原数据")
    }
    override fun <T> transaction(block: () -> T): T {
        val db = writableDatabase
        db.beginTransaction()
        try { val result = block(); db.setTransactionSuccessful(); return result }
        finally { db.endTransaction() }
    }
    private fun values(vararg pairs: Pair<String, Any?>) = ContentValues().apply {
        pairs.forEach { (key, value) -> when (value) {
            null -> putNull(key)
            is String -> put(key, value)
            is Int -> put(key, value)
            is Long -> put(key, value)
            else -> error("不支持的数据库字段类型")
        } }
    }
    private fun upsert(table: String, id: String, values: ContentValues) {
        // 不能用REPLACE：它会先删除父记录，导致关联记录丢失或外键冲突。
        if (writableDatabase.update(table, values, "id=?", arrayOf(id)) == 0) {
            writableDatabase.insertOrThrow(table, null, values)
        }
    }
    private fun <T> query(sql: String, args: Array<String>, mapper: (Cursor) -> T): List<T> =
        readableDatabase.rawQuery(sql, args).use { cursor -> buildList { while (cursor.moveToNext()) add(mapper(cursor)) } }
    private fun Cursor.text(key: String) = getString(getColumnIndexOrThrow(key))
    private fun Cursor.number(key: String) = getLong(getColumnIndexOrThrow(key))
    private fun readTask(c: Cursor) = CollectionTask(
        c.text("id"), TaskInfo(c.text("name"), c.text("enterprise"), c.text("product"), c.text("specification"),
            c.text("batch_no"), c.text("produce_date"), c.text("quality_cert_no"), c.text("line"), c.text("operator"), c.text("note")),
        CodeMode.valueOf(c.text("mode")), c.number("boxing") == 1L, c.text("internal_base"), c.number("created_at"),
        TaskStatus.valueOf(c.text("status")), c.text("current_group_id"), ScanTarget.valueOf(c.text("target")))
    private fun readGroup(c: Cursor) = BoxGroup(c.text("id"), c.text("task_id"), c.number("ordinal").toInt(),
        c.getColumnIndexOrThrow("box_raw").let { if (c.isNull(it)) null else c.getString(it) },
        c.number("sealed") == 1L, c.number("created_at"))
    private fun readCode(c: Cursor) = CollectedCode(c.text("id"), c.text("task_id"), c.text("group_id"),
        c.text("value"), c.number("scanned_at"), c.text("source"))
    override fun task(id: String) = query("SELECT * FROM tasks WHERE id=?", arrayOf(id), ::readTask).singleOrNull()
        ?: throw RuleViolation("任务不存在")
    override fun group(id: String) = query("SELECT * FROM box_groups WHERE id=?", arrayOf(id), ::readGroup).singleOrNull()
        ?: throw RuleViolation("箱记录不存在")
    override fun code(id: String) = query("SELECT * FROM codes WHERE id=?", arrayOf(id), ::readCode).singleOrNull()
        ?: throw RuleViolation("产品码记录不存在")
    override fun groups(taskId: String) = query("SELECT * FROM box_groups WHERE task_id=? ORDER BY ordinal", arrayOf(taskId), ::readGroup)
    override fun codes(taskId: String) = query("SELECT * FROM codes WHERE task_id=? ORDER BY scanned_at, rowid", arrayOf(taskId), ::readCode)
    override fun firstCode(taskId: String) = query("SELECT * FROM codes WHERE task_id=? ORDER BY scanned_at, rowid LIMIT 1", arrayOf(taskId), ::readCode).firstOrNull()
    override fun findCode(taskId: String, value: String) = query("SELECT * FROM codes WHERE task_id=? AND value=?", arrayOf(taskId, value), ::readCode).firstOrNull()
    override fun countInGroup(groupId: String) = query("SELECT COUNT(*) AS n FROM codes WHERE group_id=?", arrayOf(groupId)) { it.number("n").toInt() }.single()
    override fun saveTask(task: CollectionTask) = upsert("tasks", task.id, values(
        "id" to task.id, "name" to task.info.name, "enterprise" to task.info.enterprise, "product" to task.info.product,
        "specification" to task.info.specification, "batch_no" to task.info.batchNo, "produce_date" to task.info.produceDate,
        "quality_cert_no" to task.info.qualityCertNo, "line" to task.info.line, "operator" to task.info.operator, "note" to task.info.note,
        "mode" to task.mode.name, "boxing" to if (task.boxing) 1 else 0, "internal_base" to task.internalBase,
        "created_at" to task.createdAt, "status" to task.status.name, "current_group_id" to task.currentGroupId, "target" to task.target.name))
    override fun saveGroup(group: BoxGroup) = upsert("box_groups", group.id, values(
        "id" to group.id, "task_id" to group.taskId, "ordinal" to group.ordinal, "box_raw" to group.boxRaw,
        "sealed" to if (group.sealed) 1 else 0, "created_at" to group.createdAt))
    override fun saveCode(code: CollectedCode) = upsert("codes", code.id, values(
        "id" to code.id, "task_id" to code.taskId, "group_id" to code.groupId,
        "value" to code.value, "scanned_at" to code.scannedAt, "source" to code.source))
    override fun deleteCode(id: String) { writableDatabase.delete("codes", "id=?", arrayOf(id)) }
    override fun audit(event: AuditEvent) { writableDatabase.insertOrThrow("audit_events", null, values(
        "id" to event.id, "task_id" to event.taskId, "action" to event.action, "detail" to event.detail, "at" to event.at)) }
    fun snapshot(taskId: String): TaskSnapshot = transaction {
        TaskSnapshot(task(taskId), groups(taskId), codes(taskId), query("SELECT * FROM audit_events WHERE task_id=? ORDER BY at, rowid", arrayOf(taskId)) {
            AuditEvent(it.text("id"), it.text("task_id"), it.text("action"), it.text("detail"), it.number("at"))
        })
    }
    fun recentCodes(taskId: String, offset: Int, limit: Int = 80): List<CollectedCode> = query(
        "SELECT * FROM codes WHERE task_id=? ORDER BY scanned_at DESC, rowid DESC LIMIT ? OFFSET ?",
        arrayOf(taskId, limit.toString(), offset.toString()), ::readCode)
    /** 现场只读当前箱的最新记录，不因同毫秒扫码而打乱顺序，不加载整份任务。 */
    fun recentCodesInGroup(groupId: String, limit: Int = 5): List<CollectedCode> = query(
        "SELECT * FROM codes WHERE group_id=? ORDER BY scanned_at DESC, rowid DESC LIMIT ?",
        arrayOf(groupId, limit.toString()), ::readCode)
    fun summary(task: CollectionTask): TaskSummary {
        val counts = query("""SELECT COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN g.box_raw IS NULL THEN 1 ELSE 0 END),0) AS pending
            FROM codes c JOIN box_groups g ON c.group_id=g.id WHERE c.task_id=?""", arrayOf(task.id)) {
            it.number("n").toInt() to it.number("pending").toInt()
        }.single()
        val boxes = query("SELECT COUNT(*) AS n FROM box_groups WHERE task_id=? AND box_raw IS NOT NULL", arrayOf(task.id)) { it.number("n").toInt() }.single()
        return TaskSummary(task, counts.first, boxes, if (task.boxing) counts.second else 0)
    }
    fun summaries(): List<TaskSummary> = query("SELECT * FROM tasks ORDER BY created_at DESC", emptyArray(), ::readTask).map(::summary)
}
