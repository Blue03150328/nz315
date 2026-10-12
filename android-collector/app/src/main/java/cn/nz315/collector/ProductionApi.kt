package cn.nz315.collector

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/** 会话仅存内存，不保存密码；网络失败不产生本地已用记录。 */
object ProductionApi {
    var server = "https://www.nz315.cn"
        private set
    var user: JSONObject? = null
        private set
    private var cookie = ""
    val signedIn get() = cookie.isNotEmpty() && user != null

    fun configure(value: String, debug: Boolean) {
        val uri = runCatching { URI(value.trim().trimEnd('/')) }.getOrNull()
            ?: throw IllegalArgumentException("服务器地址格式不正确")
        if (uri.host.isNullOrBlank() || uri.userInfo != null || uri.query != null || uri.fragment != null ||
            !uri.path.isNullOrEmpty() || (uri.scheme != "https" && !(debug && uri.scheme == "http"))) {
            throw IllegalArgumentException("请输入完整HTTPS服务器地址，调试版可使用HTTP测试地址")
        }
        if (server != uri.toString()) clear()
        server = uri.toString()
    }

    fun clear() { cookie = ""; user = null }
    fun login(username: String, password: String) {
        clear()
        val result = request("/api/auth/login", JSONObject().put("username", username).put("password", password))
        user = result.getJSONObject("user")
        if (cookie.isEmpty()) { clear(); throw IllegalStateException("服务器未返回登录会话") }
    }

    fun request(path: String, body: JSONObject? = null): JSONObject {
        val conn = URL(server + path).openConnection() as HttpURLConnection
        conn.connectTimeout = 10000
        conn.readTimeout = 30000
        conn.instanceFollowRedirects = false
        conn.requestMethod = if (body == null) "GET" else "POST"
        conn.setRequestProperty("Accept", "application/json")
        if (cookie.isNotEmpty()) conn.setRequestProperty("Cookie", cookie)
        try {
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val raw = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val result = runCatching { JSONObject(raw) }.getOrElse { JSONObject() }
            if (status == 401) { clear(); throw IllegalStateException("登录已失效，请重新登录；本次操作未确认") }
            if (status !in 200..299) throw IllegalStateException(when {
                status >= 500 -> "服务器未确认操作，请保持原码并重试"
                status == 404 -> "生产任务或接口不存在，请确认服务器已部署对应版本并刷新任务"
                status in 300..399 -> "服务器地址发生跳转，请填写最终HTTPS地址重新登录"
                else -> result.optString("statusMessage", "操作未确认，请刷新任务状态")
            })
            conn.headerFields.filterKeys { it?.equals("Set-Cookie", true) == true }.values.flatten().forEach {
                val value = it.substringBefore(';')
                if (value.startsWith("nz315_user=")) cookie = value
            }
            return result
        } catch (e: java.io.IOException) {
            throw IllegalStateException("网络中断或超时，暂停采集；该码未确认，可恢复网络后重试同一码", e)
        } finally { conn.disconnect() }
    }
}
