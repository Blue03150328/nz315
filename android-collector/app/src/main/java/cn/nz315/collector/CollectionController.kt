package cn.nz315.collector

import android.os.Handler
import android.os.Looper
import cn.nz315.collector.core.RuleViolation

/** 所有写操作进入同一队列，界面只在提交完成后显示成功。 */
class CollectionController(private val app: CollectorApp) {
    private val main = Handler(Looper.getMainLooper())
    fun <T> execute(operation: () -> T, success: (T) -> Unit, failure: (String) -> Unit) {
        app.worker.execute {
            try { val result = operation(); main.post { success(result) } }
            catch (error: Exception) {
                val message = if (error is RuleViolation) error.message ?: "请核对采集内容"
                else "操作未完成，已保留原采集数据，请重试"
                main.post { failure(message) }
            }
        }
    }
}
