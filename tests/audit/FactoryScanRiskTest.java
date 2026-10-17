package com.regcode.collection;

import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;

/** 风险特征测试：断言当前可复现行为，不代表期望的业务规则。 */
public class FactoryScanRiskTest {
 static final String RAW="https://vendor.example/trace?id=0001";
 static WorkerStore ready(QueueStoreTest.Jdbc db)throws Exception{return UnifiedWorkerStoreTest.ready(db);}
 static JSONObject context(){return StockLineWorkerStoreTest.context(1).put("unifiedScan",true);}
 static JSONObject profile(){return WorkerStoreTest.profile(1);}
 static JSONObject ack(JSONObject event,String state){return new JSONObject().put("eventId",event.getString("eventId")).put("sequence",event.getInt("sequence")).put("code",event.get("code")).put("state",state).put("classification",event.optString("classification")).put("reason","isolated test");}

 @Test public void equivalentExternalUrlVariantsCountSeparately()throws Exception{
  try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){
   WorkerStore w=ready(db);w.start(context(),profile(),1);
   for(String raw:new String[]{RAW,"https://VENDOR.example/trace?id=0001","http://vendor.example/trace?id=0001",RAW+"&utm_source=scan"," "+RAW+" "})assertEquals("valid",w.capture(raw,profile(),2).getString("kind"));
   assertEquals(5,w.snapshot(1).getJSONObject("counts").getInt("external"));assertEquals("duplicate",w.capture(RAW,profile(),3).getString("kind"));
  }
 }
 @Test public void unrelatedWebLinksAreAcceptedUnderSelectedProduct()throws Exception{
  try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){
   WorkerStore w=ready(db);w.start(context(),profile(),1);
   for(String raw:new String[]{"https://ads.example/campaign?x=1","https://logistics.example/track?id=99","https://other-brand.example/product/123"})assertEquals("valid",w.capture(raw,profile(),2).getString("kind"));
   assertEquals(1,w.currentRun().getJSONObject("context").getInt("productId"));assertEquals(3,w.snapshot(1).getJSONObject("counts").getInt("collected"));
  }
 }
 @Test public void onePackageWithInternalAndExternalLabelsCountsTwice()throws Exception{
  try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){
   WorkerStore w=ready(db);w.start(context(),profile(),1);w.capture(StockLineWorkerStoreTest.A,profile(),2);w.capture(RAW,profile(),3);
   JSONObject c=w.snapshot(1).getJSONObject("counts");assertEquals(2,c.getInt("collected"));assertEquals(1,c.getInt("internal"));assertEquals(1,c.getInt("external"));
  }
 }
 @Test public void broadcastTerminatorMarksOtherwiseGoodLabelsInvalid()throws Exception{
  try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){
   WorkerStore w=ready(db);w.start(context(),profile(),1);
   for(String raw:new String[]{StockLineWorkerStoreTest.A+"\r\n",RAW+"\r\n"}){JSONObject e=w.capture(raw,profile(),2);assertEquals("invalid",e.getString("kind"));assertEquals(raw,e.getString("rawCode"));}
   assertEquals(0,w.snapshot(1).getJSONObject("counts").getInt("collected"));
  }
 }
 @Test public void vendorBareSerialAndFragmentUrlAreNotAccepted()throws Exception{
  try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){
   WorkerStore w=ready(db);w.start(context(),profile(),1);
   for(String raw:new String[]{"VENDOR000123456789","12345678901234567890",RAW+"#detail","vendor.example/trace?id=1","https://vendor.example/"})assertEquals(raw,"invalid",w.capture(raw,profile(),2).getString("kind"));
   JSONObject e=w.capture("99999999999999999999999999999999",profile(),3);assertEquals("internal",e.getString("classification"));assertEquals("invalid",e.getString("kind"));
  }
 }
 @Test public void twoOfflineDevicesBothInitiallyCountSameLabel()throws Exception{
  try(QueueStoreTest.Jdbc da=new QueueStoreTest.Jdbc(":memory:");QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){
   WorkerStore a=ready(da),b=ready(db);a.start(context(),profile(),1);b.start(context(),profile(),1);
   JSONObject ea=a.capture(RAW,profile(),2),eb=b.capture(RAW,profile(),2);assertEquals("valid",ea.getString("kind"));assertEquals("valid",eb.getString("kind"));
   a.acknowledge(a.currentSession(1).getString("id"),new JSONObject().put("sessionId",a.currentSession(1).getString("id")).put("receipts",new JSONArray().put(ack(ea,"saved"))));
   b.acknowledge(b.currentSession(1).getString("id"),new JSONObject().put("sessionId",b.currentSession(1).getString("id")).put("receipts",new JSONArray().put(ack(eb,"duplicate"))));
   assertEquals(1,a.snapshot(1).getJSONObject("counts").getInt("collected"));assertEquals(0,b.snapshot(1).getJSONObject("counts").getInt("collected"));
  }
 }
 @Test public void rejectedInternalScanStillBlocksSameTaskLocalRetry()throws Exception{
  try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){
   WorkerStore w=ready(db);w.start(context(),profile(),1);JSONObject e=w.capture(StockLineWorkerStoreTest.A,profile(),2);String session=w.currentSession(1).getString("id");
   w.acknowledge(session,new JSONObject().put("sessionId",session).put("receipts",new JSONArray().put(ack(e,"exception"))));
   assertEquals(0,w.snapshot(1).getJSONObject("counts").getInt("collected"));
   assertEquals("duplicate",w.capture(StockLineWorkerStoreTest.A,profile(),3).getString("kind"));
   WorkerStore restored=new WorkerStore(db);assertEquals("duplicate",restored.capture(StockLineWorkerStoreTest.A,profile(),4).getString("kind"));
  }
 }
 @Test public void uncachedNewInternalCodeCanPassAnotherBrandWithSameHead()throws Exception{
  try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){
   WorkerStore w=new WorkerStore(db);String cache="shared-head";
   w.stage(cache,"products",new JSONArray().put(new JSONObject().put("id",1).put("name","Brand A").put("code_head","00000000000")).put(new JSONObject().put("id",2).put("name","Brand B").put("code_head","00000000000")));
   w.stage(cache,"pools",new JSONArray().put(new JSONObject().put("id","task-9").put("task_id",9).put("task_name","test").put("line_name","test")));
   w.stage(cache,"codes",new JSONArray());w.commitCache(new JSONObject().put("id",cache).put("stockVersion",2).put("productionScanVersion",1).put("expiresAt",Long.MAX_VALUE).put("products",2).put("pools",1).put("codes",0));
   w.start(StockLineWorkerStoreTest.context(2).put("unifiedScan",true),profile(),1);
   assertEquals("valid",w.capture(StockLineWorkerStoreTest.A,profile(),2).getString("kind"));assertEquals(2,w.currentRun().getJSONObject("context").getInt("productId"));
  }
 }
}
