package com.regcode.app;

import com.regcode.collection.QueueStore;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import java.net.ServerSocket;
import java.net.Socket;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import static org.junit.Assert.*;

/** 隔离HTTP和SQLite验收：自动分段、上传边界、丢失收据重试和备份不删除。 */
public class CollectionSyncTest {
    private TestServer server;
    private Jdbc db;
    private QueueStore queue;
    private ProductionClient client;
    private CollectionSync sync;
    @Before public void setup() throws Exception {
        server=new TestServer();server.start();db=new Jdbc();queue=new QueueStore(db);
        client=new ProductionClient(true);client.configure("http://127.0.0.1:"+server.socket.getLocalPort());
        client.request("POST","/api/auth/login","{}");
        JSONObject session=queue.prepare("http://127.0.0.1",1,new JSONObject());
        JSONArray codes=new JSONArray();for(int i=1;i<=45;i++)codes.put(new JSONObject().put("code",String.format(Locale.ROOT,"%032d",i)).put("eligible",1));
        queue.activate(new JSONObject().put("ok",true).put("state","active").put("sessionId",session.getString("id")).put("lastSequence",0).put("context",new JSONObject().put("taskId",1)).put("codes",codes));
        sync=new CollectionSync(queue,client,false);
        sync.authenticated(true);
    }
    @After public void cleanup() throws Exception {sync.stop();server.socket.close();server.join(2000);db.close();}
    private void capture(int count)throws Exception {for(int i=1;i<=count;i++)queue.capture(String.format(Locale.ROOT,"%032d",i));}
    private static void waitFor(BooleanSupplier ready)throws Exception {long until=System.currentTimeMillis()+4000;while(!ready.getAsBoolean()&&System.currentTimeMillis()<until)Thread.sleep(15);assertTrue("Upload did not reach expected state",ready.getAsBoolean());}
    private int waiting(){try{return queue.pending(50).length();}catch(Exception e){throw new RuntimeException(e);}}
    @Test public void manualUploadReusesLoginBatchesAndRetainsCaptureAndHistory()throws Exception {
        capture(45);assertTrue(sync.uploadNow());waitFor(()->waiting()==0);
        assertEquals(1,server.logins.get());assertFalse(sync.loginRequired());
        assertEquals(Arrays.asList(20,20,5),server.sizes);assertEquals(45,queue.backup().getJSONArray("events").length());
        assertEquals("open",queue.current().getString("phase"));assertEquals("duplicate",queue.capture(String.format(Locale.ROOT,"%032d",1)).getString("kind"));
    }
    @Test public void missingResponseRetryUsesSameEventsWithoutAnotherLogin()throws Exception {
        capture(2);server.drop=true;assertTrue(sync.uploadNow());waitFor(()->sync.message().contains("网络中断"));
        assertEquals(2,waiting());assertFalse(sync.loginRequired());assertTrue(sync.uploadNow());waitFor(()->waiting()==0);
        assertEquals(1,server.logins.get());assertEquals(2,server.eventBodies.size());assertEquals(server.eventBodies.get(0),server.eventBodies.get(1));
        assertEquals(2,queue.snapshot().getJSONObject("counts").getInt("accepted"));
    }
    @Test public void serverFailureKeepsRecordsAndCanRetryWithoutLogin()throws Exception {
        capture(1);server.status=503;sync.uploadNow();waitFor(()->sync.message().contains("服务器尚未确认"));
        assertEquals(1,waiting());assertFalse(sync.loginRequired());server.status=200;sync.uploadNow();waitFor(()->waiting()==0);assertEquals(1,server.logins.get());
    }
    @Test public void only401RequiresLoginAndNeverDeletesPending()throws Exception {
        capture(1);server.status=401;sync.uploadNow();waitFor(sync::loginRequired);
        assertEquals(1,waiting());assertFalse(client.hasSession());assertFalse(sync.uploadNow());assertEquals(1,server.logins.get());
    }
    @Test public void forbiddenTaskDoesNotMisreportExpiredLogin()throws Exception {
        capture(1);server.status=403;sync.uploadNow();waitFor(()->sync.message().contains("无权"));
        assertFalse(sync.loginRequired());assertTrue(client.hasSession());assertEquals(1,waiting());assertEquals(1,server.logins.get());
    }
    @Test public void automaticSegmentsKeepOneBatchUntilExplicitFinish()throws Exception {
        sync.stop();sync=new CollectionSync(queue,client);sync.authenticated(true);capture(45);waitFor(()->waiting()==0);
        String first=queue.nextUpload().getString("id");assertEquals(Arrays.asList(20,20,5),server.sizes);assertEquals(1,server.startedUploads.size());assertTrue(server.completedUploads.isEmpty());
        queue.finishUpload();waitFor(()->{try{return queue.nextUpload()==null;}catch(Exception e){throw new RuntimeException(e);}});
        assertEquals(Collections.singletonList(first),server.completedUploads);assertEquals("open",queue.current().getString("phase"));
    }
    @Test public void offlineFinishAndNewScansRemainDifferentBatches()throws Exception {
        capture(2);String first=queue.finishUpload().getString("id");assertNull(queue.finishUpload());
        queue.capture(String.format(Locale.ROOT,"%032d",3));String second=queue.finishUpload().getString("id");assertNotEquals(first,second);
        sync.stop();sync=new CollectionSync(queue,client);sync.authenticated(true);waitFor(()->{try{return queue.nextUpload()==null;}catch(Exception e){throw new RuntimeException(e);}});
        assertEquals(Arrays.asList(2,1),server.sizes);assertEquals(Arrays.asList(first,second),server.eventUploads);assertEquals(Arrays.asList(first,second),server.completedUploads);
        assertTrue(server.operations.indexOf("完成:"+first)<server.operations.indexOf("登记:"+second));assertEquals(2,queue.snapshot().getJSONObject("uploadCounts").getInt("completed"));
    }
    @Test public void lostUploadCompletionReceiptRetriesOriginalIdWithoutResendingConfirmedCodes()throws Exception {
        capture(2);String id=queue.finishUpload().getString("id");server.dropComplete=true;sync.uploadNow();waitFor(()->sync.message().contains("网络中断"));
        assertEquals(0,waiting());assertEquals(id,queue.nextUpload().getString("id"));assertEquals("sealed",queue.nextUpload().getString("phase"));
        sync.uploadNow();waitFor(()->{try{return queue.nextUpload()==null;}catch(Exception e){throw new RuntimeException(e);}});
        assertEquals(Collections.singletonList(2),server.sizes);assertEquals(Arrays.asList(id,id),server.completedUploads);assertEquals(1,queue.backup().getJSONArray("uploads").length());
    }
    @Test public void partialReceiptsResumeRemainingEventsInSameUpload()throws Exception {
        capture(2);String id=queue.finishUpload().getString("id");server.partial=true;sync.uploadNow();waitFor(()->sync.message().contains("部分记录未确认"));
        assertEquals(1,waiting());String remaining=queue.pending(20).getJSONObject(0).getString("eventId");
        sync.uploadNow();waitFor(()->{try{return queue.nextUpload()==null;}catch(Exception e){throw new RuntimeException(e);}});assertEquals(Arrays.asList(2,1),server.sizes);assertEquals(Arrays.asList(id,id),server.eventUploads);
        assertEquals(remaining,new JSONObject(server.eventBodies.get(1)).getJSONArray("events").getJSONObject(0).getString("eventId"));assertEquals(2,queue.snapshot().getJSONObject("counts").getInt("accepted"));
    }
    @Test public void sessionCloseConfirmsTailBatchBeforeEndingSession()throws Exception {
        capture(2);String id=queue.nextUpload().getString("id");queue.close(true);sync.uploadNow();waitFor(()->{try{return queue.current()==null;}catch(Exception e){throw new RuntimeException(e);}});
        assertEquals(Collections.singletonList(id),server.completedUploads);assertTrue(server.operations.indexOf("完成:"+id)<server.operations.indexOf("结束会话"));
    }
    @Test public void legacyUnconfirmedEventsKeepOriginalProtocol()throws Exception {
        capture(1);db.exec("UPDATE event SET upload_id=NULL");db.exec("DELETE FROM upload");queue.capture(String.format(Locale.ROOT,"%032d",2));
        sync.uploadNow();waitFor(()->waiting()==0);assertEquals(2,server.eventBodies.size());assertFalse(new JSONObject(server.eventBodies.get(0)).has("uploadId"));assertTrue(new JSONObject(server.eventBodies.get(1)).has("uploadId"));
        assertEquals(2,queue.snapshot().getJSONObject("counts").getInt("accepted"));assertEquals(1,server.startedUploads.size());
    }
    @Test public void rejectedOnlyUploadCompletesWithoutUsedBatch()throws Exception {
        queue.capture("错误码");queue.finishUpload();sync.uploadNow();waitFor(()->{try{return queue.nextUpload()==null;}catch(Exception e){throw new RuntimeException(e);}});
        assertEquals(0,queue.snapshot().getJSONObject("uploadCounts").getInt("completed"));assertEquals(1,queue.backup().getJSONArray("uploads").length());
    }
    private final class TestServer extends Thread {
        final ServerSocket socket=new ServerSocket(0);
        final AtomicInteger logins=new AtomicInteger();
        final List<Integer> sizes=Collections.synchronizedList(new ArrayList<>());
        final List<String> eventBodies=Collections.synchronizedList(new ArrayList<>());
        final List<String> eventUploads=Collections.synchronizedList(new ArrayList<>()),startedUploads=Collections.synchronizedList(new ArrayList<>()),completedUploads=Collections.synchronizedList(new ArrayList<>()),operations=Collections.synchronizedList(new ArrayList<>());
        volatile int status=200;volatile boolean drop,dropComplete,partial;
        TestServer()throws Exception {setDaemon(true);}
        @Override public void run(){while(!socket.isClosed())try(Socket accepted=socket.accept()){
            InputStream input=accepted.getInputStream();ByteArrayOutputStream header=new ByteArrayOutputStream();String lines="";
            while(!lines.endsWith("\r\n\r\n")){int b=input.read();if(b<0)throw new Exception("Incomplete request");header.write(b);lines=header.toString("UTF-8");}
            int length=0;for(String line:lines.split("\r\n"))if(line.toLowerCase(Locale.ROOT).startsWith("content-length:"))length=Integer.parseInt(line.substring(15).trim());
            byte[] bytes=new byte[length];int offset=0;while(offset<length){int n=input.read(bytes,offset,length-offset);if(n<0)throw new Exception("Incomplete body");offset+=n;}
            String path=lines.split(" ",3)[1],body="{\"ok\":true}",extra="";int code=200;
            if(path.endsWith("login")){logins.incrementAndGet();extra="Set-Cookie: nz315_user=test-cookie; HttpOnly; Path=/\r\n";}
            else if(path.endsWith("uploads")){
                JSONObject request=new JSONObject(new String(bytes,StandardCharsets.UTF_8));String uid=request.getString("uploadId");startedUploads.add(uid);operations.add("登记:"+uid);
                body=new JSONObject().put("ok",true).put("state","open").put("sessionId",path.split("/")[6]).put("uploadId",uid).put("firstSequence",request.getInt("firstSequence")).put("lastSequence",JSONObject.NULL).toString();
            }
            else if(path.contains("/uploads/")&&path.endsWith("complete")){
                JSONObject request=new JSONObject(new String(bytes,StandardCharsets.UTF_8));String uid=path.split("/")[8];completedUploads.add(uid);operations.add("完成:"+uid);
                body=new JSONObject().put("ok",true).put("state","completed").put("sessionId",path.split("/")[6]).put("uploadId",uid).put("lastSequence",request.getInt("lastSequence")).toString();if(dropComplete){dropComplete=false;continue;}
            }
            else if(path.endsWith("complete")){
                JSONObject request=new JSONObject(new String(bytes,StandardCharsets.UTF_8));operations.add("结束会话");body=new JSONObject().put("ok",true).put("state","completed").put("sessionId",path.split("/")[6]).put("lastSequence",request.getInt("lastSequence")).put("taskEnded",true).toString();
            }
            else if(path.endsWith("events")){
                String raw=new String(bytes,StandardCharsets.UTF_8);eventBodies.add(raw);JSONObject request=new JSONObject(raw);JSONArray events=request.getJSONArray("events");sizes.add(events.length());
                if(request.has("uploadId"))eventUploads.add(request.getString("uploadId"));
                String sessionId=path.split("/")[6];JSONArray receipts=new JSONArray();
                boolean partialResponse=partial;partial=false;
                for(int i=0;i<(partialResponse?1:events.length());i++){JSONObject event=events.getJSONObject(i);String kind=event.getString("kind");receipts.put(new JSONObject().put("eventId",event.getString("eventId")).put("sequence",event.getInt("sequence")).put("code",event.get("code")).put("kind",kind).put("state","valid".equals(kind)?"accepted":"duplicate".equals(kind)?"duplicate":"rejected").put("reason",""));}
                JSONObject result=new JSONObject().put("ok",!partialResponse).put("sessionId",sessionId).put("receipts",receipts);if(request.has("uploadId"))result.put("uploadId",request.getString("uploadId"));if(partialResponse)result.put("statusCode",503).put("message","部分记录未确认，本机保留并重试");
                code=status;body=code==200?result.toString():"{\"statusMessage\":\"当前账号无权上传此任务\"}";
                if(drop){drop=false;continue;}
            }
            byte[] response=body.getBytes(StandardCharsets.UTF_8);
            accepted.getOutputStream().write(("HTTP/1.1 "+code+" Result\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: "+response.length+"\r\n"+extra+"\r\n").getBytes(StandardCharsets.UTF_8));accepted.getOutputStream().write(response);accepted.getOutputStream().flush();
        }catch(Exception ignored){}}
    }
    private static final class Jdbc implements QueueStore.Sql,AutoCloseable {
        final Connection connection=DriverManager.getConnection("jdbc:sqlite::memory:");
        Jdbc()throws Exception{}
        public void exec(String sql,Object...args)throws Exception{try(PreparedStatement p=connection.prepareStatement(sql)){for(int i=0;i<args.length;i++)p.setObject(i+1,args[i]);p.execute();}}
        public List<JSONObject> rows(String sql,Object...args)throws Exception{List<JSONObject> rows=new ArrayList<>();try(PreparedStatement p=connection.prepareStatement(sql)){for(int i=0;i<args.length;i++)p.setObject(i+1,args[i]);try(ResultSet r=p.executeQuery()){while(r.next()){JSONObject row=new JSONObject();for(int i=1;i<=r.getMetaData().getColumnCount();i++)row.put(r.getMetaData().getColumnName(i),r.getObject(i)==null?JSONObject.NULL:r.getObject(i));rows.add(row);}}}return rows;}
        public <T>T transaction(QueueStore.Work<T> work)throws Exception{connection.setAutoCommit(false);try{T result=work.run();connection.commit();return result;}catch(Exception e){connection.rollback();throw e;}finally{connection.setAutoCommit(true);}}
        public void close()throws Exception{connection.close();}
    }
}
