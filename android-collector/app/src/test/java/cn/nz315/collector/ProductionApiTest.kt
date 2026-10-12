package cn.nz315.collector

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.net.ServerSocket
import java.net.InetAddress

/** 使用本机HTTP服务核对真实请求、会话及失败收据，不访问正式平台。 */
class ProductionApiTest {
    private lateinit var server: ServerSocket
    private lateinit var base: String
    @Volatile private var mode = "ok"
    @Volatile private var lastCookie = ""
    @Volatile private var lastBody = ""
    @Before fun setup() {
        ProductionApi.clear()
        server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        Thread {
            while (!server.isClosed) runCatching { server.accept().use { socket ->
                socket.soTimeout = 5000
                val input = socket.getInputStream().buffered()
                fun line(): String { val out = StringBuilder(); while (true) { val b = input.read(); if (b < 0 || b == 10) break; if (b != 13) out.append(b.toChar()) }; return out.toString() }
                val request = line(); val headers = mutableMapOf<String, String>()
                while (true) { val row = line(); if (row.isEmpty()) break; headers[row.substringBefore(':').lowercase()] = row.substringAfter(':').trim() }
                lastCookie = headers["cookie"].orEmpty()
                val bytes = ByteArray(headers["content-length"]?.toInt() ?: 0); var offset = 0
                while (offset < bytes.size) { val n = input.read(bytes, offset, bytes.size - offset); if (n < 0) break; offset += n }
                lastBody = String(bytes, Charsets.UTF_8)
                val login = request.contains(" /api/auth/login ")
                val code = when (mode) { "expired" -> 401; "conflict" -> 409; "error" -> 500; else -> 200 }
                val body = (if (login) "{\"user\":{\"id\":1,\"role\":\"code_admin\"}}" else if (code == 200) "{\"ok\":true,\"duplicate\":true}" else "{\"statusMessage\":\"码已被其他任务占用\"}").toByteArray()
                val cookie = if (login) "Set-Cookie: nz315_user=test-session; HttpOnly; Path=/\r\n" else ""
                val response = "HTTP/1.1 $code Result\r\nContent-Type: application/json\r\nContent-Length: ${body.size}\r\nConnection: close\r\n${cookie}\r\n"
                socket.getOutputStream().use { it.write(response.toByteArray()); it.write(body) }
            } }
        }.apply { isDaemon = true; start() }
        base = "http://127.0.0.1:${server.localPort}"
        ProductionApi.configure(base, true)
    }
    @After fun cleanup() { server.close(); ProductionApi.clear() }
    @Test fun loginAndCookieAreRealRequests() {
        ProductionApi.login("采集员", "临时测试密码")
        assertTrue(ProductionApi.signedIn)
        assertEquals("采集员", JSONObject(lastBody).getString("username"))
        assertTrue(ProductionApi.request("/api/admin/production-tasks").getBoolean("ok"))
        assertEquals("nz315_user=test-session", lastCookie)
    }
    @Test fun duplicateReceiptRetainsServerResult() {
        ProductionApi.login("采集员", "测试密码")
        val payload = JSONObject().put("code", "1".repeat(32)).put("device", "测试设备")
        assertTrue(ProductionApi.request("/api/admin/production-tasks/1/scan", payload).getBoolean("duplicate"))
        assertEquals("1".repeat(32), JSONObject(lastBody).getString("code"))
    }
    @Test fun expiredSessionClearsLoginAndDoesNotConfirmScan() {
        ProductionApi.login("采集员", "测试密码"); mode = "expired"
        assertThrows(IllegalStateException::class.java) { ProductionApi.request("/api/admin/production-tasks/1/scan", JSONObject()) }
        assertFalse(ProductionApi.signedIn)
    }
    @Test fun conflictsAndServerFailureNeverReturnSuccess() {
        ProductionApi.login("采集员", "测试密码"); mode = "conflict"
        assertTrue(assertThrows(IllegalStateException::class.java) { ProductionApi.request("/test", JSONObject()) }.message!!.contains("占用"))
        mode = "error"
        assertTrue(assertThrows(IllegalStateException::class.java) { ProductionApi.request("/test", JSONObject()) }.message!!.contains("未确认"))
    }
    @Test fun disconnectedNetworkDoesNotReturnReceipt() {
        ProductionApi.login("采集员", "测试密码"); server.close()
        assertTrue(assertThrows(IllegalStateException::class.java) { ProductionApi.request("/test", JSONObject()) }.message!!.contains("暂停采集"))
    }
    @Test fun releaseRequiresHttpsAndServerChangeClearsSession() {
        assertThrows(IllegalArgumentException::class.java) { ProductionApi.configure(base, false) }
        assertThrows(IllegalArgumentException::class.java) { ProductionApi.configure("https://name:password@example.com", false) }
        ProductionApi.login("采集员", "测试密码")
        ProductionApi.configure("https://www.nz315.cn", false)
        assertFalse(ProductionApi.signedIn)
    }
}
