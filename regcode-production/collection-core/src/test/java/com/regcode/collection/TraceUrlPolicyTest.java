package com.regcode.collection;
import org.junit.Test;
import static org.junit.Assert.*;

public class TraceUrlPolicyTest {
    private static final String CODE = "12001041001000000000000000000001";
    @Test public void officialUrlsNeedNoDatabaseOrCache() {
        for (String url : new String[]{"https://www.nz315.cn/trace?code="+CODE,"https://nz315.cn/trace?from=scan&code="+CODE,"HTTP://WWW.NZ315.CN:80/trace?code="+CODE,"https://www.nz315.cn:443/trace?code="+CODE}) {
            assertEquals(CODE, TraceUrlPolicy.codeOf(url, TraceUrlPolicy.DEFAULT_BASE));
            assertEquals("internal", TraceUrlPolicy.classification(url, TraceUrlPolicy.DEFAULT_BASE));
        }
    }
    @Test public void similarDomainsAndAmbiguousLinksAreNotInternal() {
        for (String url : new String[]{"https://www.nz315.cn.evil.example/trace?code="+CODE,"https://www.nz315.cn/other?code="+CODE,"https://www.nz315.cn:3100/trace?code="+CODE,"https://www.nz315.cn/trace?code="+CODE+"&code="+CODE,"https://user@www.nz315.cn/trace?code="+CODE,"https://www.nz315.cn/trace?code="+CODE+"#extra","https://www.nz315.cn/trace?code="+CODE+"0"}) assertNull(TraceUrlPolicy.codeOf(url, TraceUrlPolicy.DEFAULT_BASE));
        assertEquals("unparsed", TraceUrlPolicy.classification(CODE, TraceUrlPolicy.DEFAULT_BASE));
    }
    @Test public void configuredEndpointRequiresSameOriginAndPath() {
        String base="http://127.0.0.1:3100/trace?code=";
        assertEquals(CODE,TraceUrlPolicy.codeOf(base+CODE,base));
        assertNull(TraceUrlPolicy.codeOf("http://127.0.0.1:3101/trace?code="+CODE,base));
        assertNull(TraceUrlPolicy.codeOf("http://localhost:3100/trace?code="+CODE,base));
    }
    @Test public void normalizedOrEmptySpecialPartsAreNotInternal() {
        for (String url : new String[]{"https://@www.nz315.cn/trace?code="+CODE,"https://www.nz315.cn/trace?code="+CODE+"#","https://www.nz315.cn/other/../trace?code="+CODE,"https://www.nz315.cn/other/%2e%2e/trace?code="+CODE,"https://www.nz315.cn\\trace?code="+CODE,"https://www.nz315.cn/trace?code="+CODE+"&bad=%zz"}) assertNull(TraceUrlPolicy.codeOf(url,TraceUrlPolicy.DEFAULT_BASE));
    }
}
