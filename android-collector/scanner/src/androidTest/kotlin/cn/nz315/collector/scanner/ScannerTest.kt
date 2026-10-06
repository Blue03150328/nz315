package cn.nz315.collector.scanner

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class ScannerTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private fun receive(config: ScannerConfig, intent: Intent): ScanInput {
        val scanner = UrovoBroadcastScanner(context, config)
        val latch = CountDownLatch(1); var result: ScanInput? = null
        instrumentation.runOnMainSync { scanner.start { result = it; latch.countDown() } }
        try { context.sendBroadcast(intent); assertTrue(latch.await(5, TimeUnit.SECONDS)); return result!! }
        finally { instrumentation.runOnMainSync { scanner.stop() } }
    }
    @Test fun defaultBroadcastReceivesFullExternalLink() {
        val raw = "https://厂家.example/?id=0001&token=完整参数"
        val result = receive(ScannerConfig(), Intent("android.intent.ACTION_DECODE_DATA").putExtra("barcode_string", raw))
        assertEquals(raw, result.raw)
    }
    @Test fun customActionAndFieldWork() {
        val result = receive(ScannerConfig(setOf("nz315.TEST_SCAN"), "data"), Intent("nz315.TEST_SCAN").putExtra("data", "箱1"))
        assertEquals("箱1", result.raw)
    }
    @Test fun bytesLengthAndUtf8AreRespected() {
        val raw = "产品码中文"; val bytes = raw.toByteArray(Charsets.UTF_8) + byteArrayOf(0, 0)
        val result = receive(ScannerConfig(), Intent("android.intent.ACTION_DECODE_DATA").putExtra("barcode", bytes).putExtra("length", bytes.size - 2))
        assertEquals(raw, result.raw)
    }
    @Test fun stripsOnlyConfiguredTrailingDelimiter() {
        val raw = " 保留空格\n中间换行 \r\n"
        val result = receive(ScannerConfig(), Intent("android.intent.ACTION_DECODE_DATA").putExtra("barcode_string", raw))
        assertEquals(" 保留空格\n中间换行 ", result.raw)
    }
    @Test fun canPreserveIntentionalTrailingNewline() {
        val result = receive(ScannerConfig(stripTerminator = false), Intent("android.intent.ACTION_DECODE_DATA").putExtra("barcode_string", "原文\n"))
        assertEquals("原文\n", result.raw)
    }
}
