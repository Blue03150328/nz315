package com.regcode.collection;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import static org.junit.Assert.*;

/** 外部采集使用隔离SQLite验证原文、归属、断网边界及收据，不接触真实企业数据。 */
public class ExternalQueueStoreTest {
    private static final String SERVER="https://www.nz315.cn",RAW="https://外站.example/?code=00001&value=%2f&x=甲😀";
    static JSONObject context(long enterprise,long device,String line) throws Exception {return new JSONObject().put("device",new JSONObject().put("enterprise_id",enterprise).put("id",device).put("line_name",line).put("enterprise_name","厂家"));}
    static ExternalQueueStore opened(QueueStoreTest.Jdbc db) throws Exception {ExternalQueueStore store=new ExternalQueueStore(db);store.trust(SERVER,context(1,2,"一号线"));store.prepare(SERVER,"001号工人");return store;}
    static JSONObject receipt(JSONObject event,String state) throws Exception {return new JSONObject().put("eventId",event.getString("eventId")).put("sequence",event.getInt("sequence")).put("state",state).put("reason","");}
    static void ack(ExternalQueueStore store,String id,JSONObject...receipts) throws Exception {store.acknowledge(id,new JSONObject().put("batchId",id).put("ok",true).put("receipts",new JSONArray(Arrays.asList(receipts))));}
    static JSONObject done(String id,int sequence,int accepted,int duplicates) throws Exception {return new JSONObject().put("ok",true).put("batchId",id).put("state","completed").put("lastSequence",sequence).put("acceptedCount",accepted).put("duplicateCount",duplicates).put("rejectedCount",0);}
    @Test public void keepsWholeOriginalUrlZerosEncodingAndWhitespace() throws Exception {
        try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){ExternalQueueStore store=opened(db);for(String raw:new String[]{RAW,"000001"," "+RAW+" ",RAW.replace("%2f","/")}){JSONObject e=store.capture(raw);assertEquals(raw,e.getString("rawCode"));assertEquals("valid",e.getString("localKind"));}assertEquals("duplicate",store.capture(RAW).getString("localKind"));assertEquals(RAW,store.pending(store.openBatch().getString("id"),20).getJSONObject(0).getString("rawCode"));}
    }
    @Test public void validationUsesUtf8BytesAndRejectsLineBreaksNulAndBrokenCharacters() throws Exception {
        try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){ExternalQueueStore store=opened(db);for(String raw:new String[]{""," ","a\r","a\nb","a\0b","甲".repeat(2731),"a\uD800","a\uDC00"})assertThrows(Exception.class,()->store.capture(raw));assertNull(store.openBatch());assertEquals("😀".repeat(2048),store.capture("😀".repeat(2048)).getString("rawCode"));}
    }
    @Test public void finishCreatesNoEmptyBatchAndNextScanStartsAtOne() throws Exception {
        try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){ExternalQueueStore store=opened(db);assertNull(store.finish());assertNull(store.nextBatch());JSONObject first=store.capture(RAW),batch=store.finish();assertEquals(1,batch.getInt("final_seq"));assertNull(store.finish());JSONObject next=store.capture("00002");assertEquals(1,next.getInt("sequence"));assertNotEquals(batch.getString("id"),store.openBatch().getString("id"));assertNotEquals(first.getString("eventId"),next.getString("eventId"));}
    }
    @Test public void localDuplicatesAcrossBatchesStayInAuditAndSeparateFromCloudCounts() throws Exception {
        try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){ExternalQueueStore store=opened(db);JSONObject first=store.capture(RAW);String id=store.finish().getString("id");ack(store,id,receipt(first,"accepted"));store.completed(id,done(id,1,1,0));store.prepare(SERVER,"002号工人");JSONObject duplicate=store.capture(RAW);assertEquals("duplicate",duplicate.getString("localKind"));assertEquals(0,store.snapshot().getJSONObject("counts").getInt("collected"));assertEquals(0,store.snapshot().getJSONObject("counts").getInt("duplicates"));ack(store,store.openBatch().getString("id"),receipt(duplicate,"duplicate"));assertEquals(1,store.snapshot().getJSONObject("counts").getInt("duplicates"));assertEquals(2,store.backup().getJSONArray("events").length());}
    }
    @Test public void deDuplicationScopeIsEnterpriseRatherThanDeviceOrLine() throws Exception {
        try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){ExternalQueueStore store=opened(db);JSONObject first=store.capture(RAW);String id=store.finish().getString("id");ack(store,id,receipt(first,"accepted"));store.completed(id,done(id,1,1,0));store.trust(SERVER,context(1,3,"二号线"));store.prepare(SERVER,"002");JSONObject duplicate=store.capture(RAW);assertEquals("duplicate",duplicate.getString("localKind"));id=store.finish().getString("id");ack(store,id,receipt(duplicate,"duplicate"));store.completed(id,done(id,1,0,1));store.trust(SERVER,context(9,3,"二号线"));store.prepare(SERVER,"002");assertEquals("valid",store.capture(RAW).getString("localKind"));}
    }
    @Test public void workerCannotChangeInsideBatchAndNeedsNoProductBeforeScan() throws Exception {
        try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){ExternalQueueStore store=opened(db);assertThrows(Exception.class,()->store.prepare(SERVER,""));assertThrows(Exception.class,()->store.prepare(SERVER,"x".repeat(65)));store.capture(RAW);assertThrows(Exception.class,()->store.prepare(SERVER,"其他工号"));store.finish();store.prepare(SERVER,"其他工号");store.capture("下批");assertEquals("其他工号",store.openBatch().getString("worker_no"));}
    }
    @Test public void workerWhitespaceMatchesServerWithoutTrimmingRawCodes() throws Exception {
        try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){ExternalQueueStore store=opened(db);assertThrows(Exception.class,()->store.prepare(SERVER,"　\u00a0"));assertThrows(Exception.class,()->store.capture("　\u00a0"));store.prepare(SERVER,"　\u00a0 001　");JSONObject event=store.capture("　0001　");assertEquals("001",store.openBatch().getString("worker_no"));assertEquals("　0001　",event.getString("rawCode"));}
    }
    @Test public void trustChangesCannotReassignOfflineBatchesOrStaleSelection() throws Exception {
        try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){ExternalQueueStore store=opened(db);store.trust(SERVER,context(2,2,"一号线"));assertThrows(Exception.class,()->store.capture(RAW));assertNull(store.openBatch());store.prepare(SERVER,"002");store.capture(RAW);store.trust(SERVER,context(2,2,"二号线"));assertFalse(store.compatible(SERVER));assertThrows(Exception.class,()->store.prepare(SERVER,"002"));assertThrows(Exception.class,()->store.capture("新码"));assertEquals(1,store.backup().getJSONArray("events").length());}
    }
    @Test public void lostResponseUsesSameIdsAndSequencesAfterRestart() throws Exception {
        Path file=Files.createTempFile("external-queue-",".sqlite");String id,event;
        try{try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(file.toString())){ExternalQueueStore store=opened(db);event=store.capture(RAW).getString("eventId");id=store.finish().getString("id");store.capture("另一批");}
            try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(file.toString())){ExternalQueueStore store=new ExternalQueueStore(db);assertEquals(id,store.nextBatch().getString("id"));assertEquals(event,store.pending(id,20).getJSONObject(0).getString("eventId"));assertEquals(1,store.nextBatch().getInt("final_seq"));assertEquals(2,store.backup().getJSONArray("batches").length());assertEquals(1,store.openBatch().getInt("next_seq")-1);}}
        finally{Files.deleteIfExists(file);}
    }
    @Test public void failedTransactionRollsBackBatchEventAndSequenceTogether() throws Exception {
        try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){ExternalQueueStore store=opened(db);db.exec("CREATE TRIGGER fault BEFORE UPDATE OF next_seq ON external_batch BEGIN SELECT RAISE(ABORT,'fault');END");assertThrows(Exception.class,()->store.capture(RAW));assertNull(store.openBatch());assertEquals(0,store.backup().getJSONArray("events").length());db.exec("DROP TRIGGER fault");assertEquals(1,store.capture(RAW).getInt("sequence"));}
    }
    @Test public void partialReceiptsAreAtomicAndConflictingReceiptsNeverOverwrite() throws Exception {
        try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){ExternalQueueStore store=opened(db);JSONObject a=store.capture(RAW),b=store.capture("b");String id=store.openBatch().getString("id");assertThrows(Exception.class,()->ack(store,id,receipt(a,"accepted"),receipt(b,"accepted").put("sequence",99)));assertEquals(2,store.pending(id,20).length());ack(store,id,receipt(a,"accepted"));assertEquals(1,store.pending(id,20).length());assertThrows(Exception.class,()->ack(store,id,receipt(a,"duplicate")));assertEquals(1,store.snapshot().getJSONObject("counts").getInt("accepted"));}
    }
    @Test public void completionRequiresExactFrozenRangeAndAllConsistentCounts() throws Exception {
        try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){ExternalQueueStore store=opened(db);JSONObject event=store.capture(RAW);String id=store.finish().getString("id");JSONObject completed=done(id,1,1,0);assertThrows(Exception.class,()->store.completed(id,completed));ack(store,id,receipt(event,"accepted"));assertThrows(Exception.class,()->store.completed(id,done(id,2,1,0)));assertThrows(Exception.class,()->store.completed(id,done(id,1,0,1)));store.completed(id,completed);store.completed(id,completed);assertNull(store.nextBatch());assertEquals(1,store.backup().getJSONArray("events").length());}
    }
    @Test public void blockedStateSurvivesRestartUntilTrustedVerification() throws Exception {
        try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){ExternalQueueStore store=opened(db);store.capture(RAW);store.block();assertThrows(Exception.class,()->store.capture("新码"));ExternalQueueStore restarted=new ExternalQueueStore(db);assertTrue(restarted.blocked());assertEquals(1,restarted.backup().getJSONArray("events").length());restarted.trust(SERVER,context(1,2,"一号线"));assertFalse(restarted.blocked());assertEquals(2,restarted.capture("新码").getInt("sequence"));}
    }
    @Test public void manyCodesHaveBoundedSegmentsAndFullPagedBackup() throws Exception {
        try(QueueStoreTest.Jdbc db=new QueueStoreTest.Jdbc(":memory:")){ExternalQueueStore store=opened(db);for(int i=0;i<5001;i++)store.capture("https://example.com/?code=000"+i);String id=store.finish().getString("id");assertEquals(20,store.pending(id,99).length());ByteArrayOutputStream bytes=new ByteArrayOutputStream();store.writeBackup(bytes);JSONObject backup=new JSONObject(bytes.toString(StandardCharsets.UTF_8));assertEquals(5001,backup.getJSONArray("events").length());assertEquals(5001,backup.getJSONArray("batches").getJSONObject(0).getInt("final_seq"));assertFalse(bytes.toString(StandardCharsets.UTF_8).contains("credential"));}
    }
    @Test public void fullBackupIncludesBothQueuesWithNoDeviceCredential() throws Exception {
        try(QueueStoreTest.Jdbc internalDb=new QueueStoreTest.Jdbc(":memory:");QueueStoreTest.Jdbc externalDb=new QueueStoreTest.Jdbc(":memory:")){QueueStore internal=QueueStoreTest.opened(internalDb,2);internal.capture(QueueStoreTest.A);ExternalQueueStore external=opened(externalDb);external.capture(RAW);ByteArrayOutputStream bytes=new ByteArrayOutputStream();internal.writeBackup(bytes,external);JSONObject result=new JSONObject(bytes.toString(StandardCharsets.UTF_8));assertEquals(3,result.getInt("version"));assertEquals(1,result.getJSONArray("events").length());assertEquals(RAW,result.getJSONObject("external").getJSONArray("events").getJSONObject(0).getString("raw_code"));assertFalse(bytes.toString(StandardCharsets.UTF_8).contains("credential"));}
    }
}
