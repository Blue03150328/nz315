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

/** 隔离HTTP和SQLite验收：手动上传复用登录、20条分批、丢失收据重试和备份不删除。 */
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
    private final class TestServer extends Thread {
        final ServerSocket socket=new ServerSocket(0);
        final AtomicInteger logins=new AtomicInteger();
        final List<Integer> sizes=Collections.synchronizedList(new ArrayList<>());
        final List<String> eventBodies=Collections.synchronizedList(new ArrayList<>());
        volatile int status=200;volatile boolean drop;
        TestServer()throws Exception {setDaemon(true);}
        @Override public void run(){while(!socket.isClosed())try(Socket accepted=socket.accept()){
            InputStream input=accepted.getInputStream();ByteArrayOutputStream header=new ByteArrayOutputStream();String lines="";
            while(!lines.endsWith("\r\n\r\n")){int b=input.read();if(b<0)throw new Exception("Incomplete request");header.write(b);lines=header.toString("UTF-8");}
            int length=0;for(String line:lines.split("\r\n"))if(line.toLowerCase(Locale.ROOT).startsWith("content-length:"))length=Integer.parseInt(line.substring(15).trim());
            byte[] bytes=new byte[length];int offset=0;while(offset<length){int n=input.read(bytes,offset,length-offset);if(n<0)throw new Exception("Incomplete body");offset+=n;}
            String path=lines.split(" ",3)[1],body="{\"ok\":true}",extra="";int code=200;
            if(path.endsWith("login")){logins.incrementAndGet();extra="Set-Cookie: nz315_user=test-cookie; HttpOnly; Path=/\r\n";}
            else if(path.endsWith("events")){
                String raw=new String(bytes,StandardCharsets.UTF_8);eventBodies.add(raw);JSONObject request=new JSONObject(raw);JSONArray events=request.getJSONArray("events");sizes.add(events.length());
                String sessionId=path.split("/")[6];JSONArray receipts=new JSONArray();
                for(int i=0;i<events.length();i++){JSONObject event=events.getJSONObject(i);receipts.put(new JSONObject().put("eventId",event.getString("eventId")).put("sequence",event.getInt("sequence")).put("code",event.get("code")).put("kind",event.getString("kind")).put("state","accepted").put("reason",""));}
                code=status;body=code==200?new JSONObject().put("ok",true).put("sessionId",sessionId).put("receipts",receipts).toString():"{\"statusMessage\":\"当前账号无权上传此任务\"}";
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
