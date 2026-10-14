package com.regcode.collection;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/** 内外码仅按完整扫码网址分类，离线时也不查询码池或码库。 */
public final class TraceUrlPolicy {
    public static final String DEFAULT_BASE = "https://www.nz315.cn/trace?code=";
    private TraceUrlPolicy() { }

    private static URI httpUri(String raw) {
        try {
            URI uri = new URI(raw.trim());
            String scheme = uri.getScheme();
            if (!("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)) ||
                    uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawFragment() != null) return null;
            return uri;
        } catch (Exception ignored) { return null; }
    }

    private static int port(URI uri) {
        int value = uri.getPort();
        return value == -1 || value == ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80) ? -1 : value;
    }

    public static String codeOf(String raw, String base) {
        URI uri = httpUri(raw), expected = httpUri(base);
        if (uri == null) return null;
        boolean platform = ("www.nz315.cn".equalsIgnoreCase(uri.getHost()) || "nz315.cn".equalsIgnoreCase(uri.getHost())) &&
                "/trace".equals(uri.getRawPath()) && port(uri) == -1;
        boolean custom = expected != null && uri.getScheme().equalsIgnoreCase(expected.getScheme()) &&
                uri.getHost().equalsIgnoreCase(expected.getHost()) && port(uri) == port(expected) &&
                uri.getRawPath().equals(expected.getRawPath());
        if (!platform && !custom) return null;
        String code = null;
        int count = 0;
        try {
            for (String parameter : (uri.getRawQuery() == null ? "" : uri.getRawQuery()).split("&")) {
                String[] pair = parameter.split("=", 2);
                if ("code".equals(URLDecoder.decode(pair[0], StandardCharsets.UTF_8.name()))) {
                    count++;
                    code = pair.length == 2 ? URLDecoder.decode(pair[1], StandardCharsets.UTF_8.name()) : "";
                }
            }
        } catch (Exception ignored) { return null; }
        return count == 1 && code != null && code.matches("[0-9]{32}") ? code : null;
    }

    public static String classification(String raw, String base) {
        if (codeOf(raw, base) != null) return "internal";
        return httpUri(raw) == null ? "unparsed" : "external";
    }

    /** 新版生产先分类；历史外码分类与旧队列继续使用原规则。 */
    public static String productionClassification(String raw, String base) {
        if (raw == null || raw.matches("(?s).*[\\r\\n\\x00].*")) return "unparsed";
        if (codeOf(raw, base) != null || raw.trim().matches("[0-9]{32}")) return "internal";
        URI uri = httpUri(raw), expected = httpUri(base);
        if (uri == null || "www.nz315.cn".equalsIgnoreCase(uri.getHost()) || "nz315.cn".equalsIgnoreCase(uri.getHost())) return "unparsed";
        if (expected != null && uri.getHost().equalsIgnoreCase(expected.getHost())) return "unparsed";
        if ((uri.getRawPath() == null || uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath())) && (uri.getRawQuery() == null || uri.getRawQuery().isEmpty())) return "unparsed";
        return "external";
    }
}
