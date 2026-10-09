package cn.nz315.collector

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.text.InputType
import android.text.TextUtils
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.inputmethod.EditorInfo
import android.widget.*
import cn.nz315.collector.core.*
import cn.nz315.collector.export.FolderExporter
import cn.nz315.collector.scanner.*
import java.time.LocalDateTime
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class MainActivity : Activity() {
    private val app get() = application as CollectorApp
    private val db get() = app.database
    private val flow get() = app.workflow
    private val control by lazy { CollectionController(app) }
    private val prefs by lazy { getSharedPreferences("collector_settings", MODE_PRIVATE) }
    private lateinit var root: LinearLayout
    private lateinit var content: LinearLayout
    private lateinit var status: TextView
    private lateinit var scroll: ScrollView
    private var scanner: ScannerPort? = null
    private var taskId: String? = null
    private var currentTask: CollectionTask? = null
    private var countText: TextView? = null
    private var boxText: TextView? = null
    private var targetText: TextView? = null
    private var input: EditText? = null
    private var paused = false
    private var foreground = false
    private var modal = false
    private var exportTaskId: String? = null
    private var exportQr = false
    private var collectingScreen = false
    private var screenRevision = 0
    private val exportObserver: () -> Unit = { notify(app.exportMessage); startScanner() }
    private var recordsOffset = 0
    private var screenKind = "tasks"
    private var feedback: ScanFeedbackView? = null
    private var recentRows: LinearLayout? = null
    private var recentTitle: TextView? = null
    private var feedbackTaskId: String? = null
    private var feedbackGroupId: String? = null
    private var feedbackLabel = ""
    private var feedbackValue = ""
    private var feedbackDetail = ""
    private var feedbackFailed = false
    private var groupOpen = false
    private data class CapturePreview(val summary: TaskSummary, val group: BoxGroup, val count: Int, val codes: List<CollectedCode>)
    private data class SavedScan(val receipt: ScanReceipt, val target: ScanTarget, val preview: CapturePreview, val savedAt: Long)
    private val green = Color.rgb(40, 91, 61)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        taskId = savedInstanceState?.getString("taskId") ?: prefs.getString("selectedTaskId", null)
        paused = savedInstanceState?.getBoolean("paused") ?: false
        exportTaskId = savedInstanceState?.getString("exportTaskId")
        exportQr = savedInstanceState?.getBoolean("exportQr") ?: false
        feedbackTaskId = savedInstanceState?.getString("feedbackTaskId")
        feedbackGroupId = savedInstanceState?.getString("feedbackGroupId")
        feedbackLabel = savedInstanceState?.getString("feedbackLabel").orEmpty()
        feedbackValue = savedInstanceState?.getString("feedbackValue").orEmpty()
        feedbackDetail = savedInstanceState?.getString("feedbackDetail").orEmpty()
        feedbackFailed = savedInstanceState?.getBoolean("feedbackFailed") ?: false
        when (savedInstanceState?.getString("screenKind")) {
            "task" -> taskId?.let(::showTask) ?: showHome()
            "records" -> taskId?.let { showRecords(it, savedInstanceState.getInt("recordsOffset")) } ?: showRecordTasks()
            "recordTasks" -> showRecordTasks()
            else -> showHome()
        }
    }
    override fun onSaveInstanceState(out: Bundle) {
        out.putString("taskId", taskId); out.putBoolean("paused", paused)
        out.putString("exportTaskId", exportTaskId); out.putBoolean("exportQr", exportQr)
        out.putString("screenKind", screenKind); out.putInt("recordsOffset", recordsOffset)
        out.putString("feedbackTaskId", feedbackTaskId); out.putString("feedbackGroupId", feedbackGroupId)
        out.putString("feedbackLabel", feedbackLabel); out.putString("feedbackValue", feedbackValue)
        out.putString("feedbackDetail", feedbackDetail); out.putBoolean("feedbackFailed", feedbackFailed)
        super.onSaveInstanceState(out)
    }
    override fun onResume() { super.onResume(); foreground = true; app.observeExport(exportObserver); if (app.exportMessage.isNotEmpty()) notify(app.exportMessage); startScanner() }
    override fun onPause() { foreground = false; app.removeExportObserver(exportObserver); scanner?.stop(); scanner = null; super.onPause() }
    override fun onDestroy() { scanner?.stop(); super.onDestroy() }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun background(color: Int) = GradientDrawable().apply { setColor(color); cornerRadius = dp(12).toFloat() }
    private fun text(value: String, size: Float = 16f, bold: Boolean = false): TextView = TextView(this).apply {
        this.text = value; textSize = size; setTextColor(Color.rgb(30, 42, 33)); setPadding(0, dp(8), 0, dp(8))
        if (bold) setTypeface(typeface, Typeface.BOLD)
    }
    private fun button(label: String, parent: LinearLayout = content, action: () -> Unit): Button = Button(this).apply {
        text = label; isAllCaps = false; textSize = 16f; setTextColor(green)
        setOnClickListener { action() }
        parent.addView(this, LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(6) })
    }
    private fun screen(title: String, hint: String, recordsPage: Boolean = false, kind: String = "tasks") {
        screenRevision++
        screenKind = kind
        collectingScreen = false
        scanner?.stop(); scanner = null; input = null; feedback = null; recentRows = null
        countText = null; boxText = null; targetText = null; recentTitle = null
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(243, 245, 242)) }
        root.addView(text(title, 23f, true).apply { setPadding(dp(20), dp(14), dp(20), dp(14)); setTextColor(Color.WHITE); setBackgroundColor(green) })
        scroll = ScrollView(this)
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(8), dp(16), dp(20)) }
        scroll.addView(content)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        if (hint.isNotEmpty()) content.addView(text(hint, 14f))
        status = text("数据仅保存在本机，完成后请导出备份", 14f).apply { setPadding(dp(16), dp(10), dp(16), dp(10)) }
        root.addView(status)
        val navigation = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(8), 0, dp(8), dp(4)) }
        listOf("生产采集任务" to R.id.nav_tasks, "生产采集任务记录" to R.id.nav_records).forEachIndexed { index, (label, viewId) ->
            navigation.addView(Button(this).apply {
                id = viewId; text = label; textSize = 14f; isAllCaps = false
                val selected = (index == 1) == recordsPage
                setTextColor(if (selected) Color.WHITE else green)
                background = background(if (selected) green else Color.WHITE)
                setOnClickListener {
                    if (index == 0) showHome() else taskId?.let(::showTask) ?: showRecordTasks()
                }
            }, LinearLayout.LayoutParams(0, dp(48), 1f).apply { setMargins(dp(3), 0, dp(3), 0) })
        }
        root.addView(navigation)
        setContentView(root)
        root.setOnApplyWindowInsetsListener { view, insets ->
            @Suppress("DEPRECATION")
            view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            insets
        }
    }
    private fun notify(value: String, error: Boolean = false) {
        if (isFinishing || isDestroyed) return
        status.text = value; status.setTextColor(if (error) Color.rgb(170, 45, 35) else green)
        if (error) Toast.makeText(this, value, Toast.LENGTH_LONG).show()
    }
    private fun <T> run(operation: () -> T, after: (T) -> Unit) {
        val revision = screenRevision
        control.execute(operation, { if (!isFinishing && !isDestroyed && revision == screenRevision) after(it) },
            { if (revision == screenRevision) notify(it, true) })
    }

    private fun showHome() {
        currentTask = null
        screen("生产采集任务", "在这里设置产品、批次和采集方式，再进入记录页扫码。")
        button("＋ 新建采集任务") { editInfo(null) }
        button("扫码设备设置") { settings() }
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; content.addView(list)
        run({ db.summaries() }) { summaries ->
            if (summaries.isEmpty()) list.addView(text("还没有采集任务"))
            summaries.forEach { summary ->
                val task = summary.task
                val card = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(8), dp(12), dp(8)); background = background(Color.WHITE) }
                list.addView(card, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) })
                card.addView(text(task.info.name, 18f, true))
                card.addView(text("${if (task.mode == CodeMode.INTERNAL) "内部码" else "外部码"} · ${summary.codeCount}件 · ${summary.boxCount}箱\n${if (task.status == TaskStatus.OPEN) "采集中" else "已完成"} · 待关联${summary.pendingCount}件 · 待补资料${task.info.missingFields().size}项", 14f))
                button("设置任务资料", card) {
                    if (task.status == TaskStatus.OPEN) editInfo(task) else notify("任务已完成，请在记录页重新打开后修改", true)
                }
                button("进入采集记录", card) { paused = false; showTask(task.id) }
            }
        }
    }

    private fun showRecordTasks() {
        screen("生产采集任务记录", "选择要查看或继续采集的任务。已完成的任务也保留在这里。", true, "recordTasks")
        button("返回设置任务") { showHome() }
        val rows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; content.addView(rows)
        run({ db.summaries() }) { summaries ->
            if (summaries.isEmpty()) rows.addView(text("暂无采集记录，请先设置一个生产采集任务"))
            summaries.forEach { summary ->
                rows.addView(text("${summary.task.info.name}\n${summary.codeCount}件 · ${summary.boxCount}箱 · ${if (summary.task.status == TaskStatus.OPEN) "采集中" else "已完成"}", 16f, true))
                button("查看此任务记录", rows) { showTask(summary.task.id) }
            }
        }
    }

    private fun editField(parent: LinearLayout, label: String, value: String = "", numeric: Boolean = false): EditText {
        parent.addView(text(label, 14f))
        return EditText(this).apply {
            setText(value); textSize = 16f; setSingleLine(true); setSelectAllOnFocus(true)
            inputType = if (numeric) InputType.TYPE_CLASS_NUMBER else InputType.TYPE_CLASS_TEXT
            parent.addView(this, LinearLayout.LayoutParams(-1, dp(48)))
        }
    }
    private fun editInfo(task: CollectionTask?) {
        val previous = task?.info ?: TaskInfo("采集_${LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmm"))}",
            operator = prefs.getString("operator", "").orEmpty(), line = prefs.getString("line", "").orEmpty())
        screen(if (task == null) "设置生产采集任务" else "设置任务资料", "批号与生产日期按真实标签填写。未知资料可留空，导出时标记待补；资料不会自动绑定到网站。", kind = "edit")
        val fields = listOf("任务名称（必填）" to previous.name, "企业" to previous.enterprise,
            "产品" to previous.product, "规格" to previous.specification, "生产批号" to previous.batchNo,
            "生产日期（YYYY-MM-DD）" to previous.produceDate, "质量合格证号" to previous.qualityCertNo,
            "产线" to previous.line, "操作员" to previous.operator, "备注" to previous.note).map { editField(content, it.first, it.second) }
        val mode = RadioGroup(this).apply { orientation = RadioGroup.HORIZONTAL }
        listOf("内部码" to 101, "外部码" to 102).forEach { (label, id) -> mode.addView(RadioButton(this).apply { text = label; this.id = id }) }
        mode.check(if (task?.mode == CodeMode.EXTERNAL) 102 else 101)
        if (task == null) content.addView(mode)
        val boxing = CheckBox(this).apply { text = "关联箱码与箱内产品"; isChecked = task?.boxing ?: true }
        val boxFirst = CheckBox(this).apply { text = "先采箱码（不勾选则先采产品）"; isChecked = prefs.getBoolean("boxFirst", true) }
        if (task == null) { content.addView(boxing); content.addView(boxFirst) }
        val base = if (task == null) editField(content, "内部码出图网址（以 ?code= 结尾）", prefs.getString("internalBase", CodePolicy.DEFAULT_BASE).orEmpty()) else null
        button("保存任务资料") {
            val v = fields.map { it.text.toString().trim() }
            val info = TaskInfo(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9])
            val selectedMode = if (mode.checkedRadioButtonId == 102) CodeMode.EXTERNAL else CodeMode.INTERNAL
            val selectedBoxing = boxing.isChecked
            val selectedFirst = boxFirst.isChecked
            val selectedBase = base?.text?.toString()?.trim() ?: task!!.internalBase
            run({
                if (task == null) flow.create(info, selectedMode, selectedBoxing, selectedFirst, selectedBase)
                else { flow.updateInfo(task.id, info); db.task(task.id) }
            }) { saved ->
                prefs.edit().putString("operator", info.operator).putString("line", info.line)
                    .putBoolean("boxFirst", selectedFirst).putString("internalBase", selectedBase).apply()
                paused = false; showTask(saved.id)
            }
        }
        button("返回任务页") { showHome() }
    }

    private fun showTask(id: String) {
        taskId = id
        prefs.edit().putString("selectedTaskId", id).apply()
        currentTask = null
        screen("生产采集任务记录", "", true, "task")
        collectingScreen = true
        countText = text("正在读取采集记录…", 20f, true); content.addView(countText)
        boxText = text("", 14f); content.addView(boxText)
        targetText = text("", 17f, true).apply { setTextColor(green) }; content.addView(targetText)
        val targets = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }; content.addView(targets)
        compactButton("采集箱码", targets) { mutation { flow.target(id, ScanTarget.BOX) } }
        compactButton("采集产品码", targets) { mutation { flow.target(id, ScanTarget.PRODUCT) } }
        compactButton("暂停／恢复", targets) { paused = !paused; refreshTask(); startScanner() }
        val entry = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL }
        content.addView(entry)
        input = EditText(this).apply {
            this.id = R.id.scan_input
            hint = "手工补录或键盘扫码内容"; textSize = 16f; setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            imeOptions = EditorInfo.IME_ACTION_DONE
            setOnEditorActionListener { _, action, event ->
                if (action == EditorInfo.IME_ACTION_DONE || (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_UP)) {
                    val value = text.toString()
                    // 部分输入法会同时回调完成键和回车释放；输入已消费时不再提交空码覆盖成功反馈。
                    if (value.isNotEmpty()) {
                        setText(""); submitScan(ScanInput(value, if (prefs.getBoolean("keyboard", false)) "扫码头键盘" else "手工补录"))
                    }
                    true
                } else false
            }
            if (prefs.getBoolean("keyboard", false)) showSoftInputOnFocus = false
        }.also { entry.addView(it, LinearLayout.LayoutParams(0, dp(54), 1f)) }
        entry.addView(Button(this).apply {
            text = "录入"; textSize = 16f; setTextColor(green)
            setOnClickListener { val value = input?.text?.toString().orEmpty(); input?.setText(""); submitScan(ScanInput(value, "手工补录")) }
        }, LinearLayout.LayoutParams(dp(76), dp(54)))
        feedback = ScanFeedbackView(this).also { view ->
            content.addView(view, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) })
            view.setOnClickListener { showCodeValue("本次录入内容", view.fullValue) }
        }
        recentTitle = text("本箱已录入（最新5条）", 15f, true); content.addView(recentTitle)
        recentRows = LinearLayout(this).apply { this.id = R.id.recent_codes; orientation = LinearLayout.VERTICAL }
            .also { content.addView(it) }
        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }; content.addView(actions)
        compactButton("完成本箱／本组", actions) {
            confirm("完成当前箱", "确认箱内实物与采集数量一致后完成。数量按实际记录，不预设装箱瓶数。") { mutation { flow.seal(id) } }
        }
        compactButton("下一箱／下一组", actions) { mutation { flow.next(id, prefs.getBoolean("boxFirst", true)) } }
        button("查看全部箱与产品记录") { showRecords(id, 0) }
        button("导出文件夹") { exportOptions(id) }
        button("更多任务操作") { taskActions(id) }
        button("切换采集任务") { showRecordTasks() }
        refreshTask()
    }
    private fun compactButton(label: String, parent: LinearLayout, action: () -> Unit) {
        parent.addView(Button(this).apply {
            text = label; textSize = 14f; isAllCaps = false; setTextColor(green); setOnClickListener { action() }
        }, LinearLayout.LayoutParams(0, dp(48), 1f))
    }
    private fun showCodeValue(title: String, value: String) {
        modal = true; scanner?.stop()
        val field = text(value, 16f).apply { setTextIsSelectable(true); setPadding(dp(18), dp(10), dp(18), dp(10)) }
        AlertDialog.Builder(this).setTitle(title).setView(ScrollView(this).apply { addView(field) })
            .setPositiveButton("关闭", null).create().also { dialog -> dialog.setOnDismissListener { modal = false; startScanner() }; dialog.show() }
    }
    private fun taskActions(id: String) {
        modal = true; scanner?.stop()
        val choices = arrayOf("设置任务资料", "更正当前箱码", "清除误扫箱码", "完成／重新打开任务")
        AlertDialog.Builder(this).setTitle("更多任务操作").setItems(choices) { _, which ->
            // 菜单关闭后再执行，避免嵌套弹窗的关闭事件提前恢复扫码。
            root.post {
                when (which) {
                    0 -> currentTask?.let { if (it.status == TaskStatus.OPEN) editInfo(it) else notify("请先重新打开任务", true) }
                    1 -> prompt("更正箱码", "输入或粘贴实际箱码，修改会保留操作记录") { value -> mutation { flow.replaceBox(id, value) } }
                    2 -> confirm("清除当前箱码", "产品记录保留并转为待关联。") { mutation { flow.clearBox(id) } }
                    3 -> changeTaskStatus(id)
                }
            }
        }.setNegativeButton("取消", null).create().also { dialog -> dialog.setOnDismissListener { modal = false; startScanner() }; dialog.show() }
    }
    private fun changeTaskStatus(id: String) {
            currentTask?.let { task ->
                confirm("确认任务状态", if (task.status == TaskStatus.OPEN) "所有已使用的箱必须完成。缺失资料会标记待补，采集完成不代表已经上传平台。" else "重新打开后可以补资料或更正采集记录。") {
                    mutation { if (task.status == TaskStatus.OPEN) flow.complete(id) else flow.reopenTask(id) }
                }
            }
    }
    private fun clearFeedback() { feedbackTaskId = null; feedbackGroupId = null; feedbackLabel = "" }
    private fun mutation(action: () -> Unit) { run(action) { clearFeedback(); refreshTask(); notify("操作已保存") } }
    private fun preview(id: String): CapturePreview = db.transaction {
        val task = db.task(id)
        CapturePreview(db.summary(task), db.group(task.currentGroupId), db.countInGroup(task.currentGroupId), db.recentCodesInGroup(task.currentGroupId))
    }
    private fun timeLabel(at: Long): String = Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("HH:mm:ss"))
    private fun displayResult(label: String, value: String, description: String, failed: Boolean, groupId: String?) {
        feedbackTaskId = taskId; feedbackGroupId = groupId
        feedbackLabel = label; feedbackValue = value; feedbackDetail = description; feedbackFailed = failed
        feedback?.display(label, value, description, failed)
    }
    private fun renderPreview(value: CapturePreview) {
        val (summary, group, count, codes) = value
        currentTask = summary.task
        groupOpen = !group.sealed
        countText?.text = getString(R.string.collection_counts, count, summary.codeCount, summary.boxCount)
        boxText?.text = getString(R.string.group_summary, summary.task.info.name, group.ordinal,
            group.boxRaw ?: if (summary.task.boxing) "待关联箱码" else "未启用装箱")
        boxText?.apply {
            maxLines = 2; ellipsize = TextUtils.TruncateAt.END
            setOnClickListener { group.boxRaw?.let { showCodeValue("当前箱码", it) } }
        }
        targetText?.text = when {
            summary.task.status == TaskStatus.COMPLETED -> "任务已完成 · 可查看和导出"
            paused -> "采集已暂停"
            group.sealed -> "本箱已完成，请开始下一箱"
            summary.task.target == ScanTarget.BOX -> "当前采集：箱码"
            else -> "当前采集：产品码"
        }
        input?.isEnabled = summary.task.status == TaskStatus.OPEN && !paused && !group.sealed && !app.exporting
        if (feedbackTaskId == taskId && feedbackGroupId == group.id && feedbackLabel.isNotEmpty()) {
            feedback?.display(feedbackLabel, feedbackValue, feedbackDetail, feedbackFailed)
        } else {
            val last = codes.firstOrNull()
            when {
                last != null -> displayResult("已录入 · 产品码", last.value,
                    "${timeLabel(last.scannedAt)} · ${if (summary.task.boxing && group.boxRaw == null) "待关联箱码" else "第${group.ordinal}箱／组"} · 点击查看完整内容", false, group.id)
                group.boxRaw != null -> displayResult("已录入 · 箱码", group.boxRaw.orEmpty(), "第${group.ordinal}箱 · 请继续录入产品码", false, group.id)
                else -> displayResult("等待录入", "本箱／本组还没有录入二维码", "扫码结果会显示在这里，成功保存后才计入数量", false, group.id)
            }
        }
        recentTitle?.text = getString(R.string.recent_codes_title, count)
        recentRows?.let { rows ->
            rows.removeAllViews()
            if (codes.isEmpty()) rows.addView(text("暂无已录入的产品码", 14f))
            codes.forEachIndexed { index, code ->
                rows.addView(text("✓ 已录入 · ${timeLabel(code.scannedAt)}\n${code.value}", 14f).apply {
                    maxLines = 3; ellipsize = TextUtils.TruncateAt.END
                    setPadding(dp(10), dp(5), dp(10), dp(5)); setBackgroundColor(if (index == 0) Color.WHITE else Color.rgb(237, 240, 237))
                    setOnClickListener { showCodeValue("已录入的产品码", code.value) }
                }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(4) })
            }
        }
        startScanner()
    }
    private fun refreshTask() {
        val id = taskId ?: return
        run({ preview(id) }) { if (taskId == id) renderPreview(it) }
    }
    private fun startScanner() {
        scanner?.stop(); scanner = null
        if (!foreground || !collectingScreen || taskId == null || paused || modal || app.exporting || !groupOpen || currentTask?.status != TaskStatus.OPEN) return
        if (prefs.getBoolean("keyboard", false)) { input?.requestFocus(); return }
        scanner = UrovoBroadcastScanner(this, ScannerConfig(
            actions = setOf(prefs.getString("action", "android.intent.ACTION_DECODE_DATA").orEmpty()),
            stringExtra = prefs.getString("extra", "barcode_string").orEmpty(),
            stripTerminator = prefs.getBoolean("stripTerminator", true)
        )).also { it.start(::submitScan) }
    }
    private fun submitScan(scan: ScanInput) {
        val id = taskId ?: return
        if (paused || modal || app.exporting || !foreground || !collectingScreen) {
            displayResult("未录入", scan.raw, "采集已暂停，请恢复后重新扫描", true, currentTask?.currentGroupId)
            notify("采集已暂停，未收录本次输入", true); return
        }
        val revision = screenRevision
        control.execute({ db.transaction {
            val target = db.task(id).target
            val receipt = flow.scan(id, scan.raw, scan.source)
            SavedScan(receipt, target, preview(id), System.currentTimeMillis())
        } }, { result ->
            if (taskId != id || revision != screenRevision || isFinishing || isDestroyed) return@execute
            val vibrator = getSystemService(VIBRATOR_SERVICE) as Vibrator
            vibrator.vibrate(VibrationEffect.createOneShot(55, VibrationEffect.DEFAULT_AMPLITUDE))
            val group = result.preview.group
            displayResult("已录入 · ${if (result.target == ScanTarget.BOX) "箱码" else "产品码"}", result.receipt.value,
                "${timeLabel(result.savedAt)} · 第${group.ordinal}箱／组 · ${group.boxRaw?.take(36) ?: if (result.preview.summary.task.boxing) "待关联箱码" else "未启用装箱"}\n${result.receipt.message} · 点击查看完整内容", false, group.id)
            renderPreview(result.preview)
            notify("${result.receipt.message} · ${timeLabel(result.savedAt)}")
            revealFeedback()
        }, { message ->
            if (taskId != id || revision != screenRevision || isFinishing || isDestroyed) return@execute
            val repeated = message.contains("已采集") || message.contains("已属于") || message.contains("已在本任务")
            displayResult(if (repeated) "重复码 · 未新增" else "未录入 · 请核对", scan.raw,
                "${timeLabel(System.currentTimeMillis())} · $message", true, currentTask?.currentGroupId)
            notify(message, true); revealFeedback()
        })
    }
    private fun revealFeedback() {
        // 连续扫码时把输入框和本次结果带回可视区域，不让成功提示藏在页面底部。
        feedback?.let { view -> scroll.post {
            if (view !== feedback || !collectingScreen) return@post
            val resultLocation = IntArray(2); val viewportLocation = IntArray(2)
            view.getLocationOnScreen(resultLocation); scroll.getLocationOnScreen(viewportLocation)
            if (resultLocation[1] < viewportLocation[1] || resultLocation[1] + view.height > viewportLocation[1] + scroll.height) {
                scroll.smoothScrollTo(0, (input?.parent as? View)?.top ?: view.top)
            }
        } }
    }

    private fun showRecords(id: String, offset: Int) {
        scanner?.stop(); scanner = null
        clearFeedback()
        recordsOffset = offset
        screen("全部采集记录", "删除、移箱前需重新打开相关箱。历史修改保留记录，任务之间不互相移动产品。", true, "records")
        button("返回扫码录入") { showTask(id) }
        button("导出文件夹") { exportOptions(id) }
        val rows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; content.addView(rows)
        run({ Triple(db.task(id), db.groups(id), db.recentCodes(id, offset)) }) { (task, groups, codes) ->
            currentTask = task
            groups.forEach { group ->
                button("第${group.ordinal}组 · ${if (group.sealed) "已完成" else "采集中"} · ${group.boxRaw?.take(36) ?: "待关联"}", rows) {
                    showGroupMenu(id, group)
                }
            }
            rows.addView(text(if (codes.isEmpty()) "暂无产品记录" else "产品记录 ${offset + 1}—${offset + codes.size}（每页最多80条）", 15f, true))
            codes.forEach { code ->
                val group = groups.first { it.id == code.groupId }
                val line = text("已录入 · ${timeLabel(code.scannedAt)} · 第${group.ordinal}箱／组\n${group.boxRaw ?: "未关联箱码"}\n${code.value}", 15f).apply { setTextIsSelectable(true) }
                rows.addView(line)
                button("处理此产品记录", rows) { showCodeMenu(id, code, groups) }
            }
            if (offset > 0) button("上一页", rows) { showRecords(id, (offset - 80).coerceAtLeast(0)) }
            if (codes.size == 80) button("下一页", rows) { showRecords(id, offset + 80) }
        }
    }
    private fun showGroupMenu(id: String, group: BoxGroup) {
        modal = true
        AlertDialog.Builder(this).setTitle("第${group.ordinal}组").setItems(arrayOf("切换到此箱", "重新打开此箱")) { _, which ->
            run({ if (which == 0) flow.selectGroup(id, group.id) else flow.reopenGroup(id, group.id) }) {
                if (which == 0) showTask(id) else showRecords(id, recordsOffset)
            }
        }.setNegativeButton("取消", null).create().also { dialog -> dialog.setOnDismissListener { modal = false }; dialog.show() }
    }
    private fun showCodeMenu(id: String, code: CollectedCode, groups: List<BoxGroup>) {
        modal = true
        AlertDialog.Builder(this).setTitle("处理产品记录").setItems(arrayOf("删除误扫记录", "移到其他箱")) { _, which ->
            if (which == 0) confirm("删除误扫", "确认删除该条记录？操作会留档。") {
                run({ flow.delete(id, code.id) }) { showRecords(id, recordsOffset) }
            } else {
                val available = groups.filter { !it.sealed && it.id != code.groupId }
                if (available.isEmpty()) notify("请先重新打开目标箱", true)
                else AlertDialog.Builder(this).setTitle("选择目标箱").setItems(available.map { "第${it.ordinal}组 · ${it.boxRaw ?: "待关联"}" }.toTypedArray()) { _, index ->
                    confirm("确认移箱", "请确认实物也已移动到目标箱。") { run({ flow.move(id, code.id, available[index].id) }) { showRecords(id, recordsOffset) } }
                }.setNegativeButton("取消", null).show()
            }
        }.setNegativeButton("取消", null).create().also { it.setOnDismissListener { modal = false }; it.show() }
    }
    private fun confirm(title: String, message: String, action: () -> Unit) {
        modal = true; scanner?.stop()
        AlertDialog.Builder(this).setTitle(title).setMessage(message).setPositiveButton("确认") { _, _ -> action() }
            .setNegativeButton("取消", null).create().also { dialog ->
                dialog.setOnDismissListener { modal = false; startScanner() }; dialog.show()
            }
    }
    private fun prompt(title: String, hint: String, action: (String) -> Unit) {
        modal = true; scanner?.stop()
        val field = EditText(this).apply { this.hint = hint; setSingleLine(false) }
        AlertDialog.Builder(this).setTitle(title).setView(field).setPositiveButton("确认") { _, _ -> action(field.text.toString()) }
            .setNegativeButton("取消", null).create().also { dialog -> dialog.setOnDismissListener { modal = false; startScanner() }; dialog.show() }
    }

    private fun settings() {
        screen("扫码设备设置", "在优博讯设备的扫码设置中选择对应输出方式。广播动作与字段名须与设备设置一致，本APP不会改动设备全局配置。", kind = "settings")
        val keyboard = CheckBox(this).apply { text = "使用键盘输出（需扫码后附加回车）"; isChecked = prefs.getBoolean("keyboard", false) }; content.addView(keyboard)
        val action = editField(content, "广播动作", prefs.getString("action", "android.intent.ACTION_DECODE_DATA").orEmpty())
        val extra = editField(content, "扫码内容字段", prefs.getString("extra", "barcode_string").orEmpty())
        val strip = CheckBox(this).apply { text = "移除扫码头附加的末尾回车／换行"; isChecked = prefs.getBoolean("stripTerminator", true) }; content.addView(strip)
        content.addView(text("品牌：优博讯 · 型号：i6310 PRO\n正式使用前先扫一个箱码与一个产品码确认完整内容。外部码不会打开网页或上传网络。", 14f))
        button("保存设备设置") {
            if (action.text.isBlank() || extra.text.isBlank()) { notify("请填写广播动作和内容字段", true); return@button }
            prefs.edit().putBoolean("keyboard", keyboard.isChecked).putString("action", action.text.toString().trim())
                .putString("extra", extra.text.toString().trim()).putBoolean("stripTerminator", strip.isChecked).apply()
            showHome(); notify("设备设置已保存")
        }
        button("返回") { showHome() }
    }
    private fun exportOptions(id: String) {
        modal = true; scanner?.stop()
        val check = CheckBox(this).apply { setText(R.string.export_qr_option) }
        AlertDialog.Builder(this).setTitle("导出采集文件夹").setMessage("采集中也可导出备份，待关联和缺失资料会明确标记。请选择Documents下的可写目录。")
            .setView(check).setPositiveButton("选择保存目录") { _, _ ->
                exportTaskId = id; exportQr = check.isChecked
                @Suppress("DEPRECATION")
                startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION), 300)
            }.setNegativeButton("取消", null).create().also { dialog -> dialog.setOnDismissListener { modal = false; startScanner() }; dialog.show() }
    }
    @Deprecated("兼容原生Activity的目录选择回调")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 300 || resultCode != RESULT_OK) return
        val tree = data?.data ?: return
        val id = exportTaskId ?: return
        val qr = exportQr
        app.exportState(true, "正在导出，请稍候"); scanner?.stop()
        control.execute({ FolderExporter(applicationContext).export(tree, db.snapshot(id), qr) { message -> app.exportState(true, message) } },
            { result ->
                app.exportState(false, "导出完成：${result.codeCount}条产品码，${result.fileCount}个文件\n目录：${result.folder.lastPathSegment}")
            },
            { message -> app.exportState(false, "导出未完成，请重新选择可写目录。$message") })
    }
    @Deprecated("兼容Android12返回键")
    override fun onBackPressed() {
        when (screenKind) {
            "tasks" -> super.onBackPressed()
            "records" -> taskId?.let(::showTask) ?: showRecordTasks()
            else -> showHome()
        }
    }
}
