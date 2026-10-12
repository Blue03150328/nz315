package com.regcode.app;

import com.regcode.collection.ExternalQueueStore;
import com.regcode.collection.QueueStore;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.*;
import java.util.function.BooleanSupplier;
import static org.junit.Assert.*;

/** 外码HTTP与SQLite故障验收：落库响应丢失、分段补传、跨设备重复及冻结批次。 */
public class ExternalCollectionSyncTest {
    private TestServer server;
    private Jdbc db;
    private ExternalQueueStore queue;
    private ProductionClient client;
    private ExternalCollectionSync sync;
    private String base;
    @Before public void setup() throws Exception {
        server=new TestServer();server.start();base="http://127.0.0.1:"+server.socket.getLocalPort();db=new Jdbc();queue=new ExternalQueueStore(db);
        queue.trust(base,new JSONObject().put("device",new JSONObject().put("id",2).put("enterprise_id",1).put("line_name","一号线")));queue.prepare(base,"0001");
        client=new ProductionClient(true);client.configure(base);client.deviceCredential("a".repeat(64));sync=new ExternalCollectionSync(queue,client,false);sync.authenticated(true);
    }
    @After public void cleanup() throws Exception {sync.stop();server.socket.close();server.join(2000);db.close();}
    private static void waitFor(BooleanSupplier ready) throws Exception {long until=System.currentTimeMillis()+6000;while(!ready.getAsBoolean()&&System.currentTimeMillis()<until)Thread.sleep(15);assertTrue("外部补传未达到预期状态",ready.getAsBoolean());}
    private int waiting(){try{return queue.snapshot().getJSONObject("queueCounts").getInt("waiting");}catch(Exception error){throw new RuntimeException(error);}}
    private boolean finished(){try{return queue.nextBatch()==null;}catch(Exception error){throw new RuntimeException(error);}}
    private void capture(int count) throws Exception {for(int i=0;i<count;i++)queue.capture("https://example.com/?code=000"+i+"&raw=%2f");}
    @Test public void sendsTwentyAtATimeWithoutLoginOrChangingOriginals() throws Exception {
        capture(45);queue.finish();assertTrue(sync.uploadNow());waitFor(this::finished);assertEquals(Arrays.asList(20,20,5),server.sizes);assertEquals(45,queue.backup().getJSONArray("events").length());assertTrue(server.authorized);assertEquals(1,server.started.size());assertEquals(1,server.completed.size());assertEquals("https://example.com/?code=0000&raw=%2f",new JSONObject(server.eventBodies.get(0)).getJSONArray("events").getJSONObject(0).getString("rawCode"));
    }
    @Test public void droppedEventResponseReplaysIdenticalPayloadAndStableIds() throws Exception {
        capture(2);String id=queue.finish().getString("id");server.dropEvents=true;sync.uploadNow();waitFor(()->sync.message().contains("网络中断"));assertEquals(2,waiting());sync.uploadNow();waitFor(this::finished);assertEquals(2,server.eventBodies.size());assertEquals(server.eventBodies.get(0),server.eventBodies.get(1));assertEquals(2,queue.snapshot().getJSONObject("counts").getInt("accepted"));assertEquals(Collections.singletonList(id),server.completed);
    }
    @Test public void lostStartResponseReregistersSameLocalBatch() throws Exception {
        capture(1);String id=queue.finish().getString("id");server.dropStart=true;sync.uploadNow();waitFor(()->sync.message().contains("网络中断"));assertEquals(1,waiting());sync.uploadNow();waitFor(this::finished);assertEquals(Arrays.asList(id,id),server.started);assertEquals(1,server.eventBodies.size());
    }
    @Test public void partialReceiptOnlyRetriesTheUnconfirmedTail() throws Exception {
        capture(2);queue.finish();server.partial=true;sync.uploadNow();waitFor(()->waiting()==1);assertTrue(sync.message().contains("部分"));sync.uploadNow();waitFor(this::finished);assertEquals(Arrays.asList(2,1),server.sizes);JSONObject first=new JSONObject(server.eventBodies.get(0)).getJSONArray("events").getJSONObject(1),retried=new JSONObject(server.eventBodies.get(1)).getJSONArray("events").getJSONObject(0);assertEquals(first.toString(),retried.toString());
    }
    @Test public void lostCompletionResponseOnlyRetriesTheFrozenCompletion() throws Exception {
        capture(2);String id=queue.finish().getString("id");server.dropComplete=true;sync.uploadNow();waitFor(()->sync.message().contains("网络中断"));assertEquals(0,waiting());assertEquals(id,queue.nextBatch().getString("id"));sync.uploadNow();waitFor(this::finished);assertEquals(Collections.singletonList(2),server.sizes);assertEquals(Arrays.asList(id,id),server.completed);
    }
    @Test public void differentOfflineBatchesRemainIndependentAndCloudDuplicatesDoNotCount() throws Exception {
        capture(1);String first=queue.finish().getString("id");queue.capture("https://example.com/?code=0000&raw=%2f");String second=queue.finish().getString("id");assertNotEquals(first,second);sync.uploadNow();waitFor(()->server.completed.size()>=1);sync.uploadNow();waitFor(this::finished);assertEquals(Arrays.asList(first,second),server.completed);assertEquals(2,queue.backup().getJSONArray("events").length());assertEquals(1,queue.snapshot().getJSONObject("counts").getInt("duplicates"));assertEquals(0,queue.snapshot().getJSONObject("counts").getInt("accepted"));
    }
    @Test public void credentialsRejectedPersistentlyStopCaptureAndPreservePending() throws Exception {
        capture(1);queue.finish();server.status=403;sync.uploadNow();waitFor(()->{try{return queue.blocked();}catch(Exception error){throw new RuntimeException(error);}});assertThrows(Exception.class,()->queue.capture("新码"));assertEquals(1,waiting());assertFalse(sync.uploadNow());assertEquals(1,queue.backup().getJSONArray("events").length());
    }
    @Test public void changedDeviceContextNeverUploadsOldOfflineBatch() throws Exception {
        capture(1);queue.finish();queue.trust(base,new JSONObject().put("device",new JSONObject().put("id",2).put("enterprise_id",99).put("line_name","二号线")));sync.uploadNow();waitFor(()->sync.message().contains("归属"));assertTrue(server.started.isEmpty());assertEquals(1,waiting());
    }
    @Test public void completedReceiptCanReplayAfterSameDeviceChangesLineWithoutMovingCodes() throws Exception {
        capture(2);String id=queue.finish().getString("id");server.dropComplete=true;sync.uploadNow();waitFor(()->sync.message().contains("网络中断"));assertEquals(0,waiting());queue.trust(base,new JSONObject().put("device",new JSONObject().put("id",2).put("enterprise_id",1).put("line_name","二号线")));sync.uploadNow();waitFor(this::finished);assertEquals(Arrays.asList(id,id),server.completed);assertEquals(Collections.singletonList(2),server.sizes);assertEquals("一号线",queue.backup().getJSONArray("batches").getJSONObject(0).getString("line_name"));assertThrows(Exception.class,()->queue.capture("新码"));
    }
    private static final class TestServer extends Thread {
        final ServerSocket socket=new ServerSocket(0);
        final List<Integer> sizes=Collections.synchronizedList(new ArrayList<>());
        final List<String> started=Collections.synchronizedList(new ArrayList<>()),completed=Collections.synchronizedList(new ArrayList<>()),eventBodies=Collections.synchronizedList(new ArrayList<>());
        final Map<String,JSONObject> batches=new HashMap<>(),receipts=new HashMap<>();final Set<String> codes=new HashSet<>();
        volatile boolean dropStart,dropEvents,dropComplete,partial,authorized;volatile int status=200;
        TestServer() throws Exception {setDaemon(true);}
        @Override public void run(){while(!socket.isClosed())try(Socket accepted=socket.accept()){
            InputStream input=accepted.getInputStream();ByteArrayOutputStream header=new ByteArrayOutputStream();String lines="";while(!lines.endsWith("\r\n\r\n")){int b=input.read();if(b<0)throw new Exception("请求不完整");header.write(b);lines=header.toString("UTF-8");}
            authorized=lines.contains("Authorization: Bearer "+"a".repeat(64));int length=0;for(String line:lines.split("\r\n"))if(line.toLowerCase(Locale.ROOT).startsWith("content-length:"))length=Integer.parseInt(line.substring(15).trim());byte[] bytes=input.readNBytes(length);String path=lines.split(" ",3)[1],raw=new String(bytes,StandardCharsets.UTF_8);JSONObject request=new JSONObject(raw),response;
            if(status!=200){response=new JSONObject().put("statusMessage","设备已停用");}
            else if(path.equals("/api/device/external-collections")){
                String id=request.getString("batchId");started.add(id);batches.putIfAbsent(id,new JSONObject(request.toString()));int last=0;for(JSONObject r:receipts.values())if(id.equals(r.optString("batch")))last=Math.max(last,r.getInt("sequence"));response=new JSONObject().put("ok",true).put("batchId",id).put("workerNo",request.getString("workerNo")).put("lineName",request.getString("lineName")).put("state","active").put("lastSequence",last);if(dropStart){dropStart=false;continue;}
            }else if(path.endsWith("/events")){
                String id=path.split("/")[4];JSONArray events=request.getJSONArray("events"),results=new JSONArray();sizes.add(events.length());eventBodies.add(raw);boolean partialNow=partial;partial=false;
                for(int i=0;i<(partialNow?1:events.length());i++){JSONObject event=events.getJSONObject(i);String eventId=event.getString("eventId");JSONObject r=receipts.get(eventId);if(r==null){r=new JSONObject().put("eventId",eventId).put("sequence",event.getInt("sequence")).put("state",codes.add(event.getString("rawCode"))?"accepted":"duplicate").put("reason","").put("batch",id);receipts.put(eventId,r);}JSONObject visible=new JSONObject(r.toString());visible.remove("batch");results.put(visible);}
                response=new JSONObject().put("ok",!partialNow).put("batchId",id).put("receipts",results);if(partialNow)response.put("message","部分外部记录未确认，请重试");if(dropEvents){dropEvents=false;continue;}
            }else{
                String id=path.split("/")[4];completed.add(id);int acceptedCount=0,duplicateCount=0;for(JSONObject r:receipts.values())if(id.equals(r.optString("batch"))){if("accepted".equals(r.getString("state")))acceptedCount++;else duplicateCount++;}response=new JSONObject().put("ok",true).put("state","completed").put("batchId",id).put("lastSequence",request.getInt("lastSequence")).put("acceptedCount",acceptedCount).put("duplicateCount",duplicateCount).put("rejectedCount",0);if(dropComplete){dropComplete=false;continue;}
            }
            byte[] result=response.toString().getBytes(StandardCharsets.UTF_8);accepted.getOutputStream().write(("HTTP/1.1 "+status+" Result\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: "+result.length+"\r\n\r\n").getBytes(StandardCharsets.UTF_8));accepted.getOutputStream().write(result);accepted.getOutputStream().flush();
        }catch(Exception ignored){/* 测试模拟断网时保留服务器已经处理的原事件收据。 */}}
    }
    private static final class Jdbc implements QueueStore.Sql,AutoCloseable {
        final Connection connection=DriverManager.getConnection("jdbc:sqlite::memory:");
        Jdbc() throws Exception {}
        public void exec(String sql,Object...args) throws Exception {try(PreparedStatement p=connection.prepareStatement(sql)){for(int i=0;i<args.length;i++)p.setObject(i+1,args[i]);p.execute();}}
        public List<JSONObject> rows(String sql,Object...args) throws Exception {List<JSONObject> rows=new ArrayList<>();try(PreparedStatement p=connection.prepareStatement(sql)){for(int i=0;i<args.length;i++)p.setObject(i+1,args[i]);try(ResultSet r=p.executeQuery()){while(r.next()){JSONObject row=new JSONObject();for(int i=1;i<=r.getMetaData().getColumnCount();i++)row.put(r.getMetaData().getColumnName(i),r.getObject(i)==null?JSONObject.NULL:r.getObject(i));rows.add(row);}}}return rows;}
        public <T>T transaction(QueueStore.Work<T> work) throws Exception {connection.setAutoCommit(false);try{T result=work.run();connection.commit();return result;}catch(Exception error){connection.rollback();throw error;}finally{connection.setAutoCommit(true);}}
        public void close() throws Exception {connection.close();}
    }
}
