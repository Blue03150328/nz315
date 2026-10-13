package com.regcode.collection;

import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/** 使用可辨认的生产资料命名，不改变导出内容或签名。 */
public final class ProductionExportName {
    private ProductionExportName() {}

    public static String create(JSONObject context, JSONObject identity, String runId, long exportedAt) {
        String timestamp = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss", Locale.ROOT)
            .withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(exportedAt));
        return part(identity.optString("enterpriseName"), "公司", 54) + "_"
            + part(context.optString("produceDate"), "日期未填写", 12) + "_"
            + part(context.optString("productName"), "产品未填写", 60) + "_"
            + part(context.optString("batchNo"), "批号未填写", 30) + "_"
            + part(context.optString("lineName"), "生产线待确认", 24) + "_工号"
            + part(identity.optString("username"), "未填写", 18) + "_"
            + timestamp + "_" + part(runId, "记录", 8) + ".txt";
    }

    public static String external(JSONObject identity, String runId, int count, long exportedAt) {
        String timestamp = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss", Locale.ROOT)
            .withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(exportedAt));
        return "外码采集_" + part(identity.optString("enterpriseName"), "公司", 54)
            + "_工号" + part(identity.optString("username"), "未填写", 18)
            + "_设备" + part(identity.optString("deviceName"), identity.optString("deviceId", "未填写"), 24)
            + "_" + count + "条_" + timestamp + "_" + part(runId, "记录", 8) + ".txt";
    }

    private static String part(String text, String fallback, int maximumBytes) {
        String cleaned = text.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "-").trim()
            .replaceAll("[. ]+$", "");
        if (cleaned.isEmpty()) cleaned = fallback;
        StringBuilder value = new StringBuilder();
        int used = 0;
        for (int offset = 0; offset < cleaned.length();) {
            int point = cleaned.codePointAt(offset);
            String character = new String(Character.toChars(point));
            int length = character.getBytes(StandardCharsets.UTF_8).length;
            if (used + length > maximumBytes) break;
            value.append(character);
            used += length;
            offset += Character.charCount(point);
        }
        return value.toString().replaceAll("[. ]+$", "");
    }
}
