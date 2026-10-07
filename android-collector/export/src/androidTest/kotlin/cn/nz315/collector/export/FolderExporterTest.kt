package cn.nz315.collector.export

import android.graphics.BitmapFactory
import android.provider.DocumentsContract
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import cn.nz315.collector.core.*
import com.google.zxing.BinaryBitmap
import com.google.zxing.MultiFormatReader
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest

@RunWith(AndroidJUnit4::class)
class FolderExporterTest {
    private val context = InstrumentationRegistry.getInstrumentation().context
    private val tree = DocumentsContract.buildTreeDocumentUri("cn.nz315.collector.export.test.documents", "root")
    private fun snapshot(value: String = "https://厂家.example/产品?code=0001&x=中文", mode: CodeMode = CodeMode.EXTERNAL): TaskSnapshot {
        val task = CollectionTask("测试任务", TaskInfo("导出验收"), mode, true, CodePolicy.DEFAULT_BASE, 1000, currentGroupId = "组1", target = ScanTarget.PRODUCT)
        return TaskSnapshot(task, listOf(BoxGroup("组1", task.id, 1, "箱1", true, 1000)),
            listOf(CollectedCode("码1", task.id, "组1", value, 1001, "验收扫码头")), emptyList())
    }
    private fun folder(uri: android.net.Uri) = File(File(context.cacheDir, "export-test"), DocumentsContract.getDocumentId(uri))
    @Test fun exportRetainsOriginalValueAndCorrectChecksums() {
        val snapshot = snapshot()
        val result = FolderExporter(context).export(tree, snapshot, false) { }
        val directory = folder(result.folder)
        assertTrue(File(directory, "导出完成.json").exists())
        assertTrue(File(directory, "采集明细_原始.csv").isFile)
        assertFalse(File(directory, "采集明细_原始.csv.txt").exists())
        assertEquals(snapshot.codes.single().value + "\r\n", File(directory, "追溯码清单.txt").readText())
        val data = JSONObject(File(directory, "任务资料.json").readText())
        assertEquals(snapshot.codes.single().value, data.getJSONArray("codes").getJSONObject(0).getString("value"))
        val manifest = JSONObject(File(directory, "导出完成.json").readText()).getJSONArray("files")
        for (i in 0 until manifest.length()) {
            val row = manifest.getJSONObject(i)
            val file = File(directory, row.getString("name"))
            assertEquals(row.getLong("bytes"), file.length())
            val hash = MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { "%02x".format(it) }
            assertEquals(row.getString("sha256"), hash)
        }
    }
    @Test fun qrImageDecodesToSameExternalValue() {
        val snapshot = snapshot(); val result = FolderExporter(context).export(tree, snapshot, true) { }
        val image = BitmapFactory.decodeFile(File(folder(result.folder), "二维码图片/000001.png").path)
        val pixels = IntArray(image.width * image.height); image.getPixels(pixels, 0, image.width, 0, 0, image.width, image.height)
        val decoded = MultiFormatReader().decode(BinaryBitmap(HybridBinarizer(RGBLuminanceSource(image.width, image.height, pixels))))
        assertEquals(snapshot.codes.single().value, decoded.text); image.recycle()
        val directory = folder(result.folder)
        val files = JSONObject(File(directory, "导出完成.json").readText()).getJSONArray("files")
        val imageEntry = (0 until files.length()).map(files::getJSONObject).single { it.getString("name").endsWith(".png") }
        val imageFile = File(directory, imageEntry.getString("name"))
        assertTrue(imageFile.isFile)
        val hash = MessageDigest.getInstance("SHA-256").digest(imageFile.readBytes()).joinToString("") { "%02x".format(it) }
        assertEquals(imageEntry.getString("sha256"), hash)
    }
    @Test fun internalQrUsesConfiguredWebsiteAndLeadingZerosRemain() {
        val code = "12011031001" + "0".repeat(21); val snapshot = snapshot(code, CodeMode.INTERNAL)
        val result = FolderExporter(context).export(tree, snapshot, true) { }
        val image = BitmapFactory.decodeFile(File(folder(result.folder), "二维码图片/000001.png").path)
        val pixels = IntArray(image.width * image.height); image.getPixels(pixels, 0, image.width, 0, 0, image.width, image.height)
        val decoded = MultiFormatReader().decode(BinaryBitmap(HybridBinarizer(RGBLuminanceSource(image.width, image.height, pixels))))
        assertEquals(CodePolicy.DEFAULT_BASE + code, decoded.text); image.recycle()
    }
    @Test fun multilineContentUsesLosslessJsonLines() {
        val value = "第一行\n第二行\r\n"; val result = FolderExporter(context).export(tree, snapshot(value), false) { }
        val directory = folder(result.folder)
        assertFalse(File(directory, "追溯码清单.txt").exists())
        assertEquals(value, JSONObject(File(directory, "追溯码清单.jsonl").readText().trim()).getString("value"))
    }
    @Test fun repeatedExportsDoNotOverwriteExistingFolder() {
        val exporter = FolderExporter(context); val first = exporter.export(tree, snapshot(), false) { }; val second = exporter.export(tree, snapshot(), false) { }
        assertNotEquals(first.folder, second.folder)
        assertTrue(File(folder(first.folder), "导出完成.json").exists())
    }
    @Test fun failedExportHasNoCompletionMarker() {
        val root = File(context.cacheDir, "export-test").apply { mkdirs() }
        val before = root.listFiles()?.map { it.name }?.toSet().orEmpty()
        val marker = File(root, "simulate-failure"); marker.writeText("1")
        try { FolderExporter(context).export(tree, snapshot(), false) { }; fail("应模拟失败") }
        catch (_: Exception) {
            val incomplete = root.listFiles()!!.first { it.isDirectory && it.name !in before }
            assertFalse(File(incomplete, "导出完成.json").exists()); assertTrue(File(incomplete, "导出失败.txt").exists())
        } finally { marker.delete() }
    }
}
