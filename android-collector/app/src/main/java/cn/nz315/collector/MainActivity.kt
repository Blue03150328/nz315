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
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.inputmethod.EditorInfo
import android.widget.*
import cn.nz315.collector.core.*
import cn.nz315.collector.export.FolderExporter
import cn.nz315.collector.scanner.*
import java.time.LocalDateTime
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
    private val green = Color.rgb(40, 91, 61)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        taskId = savedInstanceState?.getString("taskId")
        paused = savedInstanceState?.getBoolean("paused") ?: false
        exportTaskId = savedInstanceState?.getString("exportTaskId")
        exportQr = savedInstanceState?.getBoolean("exportQr") ?: false
        if (taskId != null) showTask(taskId!!) else showHome()
    }
    override fun onSaveInstanceState(out: Bundle) {
        out.putString("taskId", taskId); out.putBoolean("paused", paused)
        out.putString("exportTaskId", exportTaskId); out.putBoolean("exportQr", exportQr)
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
    private fun screen(title: String, hint: String) {
        screenRevision++
        collectingScreen = false
        scanner?.stop(); scanner = null; input = null
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(243, 245, 242)) }
        root.addView(text(title, 23f, true).apply { setPadding(dp(20), dp(14), dp(20), dp(14)); setTextColor(Color.WHITE); setBackgroundColor(green) })
        val scroll = ScrollView(this)
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(8), dp(16), dp(20)) }
        scroll.addView(content)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        content.addView(text(hint, 14f))
        status = text("数据仅保存在本机，完成后请导出备份", 14f).apply { setPadding(dp(16), dp(10), dp(16), dp(10)) }
        root.addView(status)
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
        taskId = null; currentTask = null
        screen("农资315 · 采集", "选择任务继续采集，或新建一个任务。箱码与产品码均使用实体扫码键。")
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
                button("打开任务", card) { paused = false; showTask(task.id) }
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
        screen(if (task == null) "新建采集任务" else "补充任务资料", "批号与生产日期按真实标签填写。未知资料可留空，导出时标记待补；资料不会自动绑定到网站。")
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
        button("返回") { if (task == null) showHome() else showTask(task.id) }
    }

    private fun showTask(id: String) {
        taskId = id
        screen("生产采集", "当前类型必须与实物一致。扫箱码后自动进入产品采集，先扫产品时可随时补采箱码。")
        collectingScreen = true
        countText = text("正在读取采集记录…", 21f, true); content.addView(countText)
        boxText = text("", 15f); content.addView(boxText)
        targetText = text("", 20f, true).apply { setTextColor(green) }; content.addView(targetText)
        button("采集箱码") { mutation { flow.target(id, ScanTarget.BOX) } }
        button("采集产品码") { mutation { flow.target(id, ScanTarget.PRODUCT) } }
        button("暂停／恢复采集") { paused = !paused; refreshTask(); startScanner() }
        input = EditText(this).apply {
            hint = "手工补录或键盘扫码内容"; textSize = 16f; setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            imeOptions = EditorInfo.IME_ACTION_DONE
            setOnEditorActionListener { _, action, event ->
                if (action == EditorInfo.IME_ACTION_DONE || (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_UP)) {
                    val value = text.toString(); setText(""); submitScan(ScanInput(value, if (prefs.getBoolean("keyboard", false)) "扫码头键盘" else "手工补录")); true
                } else false
            }
            if (prefs.getBoolean("keyboard", false)) showSoftInputOnFocus = false
        }.also { content.addView(it, LinearLayout.LayoutParams(-1, dp(54))) }
        button("提交输入内容") { val value = input?.text.toString(); input?.setText(""); submitScan(ScanInput(value, "手工补录")) }
        button("完成本箱／本组") {
            confirm("完成当前箱", "确认箱内实物与采集数量一致后完成。数量按实际记录，不预设装箱瓶数。") { mutation { flow.seal(id) } }
        }
        button("下一箱／下一组") { mutation { flow.next(id, prefs.getBoolean("boxFirst", true)) } }
        button("查看箱与产品记录") { showRecords(id, 0) }
        button("更正当前箱码") { prompt("更正箱码", "输入或粘贴实际箱码，修改会保留操作记录") { value -> mutation { flow.replaceBox(id, value) } } }
        button("清除误扫箱码") { confirm("清除当前箱码", "产品记录保留并转为待关联。空的误扫箱会从已使用箱统计中移除。") { mutation { flow.clearBox(id) } } }
        button("补充任务资料") { currentTask?.let { task -> if (task.status == TaskStatus.OPEN) editInfo(task) else notify("请先重新打开任务", true) } }
        button("导出文件夹") { exportOptions(id) }
        button("完成／重新打开任务") {
            currentTask?.let { task ->
                confirm("确认任务状态", if (task.status == TaskStatus.OPEN) "所有已使用的箱必须完成。缺失资料会标记待补，采集完成不代表已经上传平台。" else "重新打开后可以补资料或更正采集记录。") {
                    mutation { if (task.status == TaskStatus.OPEN) flow.complete(id) else flow.reopenTask(id) }
                }
            }
        }
        button("返回任务列表") { showHome() }
        refreshTask()
    }
    private fun mutation(action: () -> Unit) { run(action) { refreshTask(); notify("操作已保存") } }
    private fun refreshTask() {
        val id = taskId ?: return
        run({ val task = db.task(id); Triple(db.summary(task), db.group(task.currentGroupId), db.countInGroup(task.currentGroupId)) }) { (summary, group, count) ->
            if (taskId != id) return@run
            currentTask = summary.task
            countText?.text = getString(R.string.collection_counts, count, summary.codeCount, summary.boxCount)
            boxText?.text = getString(R.string.group_summary, summary.task.info.name, group.ordinal,
                group.boxRaw ?: if (summary.task.boxing) "待关联箱码" else "未启用装箱",
                if (group.sealed) "本箱已完成" else "本箱采集中", summary.task.info.missingFields().size)
            targetText?.text = when {
                summary.task.status == TaskStatus.COMPLETED -> "任务已完成"
                paused -> "采集已暂停"
                group.sealed -> "本箱已完成，请开始下一箱"
                summary.task.target == ScanTarget.BOX -> "当前采集：箱码"
                else -> "当前采集：产品码"
            }
            startScanner()
        }
    }
    private fun startScanner() {
        scanner?.stop(); scanner = null
        if (!foreground || !collectingScreen || taskId == null || paused || modal || app.exporting || currentTask?.status != TaskStatus.OPEN) return
        if (prefs.getBoolean("keyboard", false)) { input?.requestFocus(); return }
        scanner = UrovoBroadcastScanner(this, ScannerConfig(
            actions = setOf(prefs.getString("action", "android.intent.ACTION_DECODE_DATA").orEmpty()),
            stringExtra = prefs.getString("extra", "barcode_string").orEmpty(),
            stripTerminator = prefs.getBoolean("stripTerminator", true)
        )).also { it.start(::submitScan) }
    }
    private fun submitScan(scan: ScanInput) {
        val id = taskId ?: return
        if (paused || modal || app.exporting || !foreground || !collectingScreen) { notify("采集已暂停，未收录本次输入", true); return }
        run({ flow.scan(id, scan.raw, scan.source) }) { receipt ->
            if (taskId != id) return@run
            val vibrator = getSystemService(VIBRATOR_SERVICE) as Vibrator
            vibrator.vibrate(VibrationEffect.createOneShot(55, VibrationEffect.DEFAULT_AMPLITUDE))
            refreshTask(); notify("${receipt.message}\n${receipt.value.take(150)}")
        }
    }

    private fun showRecords(id: String, offset: Int) {
        scanner?.stop(); scanner = null
        recordsOffset = offset
        screen("箱与产品记录", "删除、移箱前需重新打开相关箱。历史修改保留记录，任务之间不互相移动产品。")
        button("返回采集") { showTask(id) }
        val rows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; content.addView(rows)
        run({ Triple(db.task(id), db.groups(id), db.recentCodes(id, offset)) }) { (task, groups, codes) ->
            currentTask = task
            groups.forEach { group ->
                button("第${group.ordinal}组 · ${if (group.sealed) "已完成" else "采集中"} · ${group.boxRaw?.take(36) ?: "待关联"}", rows) {
                    showGroupMenu(id, group)
                }
            }
            rows.addView(text("产品记录 ${offset + 1}—${offset + codes.size}（每页最多80条）", 15f, true))
            codes.forEach { code ->
                val group = groups.first { it.id == code.groupId }
                val line = text("第${group.ordinal}组 · ${code.value}", 15f).apply { setTextIsSelectable(true) }
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
        screen("扫码设备设置", "在优博讯设备的扫码设置中选择对应输出方式。广播动作与字段名须与设备设置一致，本APP不会改动设备全局配置。")
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
    override fun onBackPressed() { if (taskId != null) showHome() else super.onBackPressed() }
}
