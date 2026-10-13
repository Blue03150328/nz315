package com.regcode.collection;

import org.junit.Test;
import org.json.JSONObject;
import org.json.JSONArray;
import java.sql.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.Assert.*;

public class QueueStoreTest {
    static final String A="00000000000000000000000000000001",B="00000000000000000000000000000002";
    static class Jdbc implements QueueStore.Sql,AutoCloseable {
        final Connection conn;
        Jdbc(String path)throws Exception{conn=DriverManager.getConnection("jdbc:sqlite:"+path);exec("PRAGMA journal_mode=DELETE");exec("PRAGMA synchronous=FULL");}
        public void exec(String sql,Object...args)throws Exception{try(PreparedStatement p=conn.prepareStatement(sql)){for(int i=0;i<args.length;i++)p.setObject(i+1,args[i]);p.execute();}}
        public List<JSONObject> rows(String sql,Object...args)throws Exception{List<JSONObject> rows=new ArrayList<>();try(PreparedStatement p=conn.prepareStatement(sql)){for(int i=0;i<args.length;i++)p.setObject(i+1,args[i]);try(ResultSet r=p.executeQuery()){while(r.next()){JSONObject row=new JSONObject();for(int i=1;i<=r.getMetaData().getColumnCount();i++)row.put(r.getMetaData().getColumnName(i),r.getObject(i)==null?JSONObject.NULL:r.getObject(i));rows.add(row);}}}return rows;}
        public <T>T transaction(QueueStore.Work<T> work)throws Exception{conn.setAutoCommit(false);try{T value=work.run();conn.commit();return value;}catch(Exception e){conn.rollback();throw e;}finally{conn.setAutoCommit(true);}}
        public void close()throws Exception{conn.close();}
    }
    static QueueStore opened(Jdbc db,int count)throws Exception {
        QueueStore store=new QueueStore(db);JSONObject session=store.prepare("https://www.nz315.cn",1,new JSONObject().put("userId",2));
        JSONArray codes=new JSONArray();for(int i=1;i<=count;i++)codes.put(new JSONObject().put("code",String.format(Locale.ROOT,"%032d",i)).put("eligible",1));
        store.activate(new JSONObject().put("ok",true).put("state","active").put("sessionId",session.getString("id")).put("lastSequence",0).put("context",new JSONObject().put("taskId",1)).put("codes",codes));return store;
    }
    static JSONObject receipt(JSONObject e,String state)throws Exception {return new JSONObject().put("eventId",e.getString("eventId")).put("sequence",e.getInt("sequence")).put("code",e.get("code")).put("kind",e.getString("kind")).put("state",state).put("reason","");}
    static JSONObject envelope(QueueStore store,JSONObject...events)throws Exception{return new JSONObject().put("sessionId",store.current().getString("id")).put("uploadId",store.nextUpload().getString("id")).put("receipts",new JSONArray(Arrays.asList(events)));}
    static JSONObject uploadReceipt(QueueStore store,JSONObject upload,String state)throws Exception{return new JSONObject().put("ok",true).put("state",state).put("sessionId",store.current().getString("id")).put("uploadId",upload.getString("id")).put("firstSequence",upload.getInt("first_seq")).put("lastSequence",upload.get("last_seq"));}
    @Test public void urlDoesNotMatterButFullCodeMustBeUnique(){
        for(String input:new String[]{A,"?47="+A,"https://other/?i="+A,"半截网址?id="+A+"&","?a="+A+"&a="+A})assertEquals(A,QueueStore.codeOf(input));
        for(String input:new String[]{A+"9",A.substring(1),"?a="+A+"&b="+B,"abc"})assertNull(QueueStore.codeOf(input));
    }
    @Test public void duplicatesAndBadCodesPersistWithoutCounting()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){QueueStore s=opened(db,2);assertEquals("valid",s.capture("?i="+A).getString("kind"));assertEquals("duplicate",s.capture("?47="+A).getString("kind"));assertEquals("invalid",s.capture("http://broken?id=123").getString("kind"));assertEquals("invalid",s.capture(String.format("%032d",99)).getString("kind"));JSONObject c=s.snapshot().getJSONObject("counts");assertEquals(1,c.getInt("collected"));assertEquals(4,c.getInt("waiting"));assertEquals(1,c.getInt("duplicates"));assertEquals(2,c.getInt("rejected"));}
    }
    @Test public void faultRollsBackEventAndSequenceTogether()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){QueueStore s=opened(db,2);db.exec("CREATE TRIGGER fault BEFORE UPDATE OF next_seq ON session BEGIN SELECT RAISE(ABORT,'fault');END");assertThrows(Exception.class,()->s.capture(A));assertEquals(0,s.pending(50).length());assertEquals(0,db.rows("SELECT * FROM upload").size());assertEquals(1,s.current().getInt("next_seq"));db.exec("DROP TRIGGER fault");assertEquals(1,s.capture(A).getInt("sequence"));}
    }
    @Test public void receiptsMatchOriginalEventAndNeverDeleteHistory()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){QueueStore s=opened(db,2);JSONObject e=s.capture(A),r=receipt(e,"accepted");assertThrows(Exception.class,()->s.acknowledge(envelope(s,new JSONObject(r.toString()).put("code",B))));assertEquals(1,s.pending(20).length());s.acknowledge(envelope(s,r));s.acknowledge(envelope(s,r));assertEquals(0,s.pending(20).length());assertEquals(1,s.snapshot().getJSONObject("counts").getInt("accepted"));assertEquals(1,db.rows("SELECT * FROM event").size());}
    }
    @Test public void batchReceiptMismatchRollsBackAllAcknowledgements()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){QueueStore s=opened(db,2);JSONObject a=s.capture(A),b=s.capture(B);assertThrows(Exception.class,()->s.acknowledge(envelope(s,receipt(a,"accepted"),receipt(b,"accepted").put("sequence",99))));assertEquals(2,s.pending(20).length());}
    }
    @Test public void stopFreezesFinalSequenceAndRequiresAllReceipts()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){QueueStore s=opened(db,2);JSONObject e=s.capture(A);s.close(true);assertThrows(Exception.class,()->s.capture(B));JSONObject done=new JSONObject().put("ok",true).put("state","completed").put("sessionId",s.current().getString("id")).put("lastSequence",1);assertThrows(Exception.class,()->s.complete(done));s.acknowledge(envelope(s,receipt(e,"accepted")));assertThrows(Exception.class,()->s.complete(done));s.completeUpload(uploadReceipt(s,s.nextUpload(),"completed"));s.complete(done);assertNull(s.current());assertEquals(1,db.rows("SELECT * FROM event").size());}
    }
    @Test public void finishDefinesStableBatchesWithoutStoppingCaptureOrCreatingEmptyRows()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){
            QueueStore s=opened(db,45);assertNull(s.finishUpload());assertNull(s.nextUpload());
            JSONObject first=s.capture(A);String firstId=s.nextUpload().getString("id");s.capture(B);
            JSONObject sealed=s.finishUpload();assertEquals(firstId,sealed.getString("id"));assertEquals(2,sealed.getInt("last_seq"));assertNull(s.finishUpload());
            s.capture(String.format(Locale.ROOT,"%032d",3));JSONObject next=s.snapshot().getJSONObject("currentUpload");assertNotEquals(firstId,next.getString("id"));assertEquals(3,next.getInt("first_seq"));
            assertEquals(2,s.pendingForUpload(firstId,20).length());assertEquals(1,s.pendingForUpload(next.getString("id"),20).length());
            s.acknowledge(envelope(s,receipt(first,"accepted"),receipt(s.pendingForUpload(firstId,20).getJSONObject(1),"accepted")));
            JSONObject completed=uploadReceipt(s,sealed,"completed");s.completeUpload(completed);s.completeUpload(completed);
            assertEquals(next.getString("id"),s.nextUpload().getString("id"));assertEquals(1,s.snapshot().getJSONObject("uploadCounts").getInt("completed"));assertEquals("open",s.current().getString("phase"));
        }
    }
    @Test public void uploadReceiptsCannotChangeScopeOrConfirmUnreceivedEvents()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){
            QueueStore s=opened(db,2);JSONObject event=s.capture(A),initial=s.nextUpload();
            assertThrows(Exception.class,()->s.registerUpload(uploadReceipt(s,initial,"open").put("firstSequence",2)));
            assertThrows(Exception.class,()->s.acknowledge(envelope(s,receipt(event,"accepted")).put("uploadId",UUID.randomUUID().toString())));
            JSONObject upload=s.finishUpload(),done=uploadReceipt(s,upload,"completed");assertThrows(Exception.class,()->s.completeUpload(done));
            s.registerUpload(uploadReceipt(s,upload,"open"));s.acknowledge(envelope(s,receipt(event,"accepted")));
            assertThrows(Exception.class,()->s.completeUpload(new JSONObject(done.toString()).put("lastSequence",2)));
            s.completeUpload(done);assertNull(s.nextUpload());assertEquals(1,s.backup().getJSONArray("events").length());
        }
    }
    @Test public void rejectedOnlyUploadRetainsAuditWithoutCountingUsedBatch()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){
            QueueStore s=opened(db,2);JSONObject event=s.capture("坏码");JSONObject upload=s.finishUpload();
            s.acknowledge(envelope(s,receipt(event,"rejected")));s.completeUpload(uploadReceipt(s,upload,"completed"));
            assertEquals(0,s.snapshot().getJSONObject("uploadCounts").getInt("completed"));assertEquals(1,s.backup().getJSONArray("uploads").length());assertNull(s.finishUpload());
        }
    }
    @Test public void concurrentFinishAndScansPartitionEveryEventOnce()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){
            QueueStore s=opened(db,100);ExecutorService workers=Executors.newFixedThreadPool(8);List<Future<?>> work=new ArrayList<>();
            try{for(int i=1;i<=100;i++){final int n=i;work.add(workers.submit(()->{try{s.capture(String.format(Locale.ROOT,"%032d",n));if(n%7==0)s.finishUpload();}catch(Exception e){throw new RuntimeException(e);}}));}for(Future<?> future:work)future.get();}finally{workers.shutdownNow();}
            s.finishUpload();int expected=1,total=0;
            for(JSONObject upload:db.rows("SELECT * FROM upload ORDER BY first_seq")){
                assertEquals(expected,upload.getInt("first_seq"));List<JSONObject> events=db.rows("SELECT seq FROM event WHERE upload_id=? ORDER BY seq",upload.getString("id"));
                for(JSONObject event:events)assertEquals(expected++,event.getInt("seq"));assertEquals(expected-1,upload.getInt("last_seq"));total+=events.size();
            }
            assertEquals(100,total);assertEquals(101,expected);
        }
    }
    @Test public void offlineBoundariesAndBothUploadIdsSurviveRestart()throws Exception {
        Path file=Files.createTempFile("pda-upload-restart-",".sqlite");String firstId,secondId,eventId;
        try{try(Jdbc db=new Jdbc(file.toString())){QueueStore s=opened(db,2);eventId=s.capture(A).getString("eventId");firstId=s.finishUpload().getString("id");s.capture(B);secondId=s.snapshot().getJSONObject("currentUpload").getString("id");}
            try(Jdbc db=new Jdbc(file.toString())){QueueStore s=new QueueStore(db);assertEquals(firstId,s.nextUpload().getString("id"));assertEquals(1,s.nextUpload().getInt("last_seq"));assertEquals(secondId,s.snapshot().getJSONObject("currentUpload").getString("id"));assertEquals(eventId,s.pendingForUpload(firstId,20).getJSONObject(0).getString("eventId"));assertEquals(1,s.pendingForUpload(secondId,20).length());}}
        finally{Files.deleteIfExists(file);}
    }
    @Test public void legacyUpgradeKeepsUnconfirmedEventsOutsideNewBatches()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){
            db.exec("CREATE TABLE session(id TEXT PRIMARY KEY,server TEXT NOT NULL,task_id INTEGER NOT NULL,phase TEXT NOT NULL,context TEXT NOT NULL,next_seq INTEGER NOT NULL DEFAULT 1,final_seq INTEGER,end_task INTEGER NOT NULL DEFAULT 0)");
            db.exec("CREATE TABLE allowed(session_id TEXT NOT NULL,code TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(session_id,code))");
            db.exec("CREATE TABLE event(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,seq INTEGER NOT NULL,code TEXT,kind TEXT NOT NULL,payload TEXT NOT NULL,receipt TEXT,result_state TEXT,UNIQUE(session_id,seq))");
            String sid=UUID.randomUUID().toString();JSONObject old=new JSONObject().put("eventId",UUID.randomUUID().toString()).put("sequence",1).put("code",A).put("rawCode",A).put("kind","valid").put("reason","").put("capturedAt","2026-10-12T01:00:00.000Z");
            db.exec("INSERT INTO session(id,server,task_id,phase,context,next_seq) VALUES (?,?,1,'open',?,2)",sid,"https://www.nz315.cn",new JSONObject().put("taskId",1).toString());
            db.exec("INSERT INTO allowed VALUES (?,?,'eligible')",sid,A);db.exec("INSERT INTO allowed VALUES (?,?,'eligible')",sid,B);
            db.exec("INSERT INTO event(id,session_id,seq,code,kind,payload) VALUES (?,?,1,?,'valid',?)",old.getString("eventId"),sid,A,old.toString());
            QueueStore s=new QueueStore(db);assertNull(s.nextUpload());assertEquals(old.toString(),s.pendingForUpload(null,20).getJSONObject(0).toString());
            s.capture(B);assertEquals(2,s.nextUpload().getInt("first_seq"));s.acknowledge(new JSONObject().put("sessionId",sid).put("receipts",new JSONArray().put(receipt(old,"accepted"))));
            assertEquals(0,s.pendingForUpload(null,20).length());assertTrue(s.backup().getJSONArray("events").getJSONObject(0).isNull("upload_id"));assertEquals(1,s.backup().getJSONArray("uploads").length());
        }
    }
    @Test public void concurrentFastScansAllocateContiguousSequence()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){QueueStore s=opened(db,100);ExecutorService pool=Executors.newFixedThreadPool(8);List<Future<?>> work=new ArrayList<>();try{for(int i=1;i<=100;i++){final int n=i;work.add(pool.submit(()->{try{s.capture(String.format("%032d",n));}catch(Exception e){throw new RuntimeException(e);}}));}for(Future<?> f:work)f.get();}finally{pool.shutdownNow();}assertEquals(100,s.snapshot().getJSONObject("counts").getInt("collected"));assertEquals(101,s.current().getInt("next_seq"));}
    }
    @Test public void restartRestoresPendingAndClosingPhase()throws Exception {
        Path file=Files.createTempFile("pda-restart-",".sqlite");String eventId;
        try{try(Jdbc db=new Jdbc(file.toString())){QueueStore s=opened(db,2);eventId=s.capture(A).getString("eventId");s.close(false);}try(Jdbc db=new Jdbc(file.toString())){QueueStore s=new QueueStore(db);assertEquals("closing",s.current().getString("phase"));assertEquals(eventId,s.pending(20).getJSONObject(0).getString("eventId"));assertThrows(Exception.class,()->s.capture(B));}}finally{Files.deleteIfExists(file);}
    }
    @Test public void backupIncludesFullHistoryReceiptsAndPendingWithoutChangingQueue()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){
            QueueStore s=opened(db,40);JSONObject first=s.capture(A);
            s.acknowledge(envelope(s,receipt(first,"accepted")));
            for(int i=2;i<=40;i++)s.capture(String.format(Locale.ROOT,"%032d",i));
            s.capture("half-url?i="+A);s.capture("bad-code");
            String pending=s.pending(50).toString();JSONObject backup=s.backup();
            assertEquals("nz315-production-backup",backup.getString("format"));
            assertEquals(42,backup.getJSONArray("events").length());
            assertEquals(40,backup.getJSONArray("allowed").length());
            assertEquals(A,backup.getJSONArray("events").getJSONObject(0).getString("code"));
            assertEquals("accepted",new JSONObject(backup.getJSONArray("events").getJSONObject(0).getString("receipt")).getString("state"));
            assertEquals(pending,s.pending(50).toString());
            db.exec("UPDATE session SET phase='closed'");
            assertNull(s.current());assertEquals(42,s.backup().getJSONArray("events").length());
        }
    }
    @Test public void abruptProcessExitRetainsEveryCommittedScan()throws Exception {
        Path file=Files.createTempFile("pda-kill-",".sqlite");
        try{try(Jdbc db=new Jdbc(file.toString())){opened(db,100);}String java=Path.of(System.getProperty("java.home"),"bin","java").toString();Process child=new ProcessBuilder(java,"-cp",System.getProperty("test.runtime.classpath"),CrashChild.class.getName(),file.toString()).redirectErrorStream(true).start();String log=new String(child.getInputStream().readAllBytes());assertEquals(log,17,child.waitFor());try(Jdbc db=new Jdbc(file.toString())){QueueStore s=new QueueStore(db);assertEquals(100,s.snapshot().getJSONObject("counts").getInt("collected"));assertEquals(50,s.pending(50).length());}}finally{Files.deleteIfExists(file);}
    }
    @Test public void streamingBackupPagesAllEventsWithoutTruncatingOrDeleting()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){
            QueueStore s=opened(db,2);JSONObject first=s.capture(A);s.acknowledge(envelope(s,receipt(first,"accepted")));
            for(int i=0;i<1200;i++)s.capture("?47="+A);
            java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();s.writeBackup(output);
            JSONObject backup=new JSONObject(output.toString("UTF-8"));assertEquals(1201,backup.getJSONArray("events").length());
            assertEquals(A,backup.getJSONArray("allowed").getJSONObject(0).getString("code"));
            assertEquals(1200,s.snapshot().getJSONObject("counts").getInt("waiting"));
            assertFalse(backup.getJSONArray("events").getJSONObject(0).has("backup_rowid"));
        }
    }
    public static class CrashChild { public static void main(String[]args)throws Exception{Jdbc db=new Jdbc(args[0]);QueueStore s=new QueueStore(db);for(int i=1;i<=100;i++)s.capture(String.format("%032d",i));Runtime.getRuntime().halt(17);} }
}
