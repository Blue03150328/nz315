package com.regcode.app;

import com.regcode.collection.ExternalQueueStore;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** 外部码自动分段上传：首码创建的批次ID不随断网、重启或手动重试改变。 */
public final class ExternalCollectionSync {
    private final ExternalQueueStore store;
    private final ProductionClient client;
    private final ScheduledExecutorService worker=Executors.newSingleThreadScheduledExecutor();
    private final AtomicBoolean requested=new AtomicBoolean();
    private volatile boolean authenticated;
    private volatile String message="外部采集记录先保存本机，联网后自动补传";
    private volatile long retryAt;
    private int failures;
    public ExternalCollectionSync(ExternalQueueStore store,ProductionClient client){this(store,client,true);}
    ExternalCollectionSync(ExternalQueueStore store,ProductionClient client,boolean automatic){this.store=store;this.client=client;if(automatic)worker.scheduleWithFixedDelay(this::drain,1,2,TimeUnit.SECONDS);}
    public void authenticated(boolean value){authenticated=value;retryAt=0;}
    public String message(){return message;}
    public void stop(){worker.shutdownNow();}
    public void deviceBlocked(){authenticated=false;message="设备已停用或凭证失效，采集已停止；本机记录保留";try{store.block();}catch(Exception ignored){/* 本机存储异常时认证已停止，不删除任何记录。 */}}
    public boolean uploadNow(){
        try{if(!client.deviceMode()||store.blocked()){message="请先重新验证设备，本机记录保留";return false;}}
        catch(Exception error){message="本机外部队列无法读取，请暂停并导出备份";return false;}
        if(requested.compareAndSet(false,true))worker.execute(()->{try{authenticated=true;retryAt=0;drain();}finally{requested.set(false);}});return true;
    }
    private JSONObject body(JSONObject response) throws Exception {
        int status=response.optInt("status");if(status==401||status==403){deviceBlocked();throw new Exception(response.optString("error",message));}
        if(status<200||status>=300||!response.has("body"))throw new Exception(response.optString("error","云端尚未确认，外部码保留本机并自动重试"));return response.getJSONObject("body");
    }
    private void drain(){for(int i=0;i<5;i++)if(!tick())return;}
    private boolean tick(){
        if(!authenticated||!client.deviceMode()||System.currentTimeMillis()<retryAt)return false;
        try{
            if(store.blocked())return false;
            JSONObject batch=store.nextBatch();if(batch==null){message="外部采集已同步，等待下一次扫码";return false;}
            if(!store.compatible(batch.getString("server"))&&!store.canReplayCompletion(batch))throw new Exception("旧采集归属与当前设备登记不一致，请恢复原登记同步；本机记录保留");
            String id=batch.getString("id"),base="/api/device/external-collections";
            if(batch.optInt("registered")==0){
                JSONObject result=body(client.request("POST",base,new JSONObject().put("batchId",id).put("workerNo",batch.getString("worker_no")).put("lineName",batch.getString("line_name")).toString()));store.registered(id,result);message="外部采集批次已登记，正在同步完整原文";
            }else{
                JSONArray events=store.pending(id,20);
                if(events.length()>0){
                    JSONObject result=body(client.request("POST",base+"/"+id+"/events",new JSONObject().put("events",events).toString()));store.acknowledge(id,result);
                    if(!result.optBoolean("ok")){if(result.optInt("statusCode")==401||result.optInt("statusCode")==403)deviceBlocked();throw new Exception(result.optString("message","部分外部码未确认，保留原事件继续重试"));}
                    message="云端已确认本段外部记录，本机原文继续保留";
                }else if("sealed".equals(batch.getString("state"))){
                    JSONObject result=body(client.request("POST",base+"/"+id+"/complete",new JSONObject().put("lastSequence",batch.getInt("final_seq")).toString()));store.completed(id,result);message="本次外部采集已完整上传，可在后台补填生产资料并导出";
                }else{message="扫码持续自动上传；点击“完成本次采集”固定批次";return false;}
            }
            failures=0;retryAt=0;return true;
        }catch(Exception error){message=error.getMessage()==null?"外部同步未确认，本机记录保留":error.getMessage();failures=Math.min(4,failures+1);retryAt=System.currentTimeMillis()+Math.min(30000,2000L*(1L<<failures));return false;}
    }
}
