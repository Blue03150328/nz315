package cn.nz315.collector

import android.app.Application
import android.os.Handler
import android.os.Looper
import cn.nz315.collector.core.CollectionWorkflow
import cn.nz315.collector.data.CollectorDatabase
import java.util.concurrent.Executors

/** 应用级依赖装配。设备接入、存储或导出实现可替换，业务模块保持独立。 */
class CollectorApp : Application() {
    val worker = Executors.newSingleThreadExecutor()
    val database by lazy { CollectorDatabase(this) }
    val workflow by lazy { CollectionWorkflow(database) }
    @Volatile var exporting = false
        private set
    @Volatile var exportMessage = ""
        private set
    private val exportListeners = java.util.concurrent.CopyOnWriteArraySet<() -> Unit>()
    fun observeExport(listener: () -> Unit) { exportListeners.add(listener) }
    fun removeExportObserver(listener: () -> Unit) { exportListeners.remove(listener) }
    fun exportState(busy: Boolean, message: String) {
        exporting = busy; exportMessage = message
        Handler(Looper.getMainLooper()).post { exportListeners.forEach { it() } }
    }
}
