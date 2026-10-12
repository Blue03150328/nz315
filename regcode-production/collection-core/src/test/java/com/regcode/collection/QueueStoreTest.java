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
    static JSONObject envelope(QueueStore store,JSONObject...events)throws Exception{return new JSONObject().put("sessionId",store.current().getString("id")).put("receipts",new JSONArray(Arrays.asList(events)));}
    @Test public void urlDoesNotMatterButFullCodeMustBeUnique(){
        for(String input:new String[]{A,"?47="+A,"https://other/?i="+A,"半截网址?id="+A+"&","?a="+A+"&a="+A})assertEquals(A,QueueStore.codeOf(input));
        for(String input:new String[]{A+"9",A.substring(1),"?a="+A+"&b="+B,"abc"})assertNull(QueueStore.codeOf(input));
    }
    @Test public void duplicatesAndBadCodesPersistWithoutCounting()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){QueueStore s=opened(db,2);assertEquals("valid",s.capture("?i="+A).getString("kind"));assertEquals("duplicate",s.capture("?47="+A).getString("kind"));assertEquals("invalid",s.capture("http://broken?id=123").getString("kind"));assertEquals("invalid",s.capture(String.format("%032d",99)).getString("kind"));JSONObject c=s.snapshot().getJSONObject("counts");assertEquals(1,c.getInt("collected"));assertEquals(4,c.getInt("waiting"));assertEquals(1,c.getInt("duplicates"));assertEquals(2,c.getInt("rejected"));}
    }
    @Test public void faultRollsBackEventAndSequenceTogether()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){QueueStore s=opened(db,2);db.exec("CREATE TRIGGER fault BEFORE UPDATE OF next_seq ON session BEGIN SELECT RAISE(ABORT,'fault');END");assertThrows(Exception.class,()->s.capture(A));assertEquals(0,s.pending(50).length());assertEquals(1,s.current().getInt("next_seq"));db.exec("DROP TRIGGER fault");assertEquals(1,s.capture(A).getInt("sequence"));}
    }
    @Test public void receiptsMatchOriginalEventAndNeverDeleteHistory()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){QueueStore s=opened(db,2);JSONObject e=s.capture(A),r=receipt(e,"accepted");assertThrows(Exception.class,()->s.acknowledge(envelope(s,new JSONObject(r.toString()).put("code",B))));assertEquals(1,s.pending(20).length());s.acknowledge(envelope(s,r));s.acknowledge(envelope(s,r));assertEquals(0,s.pending(20).length());assertEquals(1,s.snapshot().getJSONObject("counts").getInt("accepted"));assertEquals(1,db.rows("SELECT * FROM event").size());}
    }
    @Test public void batchReceiptMismatchRollsBackAllAcknowledgements()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){QueueStore s=opened(db,2);JSONObject a=s.capture(A),b=s.capture(B);assertThrows(Exception.class,()->s.acknowledge(envelope(s,receipt(a,"accepted"),receipt(b,"accepted").put("sequence",99))));assertEquals(2,s.pending(20).length());}
    }
    @Test public void stopFreezesFinalSequenceAndRequiresAllReceipts()throws Exception {
        try(Jdbc db=new Jdbc(":memory:")){QueueStore s=opened(db,2);JSONObject e=s.capture(A);s.close(true);assertThrows(Exception.class,()->s.capture(B));JSONObject done=new JSONObject().put("ok",true).put("state","completed").put("sessionId",s.current().getString("id")).put("lastSequence",1);assertThrows(Exception.class,()->s.complete(done));s.acknowledge(envelope(s,receipt(e,"accepted")));s.complete(done);assertNull(s.current());assertEquals(1,db.rows("SELECT * FROM event").size());}
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
