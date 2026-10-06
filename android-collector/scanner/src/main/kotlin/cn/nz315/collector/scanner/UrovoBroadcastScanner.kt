package cn.nz315.collector.scanner

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** 只订阅已配置的扫码动作，不修改设备全局参数，不主动关闭其他应用使用的扫码头。 */
class UrovoBroadcastScanner(private val context: Context, private val config: ScannerConfig) : ScannerPort {
    private var receiver: BroadcastReceiver? = null
    override fun start(onScan: (ScanInput) -> Unit) {
        stop()
        val listener = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action !in config.actions) return
                val text = intent.getStringExtra(config.stringExtra) ?: decodeBytes(intent) ?: return
                val value = if (config.stripTerminator) text.trimEnd('\r', '\n') else text
                if (value.isNotEmpty()) onScan(ScanInput(value, "优博讯广播"))
            }
        }
        val filter = IntentFilter().apply { config.actions.forEach(::addAction) }
        // 优博讯扫码服务位于独立进程，Android13以上也必须允许设备服务发来的广播。
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(listener, filter, Context.RECEIVER_EXPORTED)
        else @Suppress("DEPRECATION") context.registerReceiver(listener, filter)
        receiver = listener
    }
    private fun decodeBytes(intent: Intent): String? {
        val bytes = intent.getByteArrayExtra(config.bytesExtra) ?: return null
        val length = intent.getIntExtra(config.lengthExtra, bytes.size).coerceIn(0, bytes.size)
        return runCatching {
            Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes, 0, length)).toString()
        }.getOrNull()
    }
    override fun stop() {
        receiver?.let { runCatching { context.unregisterReceiver(it) } }
        receiver = null
    }
}
