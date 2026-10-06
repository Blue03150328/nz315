package cn.nz315.collector.export

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.provider.DocumentsContract
import cn.nz315.collector.core.*
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.MultiFormatWriter
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

data class ExportResult(val folder: Uri, val fileCount: Int, val codeCount: Int)

/** 导出写入独立目录，最后才写完成标记；失败产物不得被误认为完整文件。 */
class FolderExporter(private val context: Context) {
    fun export(tree: Uri, snapshot: TaskSnapshot, includeQr: Boolean, progress: (String) -> Unit): ExportResult {
        val resolver = context.contentResolver
        val parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
        val name = ExportFormat.folderName(snapshot.task.info.name, snapshot.task.id, UUID.randomUUID().toString())
        val folder = DocumentsContract.createDocument(resolver, parent, DocumentsContract.Document.MIME_TYPE_DIR, name)
            ?: error("无法创建导出文件夹，请重新选择可写目录")
        val files = JSONArray()
        var completionUri: Uri? = null
        fun write(parentUri: Uri, fileName: String, mime: String, bytes: ByteArray) {
            val document = DocumentsContract.createDocument(resolver, parentUri, mime, fileName)
                ?: error("无法创建文件：$fileName")
            val actualName = resolver.query(document, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) it.getString(it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)) else null
            } ?: error("无法确认导出文件名称：$fileName")
            resolver.openOutputStream(document, "w")?.use { it.write(bytes); it.flush() }
                ?: error("无法写入文件：$fileName")
            val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            val relativeName = if (parentUri == folder) actualName else "二维码图片/$actualName"
            files.put(JSONObject().put("name", relativeName).put("bytes", bytes.size).put("sha256", hash))
        }
        fun text(fileName: String, content: String, bom: Boolean = false) {
            val mime = when {
                fileName.endsWith(".json") -> "application/json"
                fileName.endsWith(".csv") -> "text/csv"
                fileName.endsWith(".jsonl") -> "application/x-ndjson"
                else -> "text/plain"
            }
            write(folder, fileName, mime, ((if (bom) "\uFEFF" else "") + content).toByteArray(Charsets.UTF_8))
        }
        try {
            text("导出中.json", JSONObject().put("schemaVersion", ExportFormat.SCHEMA_VERSION).put("status", "INCOMPLETE").put("taskId", snapshot.task.id).toString(2))
            val groupMap = snapshot.groups.associateBy { it.id }
            val csv = StringBuilder(ExportFormat.csvRow("序号", "产品码", "箱序号", "箱码", "关联状态", "箱状态", "采集时间", "来源"))
            val sheet = StringBuilder(ExportFormat.csvRow("序号", "产品码", "箱序号", "箱码", "关联状态", "箱状态", "采集时间", "来源"))
            val relation = StringBuilder(ExportFormat.csvRow("箱序号", "箱码", "产品码", "关联状态"))
            snapshot.codes.forEachIndexed { index, code ->
                val group = groupMap[code.groupId] ?: error("产品码缺少箱记录，已中止导出")
                val state = if (!snapshot.task.boxing) "未启用装箱" else if (group.boxRaw == null) "待关联箱码" else "已关联"
                val cells = arrayOf((index + 1).toString(), code.value, group.ordinal.toString(), group.boxRaw.orEmpty(), state,
                    if (group.sealed) "已完成" else "采集中", Instant.ofEpochMilli(code.scannedAt).toString(), code.source)
                csv.append(ExportFormat.csvRow(*cells))
                sheet.append(ExportFormat.csvRow(*cells, spreadsheet = true))
                relation.append(ExportFormat.csvRow(group.ordinal.toString(), group.boxRaw.orEmpty(), code.value, state))
            }
            progress("正在导出${snapshot.codes.size}条产品码和箱码关系")
            text("采集明细_原始.csv", csv.toString(), true)
            text("采集明细_表格查看.csv", sheet.toString(), true)
            if (snapshot.task.boxing) text("箱码关联.csv", relation.toString(), true)
            if (snapshot.codes.all { !it.value.contains('\n') && !it.value.contains('\r') }) {
                text("追溯码清单.txt", snapshot.codes.joinToString("\r\n", postfix = "\r\n") { it.value })
            } else {
                // 多行原文不能伪装成一行一码，JSONL明确保留完整字符。
                text("追溯码清单.jsonl", snapshot.codes.joinToString("\n", postfix = "\n") { JSONObject().put("value", it.value).toString() })
            }
            text("任务资料.json", snapshotJson(snapshot).toString(2))
            text("操作记录.csv", buildString {
                append(ExportFormat.csvRow("时间", "操作", "详情"))
                snapshot.events.forEach { append(ExportFormat.csvRow(Instant.ofEpochMilli(it.at).toString(), it.action, it.detail)) }
            }, true)
            if (includeQr) {
                val images = DocumentsContract.createDocument(resolver, folder, DocumentsContract.Document.MIME_TYPE_DIR, "二维码图片")
                    ?: error("无法创建二维码图片目录")
                snapshot.codes.forEachIndexed { index, code ->
                    if (index % 20 == 0) progress("正在生成二维码 ${index + 1}/${snapshot.codes.size}")
                    val content = ExportFormat.qrContent(snapshot.task, code)
                    val matrix = MultiFormatWriter().encode(content, BarcodeFormat.QR_CODE, 512, 512,
                        mapOf(EncodeHintType.CHARACTER_SET to "UTF-8", EncodeHintType.MARGIN to 4))
                    val pixels = IntArray(matrix.width * matrix.height) { p -> if (matrix[p % matrix.width, p / matrix.width]) 0xff000000.toInt() else 0xffffffff.toInt() }
                    val bitmap = Bitmap.createBitmap(pixels, matrix.width, matrix.height, Bitmap.Config.ARGB_8888)
                    val bytes = java.io.ByteArrayOutputStream().use { output ->
                        try { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)); output.toByteArray() }
                        finally { bitmap.recycle() }
                    }
                    write(images, "%06d.png".format(index + 1), "image/png", bytes)
                }
            }
            text("使用说明.txt", """本目录是离线采集结果，不代表已上传平台或已绑定生产批次。
只有“导出完成.json”可完整解析、status为COMPLETE且文件校验一致时，才是完整导出。导出中.json是开始时的留证文件。
任务资料.json包含完整码值、箱关系、任务公共资料和版本号，是后续对接的数据依据。
内部产品码保存32位文本，出图时补上任务保存的内部码网址；外部产品码保留扫码原文。
箱码始终保存原文；空箱码表示待关联，不能视为已装箱。
采集明细_原始.csv及箱码关联.csv用于程序读取，请勿用Excel另存覆盖原始码值。
采集明细_表格查看.csv每个单元格加文本前缀，避免长数字精度丢失和公式执行。
多行扫码内容使用JSONL清单，读取value字段可还原原文。
时间采用UTC的ISO格式；二维码图片序号对应采集明细序号，出图前后扫码内容一致。
同一设备、同一任务内执行去重；跨设备重复需在导入平台时再次校验。
缺失资料：${snapshot.task.info.missingFields().joinToString().ifBlank { "无" }}
""")
            val completion = JSONObject().put("schemaVersion", ExportFormat.SCHEMA_VERSION).put("status", "COMPLETE")
                .put("taskId", snapshot.task.id).put("exportedAt", Instant.now().toString())
                .put("codeCount", snapshot.codes.size).put("files", files)
            completionUri = DocumentsContract.createDocument(resolver, folder, "application/json", "导出完成.json") ?: error("无法写入导出完成标记")
            resolver.openOutputStream(completionUri, "w")?.use { it.write(completion.toString(2).toByteArray(Charsets.UTF_8)); it.flush() }
                ?: error("无法写入导出完成标记")
            return ExportResult(folder, files.length() + 1, snapshot.codes.size)
        } catch (error: Exception) {
            completionUri?.let { uri -> runCatching { DocumentsContract.deleteDocument(resolver, uri) } }
            runCatching { text("导出失败.txt", "本次导出未完成，请勿导入此目录。原采集数据仍在APP内，请重新导出。") }
            throw error
        }
    }

    fun snapshotJson(s: TaskSnapshot): JSONObject {
        val task = s.task
        val info = task.info
        @Suppress("DEPRECATION")
        val appVersion = context.packageManager.getPackageInfo(context.packageName, 0).versionName.orEmpty()
        return JSONObject().put("schemaVersion", ExportFormat.SCHEMA_VERSION).put("appVersion", appVersion)
            .put("task", JSONObject().put("id", task.id).put("name", info.name).put("mode", task.mode.name)
                .put("boxing", task.boxing).put("internalBase", task.internalBase).put("createdAt", task.createdAt)
                .put("status", task.status.name).put("currentGroupId", task.currentGroupId).put("target", task.target.name)
                .put("enterprise", info.enterprise).put("product", info.product).put("specification", info.specification)
                .put("batchNo", info.batchNo).put("produceDate", info.produceDate).put("qualityCertNo", info.qualityCertNo)
                .put("line", info.line).put("operator", info.operator).put("note", info.note).put("missingFields", JSONArray(info.missingFields())))
            .put("groups", JSONArray(s.groups.map { group -> JSONObject().put("id", group.id).put("ordinal", group.ordinal)
                .put("boxRaw", group.boxRaw ?: JSONObject.NULL).put("sealed", group.sealed).put("createdAt", group.createdAt) }))
            .put("codes", JSONArray(s.codes.map { code -> JSONObject().put("id", code.id).put("groupId", code.groupId)
                .put("value", code.value).put("scannedAt", code.scannedAt).put("source", code.source) }))
            .put("events", JSONArray(s.events.map { event -> JSONObject().put("id", event.id).put("action", event.action).put("detail", event.detail).put("at", event.at) }))
    }
}
