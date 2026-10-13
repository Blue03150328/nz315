package com.regcode.collection;

import org.json.JSONObject;
import org.junit.Test;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

public class ProductionExportNameTest {
    @Test public void externalNameShowsModeCountAndOperatorDevice() {
        JSONObject identity = new JSONObject().put("enterpriseName", "测试农化有限公司")
            .put("username", "001").put("deviceName", "设备/7");
        String name = ProductionExportName.external(identity, "abcd1234-efgh", 123, 1791850000000L);
        assertTrue(name.startsWith("外码采集_测试农化有限公司_工号001_设备设备-7_123条_"));
        assertTrue(name.endsWith("_abcd1234.txt"));
        assertFalse(name.matches("(?s).*[\\\\/:*?\"<>|\\p{Cntrl}].*"));
    }
    @Test public void keepsBusinessDetailsAndLeadingZeros() {
        JSONObject context = new JSONObject().put("produceDate", "2026-10-13")
            .put("productName", "溴氰虫酰胺").put("batchNo", "0001").put("lineName", "一号线");
        JSONObject identity = new JSONObject().put("enterpriseName", "测试农化有限公司").put("username", "001");
        String name = ProductionExportName.create(context, identity, "12345678-abcd", 1791850000000L);
        assertTrue(name.startsWith("测试农化有限公司_2026-10-13_溴氰虫酰胺_0001_一号线_工号001_"));
        assertTrue(name.endsWith("_12345678.txt"));
    }

    @Test public void handlesLongUnicodeAndInvalidFilenameCharacters() {
        String longName = "中文😀".repeat(100);
        JSONObject context = new JSONObject().put("produceDate", "2026/10/13")
            .put("productName", longName).put("batchNo", "A\\B:*?\"<>|\n.").put("lineName", longName);
        JSONObject identity = new JSONObject().put("enterpriseName", longName).put("username", longName);
        String name = ProductionExportName.create(context, identity, "12345678-abcd", 1791850000000L);
        assertTrue(name.getBytes(StandardCharsets.UTF_8).length < 255);
        assertFalse(name.matches("(?s).*[\\\\/:*?\"<>|\\p{Cntrl}].*"));
        assertEquals(name, new String(name.getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8));
    }

    @Test public void distinguishesRunsAndMissingMetadata() {
        String first = ProductionExportName.create(new JSONObject(), new JSONObject(), "11111111", 1791850000000L);
        String second = ProductionExportName.create(new JSONObject(), new JSONObject(), "22222222", 1791850000000L);
        assertTrue(first.contains("生产线待确认"));
        assertNotEquals(first, second);
    }
}
