package com.regcode.collection;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;

public class UnifiedWorkerStoreTest {
 static WorkerStore ready(QueueStoreTest.Jdbc db)throws Exception{
  WorkerStore w=StockLineWorkerStoreTest.ready(db);JSONObject cache=new JSONObject(w.meta("cache","{}")).put("productionScanVersion",1);w.putMeta("cache",cache.toString());return w;
 }
 @Test public void mixedLabelsKeepOneRunSeparateCountsAndOriginalPayloadAfterRestart()throws Exception{
  try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){
   WorkerStore w=ready(db);JSONObject profile=WorkerStoreTest.profile(1);JSONObject run=w.start(StockLineWorkerStoreTest.context(1).put("unifiedScan",true),profile,1);
   JSONObject internal=w.capture("https://nz315.cn/trace?code="+StockLineWorkerStoreTest.A,profile,2);
   String raw="https://label.example/view?code="+StockLineWorkerStoreTest.A+"&site=nz315.cn";
   JSONObject external=w.capture(raw,profile,3);assertEquals("valid",external.getString("kind"));assertTrue(external.isNull("code"));assertEquals("external",external.getString("classification"));
   assertEquals("duplicate",w.capture(raw,profile,4).getString("kind"));
   assertEquals("invalid",w.capture("https://nz315.cn/wrong?code="+StockLineWorkerStoreTest.A,profile,5).getString("kind"));
   assertEquals("invalid",w.capture("无法识别",profile,6).getString("kind"));
   JSONObject counts=w.snapshot(1).getJSONObject("counts");assertEquals(2,counts.getInt("collected"));assertEquals(1,counts.getInt("internal"));assertEquals(1,counts.getInt("external"));
   String session=w.currentSession(1).getString("id"),payload=w.pending(session,20).toString();WorkerStore restored=new WorkerStore(db);assertEquals(run.getString("id"),restored.currentRun().getString("id"));assertEquals(payload,restored.pending(session,20).toString());
   assertEquals(internal.getString("eventId"),restored.pending(session,20).getJSONObject(0).getString("eventId"));assertEquals(raw,restored.pending(session,20).getJSONObject(1).getString("rawCode"));
   restored.finish(1);assertEquals(5,restored.productionExport(run.getString("id"),1).getJSONObject(0).getJSONArray("events").length());
  }
 }
 @Test public void strictPolicyRejectsBadInternalLinksAndKeepsForeignLabelsExternal(){
  String code=StockLineWorkerStoreTest.A;
  for(String raw:new String[]{"broken?code="+code,"https://nz315.cn/trace?code=123","https://nz315.cn:3100/trace?code="+code,"https://nz315.cn/other?code="+code,"https://nz315.cn/x/../trace?code="+code,code+"\n","http://third.example/"})assertEquals(raw,"unparsed",TraceUrlPolicy.productionClassification(raw,TraceUrlPolicy.DEFAULT_BASE));
  assertEquals("external",TraceUrlPolicy.productionClassification("https://nz315.cn.evil.example/trace?code="+code,TraceUrlPolicy.DEFAULT_BASE));
 }
 @Test public void newerAppCannotStartUnifiedRunAgainstOlderWebsite()throws Exception{
  try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){
   WorkerStore w=StockLineWorkerStoreTest.ready(db);assertThrows(Exception.class,()->w.start(StockLineWorkerStoreTest.context(1).put("unifiedScan",true),WorkerStoreTest.profile(1),1));assertFalse(w.hasUnconfirmedWork());
  }
 }
}
