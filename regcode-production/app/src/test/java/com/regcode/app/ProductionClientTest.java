package com.regcode.app;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** 在隔离HTTP服务验证会话、协议失败和请求格式，不写真实数据库。 */
public class ProductionClientTest {
    private MockServer server;
    private ProductionClient client;
    private String base;
    private final AtomicReference<String> cookie = new AtomicReference<>();
    private final AtomicReference<String> payload = new AtomicReference<>();
    private final AtomicReference<String> authorization = new AtomicReference<>();
    private final AtomicReference<String> requestPath = new AtomicReference<>();
    @Before public void setup() throws Exception {
        server = new MockServer();
        server.start(); base = "http://127.0.0.1:" + server.getAddress().getPort();
        client = new ProductionClient(true); client.configure(base);
    }
    @After public void cleanup() { server.stop(0); }

    /** 使用标准Socket，避免安卓单测编译环境缺少jdk.httpserver模块。 */
    private final class MockServer extends Thread {
        private final ServerSocket socket;
        MockServer() throws Exception { socket = new ServerSocket(); socket.bind(new InetSocketAddress("127.0.0.1", 0)); setDaemon(true); }
        InetSocketAddress getAddress() { return (InetSocketAddress) socket.getLocalSocketAddress(); }
        void stop(int ignored) { try { socket.close(); } catch (Exception ignoredError) { } }
        @Override public void run() {
            while (!socket.isClosed()) {
                try (Socket accepted = socket.accept()) {
                    InputStream input = accepted.getInputStream(); ByteArrayOutputStream headerBytes = new ByteArrayOutputStream();
                    String headers = ""; int next;
                    while ((next = input.read()) != -1) {
                        headerBytes.write(next); headers = headerBytes.toString("UTF-8");
                        if (headers.endsWith("\r\n\r\n")) break;
                    }
                    String path = headers.split(" ", 3)[1]; requestPath.set(path);int length = 0; cookie.set(null);authorization.set(null);
                    for (String line : headers.split("\r\n")) {
                        if (line.toLowerCase().startsWith("content-length:")) length = Integer.parseInt(line.substring(15).trim());
                        if (line.toLowerCase().startsWith("cookie:")) cookie.set(line.substring(7).trim());
                        if (line.toLowerCase().startsWith("authorization:")) authorization.set(line.substring(14).trim());
                    }
                    byte[] request = new byte[length]; int offset = 0;
                    while (offset < length) { int count = input.read(request, offset, length - offset); if (count == -1) break; offset += count; }
                    payload.set(new String(request, StandardCharsets.UTF_8));
                    int status = 200; String body = "{\"ok\":true}", extra = "";
                    if (path.endsWith("login")) extra = "Set-Cookie: nz315_user=private-session; HttpOnly; Path=/\r\n";
                    if (path.endsWith("products")) { status = 401; body = "{\"statusMessage\":\"登录失效\"}"; }
                    if (path.endsWith("/2/scan")) { status = 409; body = "{\"statusMessage\":\"此码不在当前批次\"}"; }
                    if (path.endsWith("/3/scan")) { status = 500; body = "{\"statusMessage\":\"内部错误\"}"; }
                    if (path.endsWith("/4/scan")) body = "<html>not JSON</html>";
                    if (path.endsWith("/5/scan")) { status = 302; extra = "Location: /api/auth/login\r\n"; }
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    accepted.getOutputStream().write(("HTTP/1.1 " + status + " Result\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: " + bytes.length + "\r\n" + extra + "\r\n").getBytes(StandardCharsets.UTF_8));
                    accepted.getOutputStream().write(bytes); accepted.getOutputStream().flush();
                } catch (Exception ignored) { /* 关闭测试服务时结束接受连接。 */ }
            }
        }
    }
    @Test public void sessionCookieAnd401() throws Exception {
        assertEquals(200, client.request("POST", "/api/auth/login", "{\"username\":\"测试\",\"password\":\"仅测试\"}").getInt("status"));
        client.request("GET", "/api/auth/me", "{}"); assertEquals("nz315_user=private-session", cookie.get());
        assertEquals(401, client.request("GET", "/api/admin/products", "{}").getInt("status"));
        client.request("GET", "/api/auth/me", "{}"); assertNull(cookie.get());
    }
    @Test public void clearAndServerChangeRemoveCookie() {
        client.request("POST", "/api/auth/login", "{}"); client.clear(); client.request("GET", "/api/auth/me", "{}"); assertNull(cookie.get());
        client.request("POST", "/api/auth/login", "{}"); client.configure(base); client.request("GET", "/api/auth/me", "{}"); assertNull(cookie.get());
    }
    @Test public void preservesLeadingZerosAndChineseDevice() throws Exception {
        String code = "00000000000000000000000000000001";
        client.request("POST", "/api/admin/production-tasks/1/scan", new JSONObject().put("code", code).put("device", "一号扫描仪").toString());
        JSONObject body = new JSONObject(payload.get()); assertEquals(code, body.getString("code")); assertEquals("一号扫描仪", body.getString("device"));
    }
    @Test public void explicit409And500KeepStatus() throws Exception {
        assertEquals(409, client.request("POST", "/api/admin/production-tasks/2/scan", "{}").getInt("status"));
        JSONObject response = client.request("POST", "/api/admin/production-tasks/3/scan", "{}"); assertEquals(500, response.getInt("status")); assertTrue(response.getString("error").contains("尚未确认"));
    }
    @Test public void malformed200AndRedirectCannotCountAsSuccess() throws Exception {
        assertEquals(0, client.request("POST", "/api/admin/production-tasks/4/scan", "{}").getInt("status"));
        assertEquals(302, client.request("POST", "/api/admin/production-tasks/5/scan", "{}").getInt("status"));
    }
    @Test public void disconnectedNetworkIsUnknown() throws Exception {
        server.stop(0); assertEquals(0, client.request("GET", "/api/auth/me", "{}").getInt("status"));
    }
    @Test public void deviceAuthenticationHasSeparateScopeAndSurvivesAccountLogout() throws Exception {
        String token="a".repeat(64);client.deviceCredential(token);
        client.request("GET","/api/admin/production-tasks?page=2","{}");
        assertEquals("/api/device/production-tasks?page=2",requestPath.get());assertEquals("Bearer "+token,authorization.get());assertNull(cookie.get());
        client.clear();assertTrue(client.hasSession());
        client.request("GET","/api/auth/me","{}");assertNull(authorization.get());
        assertEquals(0,client.request("POST","/api/admin/production-tasks","{}").getInt("status"));
        assertEquals(0,client.request("POST","/api/admin/production-tasks/1/scan","{}").getInt("status"));
        client.configure(base);assertFalse(client.deviceMode());assertFalse(client.hasSession());
    }
    @Test public void deviceQueuesUseRestrictedCollectionRoutes() throws Exception {
        client.deviceCredential("b".repeat(64));
        String sid="3beff054-1b7d-4c72-8c25-e8937024b523",basePath="/api/admin/production-tasks/1/collection-sessions";
        for(String path:new String[]{basePath,basePath+"/"+sid+"/events",basePath+"/"+sid+"/complete"}){
            assertEquals(200,client.request("POST",path,"{}").getInt("status"));assertTrue(requestPath.get().startsWith("/api/device/"));
        }
        client.request("POST","/api/device/activate","{}");assertNull(authorization.get());
        client.accountMode();assertFalse(client.deviceMode());
    }
    @Test public void refusesArbitraryEndpoints() throws Exception {
        for (String path : new String[] { "https://example.com/api/auth/me", "//example.com/api/auth/me", "/api/users", "/api/admin/production-tasks/1/scan#fragment" }) assertEquals(0, client.request("GET", path, "{}").getInt("status"));
    }
    @Test public void productionRequiresHttpsAndRootUrl() {
        ProductionClient production = new ProductionClient(false);
        for (String url : new String[] { base, "https://user:password@example.com", "https://example.com/trace", "https://example.com?code=1", "file:///tmp/page" }) {
            try { production.configure(url); fail("非法地址不能通过"); } catch (IllegalArgumentException expected) { assertNotNull(expected.getMessage()); }
        }
        production.configure("https://www.nz315.cn/");
    }
    @Test public void debugAllowsOnlyPrivateHttpAndCollectionEndpoints() throws Exception {
        for(String url:new String[]{"http://192.168.3.18:38121","http://10.0.0.2:38121","http://172.16.1.2:38121",base})client.configure(url);
        for(String url:new String[]{"http://93.184.216.34","http://public.example","http://172.32.0.1","http://192.168.999.1"}){
            try{client.configure(url);fail("测试HTTP不得指向公网");}catch(IllegalArgumentException expected){assertNotNull(expected.getMessage());}
        }
        client.configure(base);
        String path="/api/admin/production-tasks/1/collection-sessions",id="3beff054-1b7d-4c72-8c25-e8937024b523";
        for(String target:new String[]{path,path+"/"+id+"/events",path+"/"+id+"/complete"})assertEquals(200,client.request("POST",target,"{\"events\":[]}").getInt("status"));
    }
}
