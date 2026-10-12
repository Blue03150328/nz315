package cn.nz315.collector

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.text.InputType
import android.view.KeyEvent
import android.widget.*
import cn.nz315.collector.scanner.ScannerConfig
import cn.nz315.collector.scanner.ScannerPort
import cn.nz315.collector.scanner.UrovoBroadcastScanner
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.Executors

/** 联网生产与原离线采集隔离，所有使用计数以服务器收据为准。 */
class ProductionActivity : Activity() {
    private lateinit var content: LinearLayout
    private lateinit var status: TextView
    private var scanner: ScannerPort? = null
    private val executor = Executors.newSingleThreadExecutor()
    private var busy = false
    private var taskId: Long? = null
    private var active = false
    private var foreground = false
    private var confirming = false
    private var taskPage = 1
    private var codeInput: EditText? = null
    private var totalText: TextView? = null
    private var taskInfo: JSONObject? = null
    private var draftCodes: EditText? = null
    private val labels = mapOf("active" to "生产中", "pending" to "剩余码待审核", "rejected" to "审核退回，剩余码继续锁定", "approved" to "已结束，剩余码已放行")
    private val reviewer get() = ProductionApi.user?.optString("role") in listOf("platform_admin", "enterprise_admin")
    private val writable get() = ProductionApi.user?.optString("role") != "viewer"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (ProductionApi.signedIn) showTasks() else showLogin()
    }
    override fun onPause() { foreground = false; scanner?.stop(); scanner = null; super.onPause() }
    override fun onResume() { super.onResume(); foreground = true; startScanner() }
    override fun onDestroy() { scanner?.stop(); executor.shutdown(); super.onDestroy() }

    private fun screen(title: String) {
        scanner?.stop(); scanner = null; active = false; codeInput = null; totalText = null
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(20, 20, 20, 30) }
        content.addView(TextView(this).apply { text = title; textSize = 22f })
        status = TextView(this).apply { textSize = 16f; setPadding(0, 15, 0, 15) }; content.addView(status)
        setContentView(ScrollView(this).apply { addView(content) })
    }
    private fun text(value: String) { content.addView(TextView(this).apply { text = value; textSize = 16f; setPadding(0, 8, 0, 8) }) }
    private fun field(label: String, value: String = "", type: Int = InputType.TYPE_CLASS_TEXT): EditText {
        text(label)
        return EditText(this).apply { setText(value); inputType = type; content.addView(this) }
    }
    private fun button(label: String, action: () -> Unit) {
        content.addView(Button(this).apply { text = label; isAllCaps = false; setOnClickListener { if (!busy) action() else status.text = "正在等待服务器确认，请稍候" } })
    }
    private fun <T> call(work: () -> T, done: (T) -> Unit) {
        if (busy) return
        busy = true; status.text = "正在等待服务器确认…"
        executor.execute {
            val result = runCatching(work)
            runOnUiThread {
                busy = false
                if (isFinishing || isDestroyed) return@runOnUiThread
                result.fold({ done(it) }, { error ->
                    if (!ProductionApi.signedIn) showLogin()
                    val message = error.message.orEmpty()
                    status.text = if (message.any { it in '\u4e00'..'\u9fff' }) message else "服务器返回的资料不完整，请刷新或联系管理员"
                })
            }
        }
    }
    private fun showLogin() {
        taskId = null; screen("联网生产登录")
        val prefs = getSharedPreferences("production_server", MODE_PRIVATE)
        val server = field("服务器地址", prefs.getString("server", "https://www.nz315.cn")!!)
        val username = field("后台账号")
        val password = field("密码", type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        text("使用每台设备专属的后台采集账号。同一账号在其他设备登录，会替换当前会话。密码不保存。")
        button("登录") {
            val url = server.text.toString(); val name = username.text.toString(); val pass = password.text.toString()
            call({ ProductionApi.configure(url, applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0); ProductionApi.login(name, pass) }) {
                prefs.edit().putString("server", ProductionApi.server).apply(); password.setText(""); showTasks()
            }
        }
        button("返回离线采集") { finish() }
    }
    private fun showTasks() {
        taskId = null; screen("联网生产任务")
        call({ ProductionApi.request("/api/admin/production-tasks?page=$taskPage") }) { result ->
            status.text = getString(R.string.production_page_status, taskPage)
            if (writable) button("创建任务并领用码清单") { showCreate() }
            val rows = result.getJSONArray("rows")
            if (rows.length() == 0) text("暂无生产任务")
            for (i in 0 until rows.length()) {
                val t = rows.getJSONObject(i)
                button("${t.getString("name")} · ${t.getString("product_name")}\n${labels[t.getString("status")]} · 已用${t.getInt("used_count")}/${t.getInt("total")}") { openTask(t.getLong("id")) }
            }
            if (taskPage > 1) button("上一页") { taskPage--; showTasks() }
            if (taskPage * 30 < result.getInt("total")) button("下一页") { taskPage++; showTasks() }
            button("刷新") { showTasks() }
            button("退出登录") { call({ ProductionApi.request("/api/auth/logout", JSONObject()) }) { ProductionApi.clear(); showLogin() } }
            button("返回离线采集") { finish() }
        }
    }
    private fun showCreate() {
        screen("创建生产任务")
        val keyword = field("搜索产品名称或登记证号")
        button("搜索产品") {
            call({ ProductionApi.request("/api/admin/products?status=1&pageSize=100&keyword=" + URLEncoder.encode(keyword.text.toString(), "UTF-8")) }) { result ->
                val rows = result.getJSONArray("rows")
                if (rows.length() == 0) { status.text = "没有匹配产品"; return@call }
                val names = Array(rows.length()) { i -> rows.getJSONObject(i).getString("name") + " · " + rows.getJSONObject(i).getString("registration_no") }
                AlertDialog.Builder(this).setTitle("选择产品").setItems(names) { _, index -> createForm(rows.getJSONObject(index)) }.setNegativeButton("取消", null).show()
            }
        }
        button("返回任务列表") { showTasks() }
    }
    private fun createForm(product: JSONObject) {
        screen("领用：" + product.getString("name"))
        val name = field("任务名称")
        val batch = field("生产批号")
        val date = field("生产日期（年-月-日）", java.time.LocalDate.now().toString())
        val expiry = field("有效期至（年-月-日）")
        val cert = field("质量合格证号")
        val qc = CheckBox(this).apply { text = "已确认质检合格"; content.addView(this) }
        val codes = field("领用清单：每行一个32位码，最多10000个", type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE).apply { minLines = 4 }
        draftCodes = codes
        val requestId = UUID.randomUUID().toString()
        button("选择码清单文件") {
            startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type = "text/*"; addCategory(Intent.CATEGORY_OPENABLE) }, 401)
        }
        text("请先在网站将生成码入库留档。这里仅锁定领用，扫码成功才写生产资料。超时后请保持表单不变重试；也可返回列表查询是否已创建。")
        button("确认领用") {
            val payload = JSONObject().put("requestId", requestId).put("productId", product.getLong("id")).put("name", name.text.toString()).put("batchNo", batch.text.toString()).put("produceDate", date.text.toString()).put("expireDate", expiry.text.toString()).put("qualityCertNo", cert.text.toString()).put("qcResult", if (qc.isChecked) 1 else 0).put("content", codes.text.toString())
            call({ ProductionApi.request("/api/admin/production-tasks", payload) }) { openTask(it.getLong("id")) }
        }
        button("返回任务列表") { showTasks() }
    }
    private fun openTask(id: Long) {
        call({ ProductionApi.request("/api/admin/production-tasks/$id") }) { showTask(it) }
    }
    private fun showTask(detail: JSONObject) {
        val task = detail.getJSONObject("task"); taskInfo = task; taskId = task.getLong("id")
        screen(task.getString("name")); active = task.getString("status") == "active" && writable
        text("${task.getString("product_name")} · 批号${task.getString("batch_no")}\n生产日期${task.getString("produce_date").take(10)} · 有效期${task.getString("expire_date").take(10)}\n质检合格 · 合格证${task.getString("quality_cert_no")}")
        totalText = TextView(this).apply { text = summary(detail); textSize = 18f; content.addView(this) }
        status.text = labels[task.getString("status")]
        if (active) {
            codeInput = field("实体扫码键扫描；也可输入码或二维码地址")
            codeInput!!.setOnKeyListener { _, key, event -> if (key == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_UP) { submitScan(codeInput!!.text.toString()); true } else false }
            button("提交当前码 / 重试") { submitScan(codeInput!!.text.toString()) }
            val owns = ProductionApi.user?.optLong("id") == task.getLong("created_by")
            if (owns || reviewer) button("结束生产并提交剩余码审核") {
                confirming = true; scanner?.stop(); scanner = null
                AlertDialog.Builder(this).setTitle("确认结束生产？").setMessage("结束后禁止继续扫码，未用码自动提交管理员审核，无需再次扫描剩余包装。")
                    .setPositiveButton("结束生产") { _, _ -> call({ ProductionApi.request("/api/admin/production-tasks/${taskId}/end", JSONObject()) }) { openTask(taskId!!) } }.setNegativeButton("取消", null)
                    .setOnDismissListener { confirming = false; startScanner() }.show()
            }
        }
        if (reviewer && task.getString("status") in listOf("pending", "rejected")) {
            text("请在后台查看完整剩余码清单后审核。批准只释放未用码，已用码资料保持原批次。")
            val reason = field("审核原因")
            fun review(decision: String) {
                AlertDialog.Builder(this).setTitle(if (decision == "approve") "确认放行剩余码？" else "确认退回？")
                    .setPositiveButton("确认") { _, _ -> call({ ProductionApi.request("/api/admin/production-tasks/${taskId}/review", JSONObject().put("decision", decision).put("reason", reason.text.toString())) }) { openTask(taskId!!) } }.setNegativeButton("取消", null).show()
            }
            button("批准剩余码再次领用") { review("approve") }
            button("退回，继续锁定") { review("reject") }
        }
        button("刷新服务器状态") { openTask(taskId!!) }
        button("返回任务列表") { showTasks() }
        startScanner()
    }
    private fun summary(detail: JSONObject): String {
        val counts = detail.getJSONArray("counts"); var total = 0; var used = 0
        for (i in 0 until counts.length()) { val row = counts.getJSONObject(i); total += row.getInt("count"); if (row.getString("state") == "used") used = row.getInt("count") }
        return "领用${total} · 已使用${used} · 未使用${total - used}"
    }
    private fun submitScan(raw: String) {
        if (!active || !foreground || confirming || taskId == null) return
        if (busy) { status.text = "前一码尚未确认，请稍候再扫"; return }
        codeInput?.setText(raw)
        val id = taskId!!
        val device = android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL
        call({ ProductionApi.request("/api/admin/production-tasks/$id/scan", JSONObject().put("code", raw).put("device", device.take(100))) }) { receipt ->
            val label = if (receipt.optBoolean("duplicate")) "此前已确认，不重复计数" else "生产扫码成功"
            val confirmed = receipt.optString("code")
            // 成功收据后刷新统计；统计刷新失败仍保留收据，不能把未确认码记为成功。
            call({ ProductionApi.request("/api/admin/production-tasks/$id") }) { detail ->
                totalText?.text = summary(detail); codeInput?.setText(""); status.text = getString(R.string.production_scan_receipt, label, confirmed)
                if (detail.getJSONObject("task").getString("status") != "active") showTask(detail)
            }
        }
    }
    private fun startScanner() {
        if (!active || !foreground || confirming || scanner != null) return
        val prefs = getSharedPreferences("collector_settings", MODE_PRIVATE)
        if (prefs.getBoolean("keyboard", false)) { codeInput?.requestFocus(); return }
        val config = ScannerConfig(actions = setOf(prefs.getString("action", "android.intent.ACTION_DECODE_DATA")!!), stringExtra = prefs.getString("extra", "barcode_string")!!, stripTerminator = prefs.getBoolean("stripTerminator", true))
        scanner = UrovoBroadcastScanner(this, config).also { it.start { input -> submitScan(input.raw) } }
    }
    @Deprecated("兼容原生Activity的文件选择回调")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 401 || resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        call({ contentResolver.openInputStream(uri)?.use { stream ->
            val bytes = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
            while (true) { val count = stream.read(buffer); if (count < 0) break; require(bytes.size() + count <= 500000) { "码文件过大，最多10000个码" }; bytes.write(buffer, 0, count) }
            String(bytes.toByteArray(), Charsets.UTF_8)
        } ?: "" }) { draftCodes?.setText(it) }
    }
}
