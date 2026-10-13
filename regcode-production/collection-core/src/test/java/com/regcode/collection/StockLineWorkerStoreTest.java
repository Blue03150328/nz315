package com.regcode.collection;
import org.json.*;import org.junit.Test;import static org.junit.Assert.*;
public class StockLineWorkerStoreTest {
 static final String A="00000000000000000000000000000001",B="10000000000000000000000000000002",C="10000000000000000000000000000003";
 static JSONObject context(int product){return new JSONObject().put("mode","production").put("lineWorkflow",true).put("stockWorkflow",true).put("taskId",9).put("productId",product).put("batchNo","B"+product).put("produceDate","2026-10-13").put("expireDate","2027-10-13");}
 static WorkerStore ready(QueueStoreTest.Jdbc db)throws Exception{
  WorkerStore w=new WorkerStore(db);String id="stock-cache";
  w.stage(id,"products",new JSONArray().put(new JSONObject().put("id",1).put("code_head","00000000000")).put(new JSONObject().put("id",2).put("code_head","10000000000")));
  w.stage(id,"pools",new JSONArray().put(new JSONObject().put("id","task-9").put("task_id",9).put("product_id",JSONObject.NULL).put("task_name","工作任务").put("line_name","二号线").put("memberIds",new JSONArray().put(1))));
  JSONArray codes=new JSONArray();for(int i=0;i<3;i++)codes.put(new JSONObject().put("pool_id","stock:"+(i==0?1:2)).put("product_id",i==0?1:2).put("code",new String[]{A,B,C}[i]).put("state","reserved").put("owner_kind",i==2?"legacy":JSONObject.NULL).put("owner_id",i==2?"77":JSONObject.NULL));
  w.stage(id,"codes",codes);w.commitCache(new JSONObject().put("id",id).put("stockVersion",2).put("expiresAt",Long.MAX_VALUE).put("products",2).put("pools",1).put("codes",3));return w;
 }
 @Test public void anyStockedProductCanUseSameLineWithoutAllocatingFile()throws Exception{try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){
  WorkerStore w=ready(db);String first=w.start(context(1),WorkerStoreTest.profile(1),1).getString("id");assertEquals("valid",w.capture(A,WorkerStoreTest.profile(1),2).getString("kind"));w.finish(1);
  w.start(context(2),WorkerStoreTest.profile(1),3);assertEquals("二号线",w.currentRun().getJSONObject("context").getString("lineName"));assertEquals("valid",w.capture(B,WorkerStoreTest.profile(1),4).getString("kind"));assertEquals("duplicate",w.capture("half?code="+B,WorkerStoreTest.profile(1),5).getString("kind"));assertEquals("invalid",w.capture(A,WorkerStoreTest.profile(1),6).getString("kind"));assertEquals("invalid",w.capture(C,WorkerStoreTest.profile(1),7).getString("kind"));assertEquals(1,w.productionExport(first,1).getJSONObject(0).getJSONObject("run").getJSONObject("context").getInt("productId"));
 }}
 @Test public void uncachedProductAndUnassignedWorkerCannotStart()throws Exception{try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){WorkerStore w=ready(db);assertThrows(Exception.class,()->w.start(context(3),WorkerStoreTest.profile(1),1));assertThrows(Exception.class,()->w.start(context(1),WorkerStoreTest.profile(2),1));assertFalse(w.hasUnconfirmedWork());}}
 @Test public void generatedCodeNotInInventorySavesOfflineAndRestoresWithOriginalUuid()throws Exception{try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){
  WorkerStore w=ready(db);String raw="broken?anything=00000000000000000000000000000999";String run=w.start(context(1),WorkerStoreTest.profile(1),1).getString("id");
  assertTrue(db.rows("SELECT code FROM ww_allowed WHERE run_id=?",run).isEmpty());JSONObject event=w.capture(raw,WorkerStoreTest.profile(1),2);assertEquals("valid",event.getString("kind"));assertEquals(raw,event.getString("rawCode"));assertEquals("00000000000000000000000000000999",event.getString("code"));
  WorkerStore restored=new WorkerStore(db);assertEquals(run,restored.currentRun().getString("id"));assertEquals(event.getString("eventId"),restored.pending(restored.currentSession(1).getString("id"),20).getJSONObject(0).getString("eventId"));assertEquals("duplicate",restored.capture(event.getString("code"),WorkerStoreTest.profile(1),3).getString("kind"));
 }}
 @Test public void invalidNewCodeDoesNotCountButKeepsRawReason()throws Exception{try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){
  WorkerStore w=ready(db);w.start(context(1),WorkerStoreTest.profile(1),1);for(String raw:new String[]{B,"123",A+" "+B}){JSONObject e=w.capture(raw,WorkerStoreTest.profile(1),2);assertEquals("invalid",e.getString("kind"));assertEquals(raw,e.getString("rawCode"));assertFalse(e.getString("reason").isEmpty());}assertTrue(db.rows("SELECT event_id FROM ww_line_usage").isEmpty());
 }}
 @Test public void existingStockRunCanContinueNewCodesWithoutReplacingSessions()throws Exception{try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){
  WorkerStore w=ready(db);JSONObject r=w.start(context(1),WorkerStoreTest.profile(1),1),old=r.getJSONObject("context");old.remove("codeHead");db.exec("UPDATE ww_run SET context=? WHERE id=?",old.toString(),r.getString("id"));String session=w.currentSession(1).getString("id");
  assertEquals("valid",w.capture("00000000000000000000000000000777",WorkerStoreTest.profile(1),2).getString("kind"));assertEquals(session,w.currentSession(1).getString("id"));assertEquals("00000000000",w.currentRun().getJSONObject("context").getString("codeHead"));
 }}
 @Test public void oldInventoryAndInterruptedUpgradeDoNotFreezeEmptyCodeScope()throws Exception{try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){WorkerStore w=ready(db);JSONObject cache=new JSONObject(w.meta("cache","{}")).put("stockVersion",0);w.putMeta("cache",cache.toString());assertThrows(Exception.class,()->w.start(context(2),WorkerStoreTest.profile(1),1));w.stage("partial","products",new JSONArray().put(new JSONObject().put("id",2)));assertThrows(Exception.class,()->w.commitCache(new JSONObject().put("id","partial").put("stockVersion",2).put("expiresAt",Long.MAX_VALUE).put("products",2).put("pools",1).put("codes",3)));assertEquals("stock-cache",new JSONObject(w.meta("cache","{}")).getString("id"));assertFalse(w.hasUnconfirmedWork());}}
}
