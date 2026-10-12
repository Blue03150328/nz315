package cn.nz315.collector

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.widget.LinearLayout
import android.widget.TextView

/** 输入下方的结果卡只在数据库提交后显示成功，失败时保留本次尝试的完整码值。 */
class ScanFeedbackView(context: Context) : LinearLayout(context) {
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private val title = TextView(context).apply {
        id = R.id.scan_result_status; textSize = 18f; setTypeface(typeface, Typeface.BOLD)
    }
    private val value = TextView(context).apply {
        id = R.id.scan_result_value; textSize = 16f; setTextColor(Color.rgb(30, 42, 33))
        maxLines = 2; ellipsize = TextUtils.TruncateAt.END; setPadding(0, dp(5), 0, dp(5))
    }
    private val detail = TextView(context).apply { id = R.id.scan_result_detail; textSize = 13f }
    var fullValue: String = ""
        private set
    init {
        orientation = VERTICAL; setPadding(dp(12), dp(10), dp(12), dp(10))
        addView(title); addView(value); addView(detail)
        display("等待录入", "扫码后在这里查看是否已保存", "下方列表仅显示已写入本机的记录", false)
    }
    fun display(label: String, code: String, description: String, failed: Boolean) {
        fullValue = code
        val color = if (failed) Color.rgb(170, 45, 35) else Color.rgb(40, 91, 61)
        background = GradientDrawable().apply {
            setColor(if (failed) Color.rgb(255, 239, 237) else Color.rgb(230, 242, 234))
            cornerRadius = dp(10).toFloat()
        }
        title.text = label; title.setTextColor(color); value.text = code
        detail.text = description; detail.setTextColor(color)
        accessibilityLiveRegion = ACCESSIBILITY_LIVE_REGION_POLITE
    }
}
