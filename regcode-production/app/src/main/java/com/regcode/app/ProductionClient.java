package com.regcode.app;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/** 直接调用农资315接口，登录凭证只存在内存。 */
public final class ProductionClient {
    private String server = "https://www.nz315.cn";
    private volatile String cookie = "";
    private volatile String deviceToken = "";
    private final boolean allowHttp;

    public ProductionClient(boolean allowHttp) { this.allowHttp = allowHttp; }

    public synchronized void configure(String input) {
        URI uri = URI.create(input.trim());
        if (uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                || (uri.getPath() != null && !uri.getPath().isEmpty() && !uri.getPath().equals("/"))
                || !("https".equalsIgnoreCase(uri.getScheme()) || (allowHttp && "http".equalsIgnoreCase(uri.getScheme()) && localAddress(uri.getHost())))) {
            throw new IllegalArgumentException(allowHttp ? "请填写HTTPS地址，或本机测试用的局域网HTTP地址，不包含路径或账号密码" : "请填写完整HTTPS服务器地址，不包含路径或账号密码");
        }
        server = input.trim().replaceAll("/+$", "");
        cookie = "";
        deviceToken = "";
    }

    public synchronized void clear() { cookie = ""; }
    public boolean hasSession() { return !cookie.isEmpty() || !deviceToken.isEmpty(); }
    public boolean deviceMode() { return !deviceToken.isEmpty(); }
    public synchronized void deviceCredential(String value) { if(!value.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("设备凭证格式错误");deviceToken=value;cookie=""; }
    public synchronized void accountMode() { deviceToken="";cookie=""; }
    private static boolean localAddress(String host) {
        if("localhost".equalsIgnoreCase(host) || "[::1]".equals(host) || "::1".equals(host))return true;
        String[] parts=host.split("\\.");if(parts.length!=4)return false;
        int[] n=new int[4];try{for(int i=0;i<4;i++){if(!parts[i].matches("[0-9]{1,3}"))return false;n[i]=Integer.parseInt(parts[i]);if(n[i]>255)return false;}}catch(NumberFormatException error){return false;}
        return n[0]==127 || n[0]==10 || (n[0]==192 && n[1]==168) || (n[0]==172 && n[1]>=16 && n[1]<=31);
    }

    public synchronized JSONObject request(String method, String path, String body) {
        HttpURLConnection connection = null;
        try {
            if(deviceMode() && path.startsWith("/api/admin/production-tasks"))path=path.replace("/api/admin/production-tasks","/api/device/production-tasks");
            URI relative = URI.create(path);
            String resource = relative.getPath();
            boolean allowed = "GET".equals(method) && (resource.equals("/api/auth/me") || resource.equals("/api/admin/products")
                    || resource.equals("/api/admin/production-tasks") || resource.equals("/api/admin/production-tasks/sources")
                    || resource.matches("/api/admin/production-tasks/[1-9][0-9]*"));
            allowed |= "POST".equals(method) && (resource.equals("/api/auth/login") || resource.equals("/api/auth/logout")
                    || resource.equals("/api/admin/production-tasks")
                    || resource.matches("/api/admin/production-tasks/[1-9][0-9]*/(scan|end)"));
            allowed |= "POST".equals(method) && (resource.matches("/api/admin/production-tasks/[1-9][0-9]*/collection-sessions")
                    || resource.matches("/api/admin/production-tasks/[1-9][0-9]*/collection-sessions/[a-fA-F0-9-]{36}/(events|complete)"));
            allowed |= "GET".equals(method) && (resource.equals("/api/device/context") || resource.equals("/api/device/production-tasks") || resource.matches("/api/device/production-tasks/[1-9][0-9]*"));
            allowed |= "POST".equals(method) && (resource.equals("/api/device/activate") || resource.equals("/api/device/context") || resource.matches("/api/device/production-tasks/[1-9][0-9]*/collection-sessions") || resource.matches("/api/device/production-tasks/[1-9][0-9]*/collection-sessions/[a-fA-F0-9-]{36}/(events|complete)"));
            if (!allowed || relative.isAbsolute() || relative.getRawAuthority() != null || relative.getFragment() != null) {
                throw new IllegalArgumentException("不支持的生产操作");
            }
            connection = (HttpURLConnection) new URL(server + path).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            if (!cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
            if(!deviceToken.isEmpty() && resource.startsWith("/api/device/") && !resource.equals("/api/device/activate"))connection.setRequestProperty("Authorization","Bearer "+deviceToken);
            if ("POST".equals(method)) {
                byte[] bytes = new JSONObject(body).toString().getBytes(StandardCharsets.UTF_8);
                connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            String raw = read(stream);
            JSONObject data;
            try { data = new JSONObject(raw); }
            catch (Exception ignored) { data = null; }
            if (status == 401) cookie = "";
            if (status < 200 || status >= 300) {
                String message = status >= 500 ? "服务器尚未确认，请核对原码后重试"
                        : status == 401 ? deviceMode()?"设备凭证失效，请联系管理员重新激活":"账号登录已失效，请重新登录"
                        : status >= 300 && status < 400 ? "服务器地址发生跳转，请使用最终HTTPS地址"
                        : data == null ? "请求被拒绝，请刷新任务核对" : data.optString("statusMessage", "操作未通过，请核对任务与码");
                return new JSONObject().put("status", status).put("error", message);
            }
            if (data == null) return new JSONObject().put("status", 0).put("error", "服务器返回无效资料，该操作尚未确认");
            for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
                if (header.getKey() != null && header.getKey().equalsIgnoreCase("Set-Cookie")) {
                    for (String value : header.getValue()) {
                        String first = value.split(";", 2)[0];
                        if (first.startsWith("nz315_user=")) cookie = first;
                    }
                }
            }
            return new JSONObject().put("status", status).put("body", data);
        } catch (Exception error) {
            try { return new JSONObject().put("status", 0).put("error", error instanceof IllegalArgumentException
                    ? error.getMessage() : "网络中断或超时。请保持原码，联网后核对或重试"); }
            catch (Exception impossible) { throw new IllegalStateException("无法构造请求结果", impossible); }
        } finally { if (connection != null) connection.disconnect(); }
    }

    private static String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > 4 * 1024 * 1024) throw new IllegalStateException("服务器资料过大");
                output.write(buffer, 0, count);
            }
            return output.toString("UTF-8");
        }
    }
}
