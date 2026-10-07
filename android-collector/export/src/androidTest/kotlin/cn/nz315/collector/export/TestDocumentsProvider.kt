package cn.nz315.collector.export

import android.database.Cursor
import android.database.MatrixCursor
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract.Document
import android.provider.DocumentsProvider
import java.io.File

/** 验收专用目录提供器，所有文件仅写入测试APK缓存目录。 */
class TestDocumentsProvider : DocumentsProvider() {
    private val root get() = File(context!!.cacheDir, "export-test").apply { mkdirs() }
    override fun onCreate() = true
    private fun file(id: String): File = if (id == "root") root else File(root, id).also {
        require(it.canonicalPath.startsWith(root.canonicalPath + File.separator))
    }
    override fun queryRoots(projection: Array<out String>?) = MatrixCursor(arrayOf("root_id", "document_id", "title", "flags")).apply { addRow(arrayOf("root", "root", "测试目录", 0)) }
    private fun cursor(files: List<File>): Cursor = MatrixCursor(arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE, Document.COLUMN_FLAGS, Document.COLUMN_SIZE)).apply {
        files.forEach { file -> addRow(arrayOf(if (file == root) "root" else file.relativeTo(root).path.replace('\\', '/'), file.name,
            if (file.isDirectory) Document.MIME_TYPE_DIR else "application/octet-stream", Document.FLAG_SUPPORTS_WRITE or Document.FLAG_DIR_SUPPORTS_CREATE, file.length())) }
    }
    override fun queryDocument(documentId: String, projection: Array<out String>?) = cursor(listOf(file(documentId)))
    override fun queryChildDocuments(parentDocumentId: String, projection: Array<out String>?, sortOrder: String?) = cursor(file(parentDocumentId).listFiles()?.toList().orEmpty())
    override fun createDocument(parentDocumentId: String, mimeType: String, displayName: String): String {
        if (displayName == "采集明细_原始.csv" && File(root, "simulate-failure").exists()) throw java.io.FileNotFoundException("模拟目录拒绝写入")
        // 模拟系统文件提供器按MIME补扩展名，验证CSV不会被误写成TXT。
        val actualName = if (mimeType == "text/plain" && displayName.endsWith(".csv")) "$displayName.txt" else displayName
        val child = File(file(parentDocumentId), actualName)
        if (mimeType == Document.MIME_TYPE_DIR) check(child.mkdir()) else check(child.createNewFile())
        return child.relativeTo(root).path.replace('\\', '/')
    }
    override fun openDocument(documentId: String, mode: String, signal: CancellationSignal?) = ParcelFileDescriptor.open(file(documentId), ParcelFileDescriptor.parseMode(mode))
    override fun deleteDocument(documentId: String) { check(file(documentId).delete()) }
    override fun isChildDocument(parentDocumentId: String, documentId: String) = file(documentId).canonicalPath.startsWith(file(parentDocumentId).canonicalPath + File.separator)
}
