package com.regcode.collection;
import org.json.*;
import org.junit.Test;
import java.io.ByteArrayOutputStream;
import java.nio.file.*;
import static org.junit.Assert.*;

public class WorkerRecordsTest {
 private JSONObject profile(int id,int factory)throws Exception{
  JSONObject p=WorkerStoreTest.profile(id);p.getJSONObject("identity").put("enterpriseId",factory).put("username","00"+id).put("deviceName","设备甲");return p;
 }
 @Test public void missingRoleAndOrdinaryWorkerNeverReceiveLeaderAccess()throws Exception{
  JSONObject i=new JSONObject().put("enterpriseId",1);assertFalse(CaptureAccess.leader(i));assertThrows(Exception.class,()->CaptureAccess.requireLeader(i));
  i.put("role","production_operator");assertThrows(Exception.class,()->CaptureAccess.requireLeader(i));i.put("role","line_leader");assertEquals(1,CaptureAccess.requireLeader(i));assertThrows(Exception.class,()->CaptureAccess.sameFactory(i,2));
 }
 @Test public void employeeSessionsRemainSeparateAndFactoryScopeIsCheckedBeforeExport()throws Exception{
  try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){
   WorkerStore w=new WorkerStore(db);JSONObject a=profile(1,4),b=profile(2,4),foreign=profile(3,5),context=new JSONObject().put("mode","external");
   w.start(context,a,1);w.capture("https://vendor.test/?full=first",a,2);w.handover(1);w.start(context,b,3);w.capture("https://vendor.test/?full=second",b,4);w.finish(2);
   w.start(context,foreign,5);w.capture("foreign-secret",foreign,6);w.finish(3);
   JSONArray rows=w.records(4);assertEquals(2,rows.length());assertEquals(2,rows.getJSONObject(0).getJSONObject("identity").getInt("id"));assertEquals(1,rows.getJSONObject(1).getJSONObject("identity").getInt("id"));
   String id=rows.getJSONObject(1).getString("id");assertEquals("https://vendor.test/?full=first\r\n",w.recordExport(id,4).getString("text"));assertThrows(Exception.class,()->w.recordDetail(id,5,1,""));assertThrows(Exception.class,()->w.recordExport(id,5));
   ByteArrayOutputStream out=new ByteArrayOutputStream();w.factoryBackup(out,4,88);JSONObject backup=new JSONObject(out.toString("UTF-8"));assertEquals(2,backup.getJSONArray("events").length());assertEquals(88,backup.getInt("exportActorId"));assertFalse(out.toString("UTF-8").contains("foreign-secret"));assertFalse(out.toString("UTF-8").contains("password"));
  }
 }
 @Test public void stateChangesPersistOnceAndActionsSurviveRestartWithOriginalIds()throws Exception{
  Path path=Files.createTempFile("worker-actions-",".db");String sid,event;
  try{
   try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(path.toString())){WorkerStore w=new WorkerStore(db);JSONObject p=profile(1,4);w.start(new JSONObject().put("mode","external"),p,1000);w.action(1,false,1001);w.action(1,true,1002);w.action(1,true,1003);w.action(1,false,1004);w.action(1,false,1005);w.action(1,true,1006);w.capture("original raw",p,1007);w.finish(1);sid=w.sessions().getJSONObject(0).getString("id");JSONArray list=w.pendingActions(sid);assertEquals(4,list.length());assertEquals("start",list.getJSONObject(0).getString("kind"));assertEquals("pause",list.getJSONObject(1).getString("kind"));assertEquals("resume",list.getJSONObject(2).getString("kind"));assertEquals("end",list.getJSONObject(3).getString("kind"));event=list.getJSONObject(0).getString("eventId");}
   try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(path.toString())){WorkerStore w=new WorkerStore(db);assertEquals(event,w.pendingActions(sid).getJSONObject(0).getString("eventId"));assertEquals(1,w.pending(sid,20).length());assertEquals(4,w.lastActionSequence(sid));JSONObject detail=w.recordDetail(sid,4,1,"");assertEquals("original raw",detail.getJSONArray("events").getJSONObject(0).getString("rawCode"));assertEquals(4,detail.getJSONArray("actions").length());}
  }finally{Files.deleteIfExists(path);}
 }
 @Test public void invalidActionReceiptRollsBackWholeAcknowledgement()throws Exception{
  try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){WorkerStore w=new WorkerStore(db);JSONObject p=profile(1,4);w.start(new JSONObject().put("mode","external"),p,1);w.action(1,true,2);w.action(1,false,3);String id=w.sessions().getJSONObject(0).getString("id");JSONArray actions=w.pendingActions(id),bad=new JSONArray(actions.toString());bad.getJSONObject(1).put("sequence",99);assertThrows(Exception.class,()->w.acknowledgeActions(id,new JSONObject().put("sessionId",id).put("receipts",bad)));assertEquals(2,w.pendingActions(id).length());w.acknowledgeActions(id,new JSONObject().put("sessionId",id).put("receipts",actions));w.acknowledgeActions(id,new JSONObject().put("sessionId",id).put("receipts",actions));assertEquals(0,w.pendingActions(id).length());assertEquals(2,w.lastActionSequence(id));}
 }
 @Test public void preUpgradeClosingQueueKeepsLegacyCompletionWithoutInventedActions()throws Exception{
  try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){WorkerStore w=new WorkerStore(db);JSONObject p=profile(1,4);w.start(new JSONObject().put("mode","external"),p,1);String old=w.sessions().getJSONObject(0).getString("id");db.exec("UPDATE ww_session SET state='closing',final_seq=0 WHERE id=?",old);JSONObject completed=w.completion(old);assertFalse(completed.has("lastActionSequence"));assertEquals(0,completed.getInt("lastSequence"));assertEquals(0,w.pendingActions(old).length());}
 }
}
