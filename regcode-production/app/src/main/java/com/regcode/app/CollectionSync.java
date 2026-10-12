package com.regcode.app;

import com.regcode.collection.QueueStore;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** 独立于采集线程的持久化发件队列，每批20条；收据丢失时重放相同事件ID。 */
public final class CollectionSync {
    private final QueueStore store;
    private final ProductionClient client;
    private final ScheduledExecutorService worker=Executors.newSingleThreadScheduledExecutor();
    private volatile boolean authenticated;
    private volatile boolean blocked;
    private volatile boolean loginRequired=true;
    private final AtomicBoolean requested=new AtomicBoolean();
    private volatile String message="正在等待认证，本机记录已保留";
    private volatile long retryAt;
    private int failures;
    public CollectionSync(QueueStore store,ProductionClient client) {
        this(store,client,true);
    }
    CollectionSync(QueueStore store,ProductionClient client,boolean automatic) {
        this.store=store;this.client=client;if(automatic)worker.scheduleWithFixedDelay(this::drain,1,2,TimeUnit.SECONDS);
    }
    public void authenticated(boolean value){authenticated=value;loginRequired=!value;retryAt=0;if(value)blocked=false;}
    public void deviceBlocked(){blocked=true;authenticated=false;loginRequired=true;}
    public boolean blocked(){return blocked;}
    public boolean loginRequired(){return loginRequired || !client.hasSession();}
    /** 手动上传沿用Cookie；只唤醒同一串行上传线程，不修改采集状态或创建新事件。 */
    public boolean uploadNow(){
        if(!client.hasSession()){authenticated=false;loginRequired=true;message="登录已失效，请重新登录；本机记录已保留";return false;}
        if(requested.compareAndSet(false,true)){
            worker.execute(()->{
                try{authenticated=true;loginRequired=false;retryAt=0;message="正在上传云端，本机采集可继续";drain();}
                finally{requested.set(false);}
            });
        }
        return true;
    }
    public String message(){return message;}
    public void stop(){worker.shutdownNow();}
    private void drain(){for(int i=0;i<5;i++){tick();if(!authenticated || System.currentTimeMillis()<retryAt)return;try{if(store.pending(1).length()==0)return;}catch(Exception ignored){return;}}}
    private JSONObject body(JSONObject response)throws Exception {
        int status=response.optInt("status");
        if(status==401){authenticated=false;loginRequired=true;if(client.deviceMode())deviceBlocked();throw new Exception(client.deviceMode()?"设备认证失效，请联系管理员；本机记录已保留":"登录已失效，请重新登录原账号；本机记录已保留");}
        if(status==403){authenticated=false;if(client.deviceMode())deviceBlocked();throw new Exception(response.optString("error","设备或账号无权上传此任务；本机记录已保留"));}
        if(status<200 || status>=300 || !response.has("body"))throw new Exception(response.optString("error","云端尚未确认，自动重试"));
        return response.getJSONObject("body");
    }
    private void tick(){
        if(!authenticated || System.currentTimeMillis()<retryAt)return;
        try {
            JSONObject session=store.current();if(session==null){message="暂无待同步的采集任务";return;}
            String base="/api/admin/production-tasks/"+session.getLong("task_id")+"/collection-sessions",id=session.getString("id"),phase=session.getString("phase");
            if("starting".equals(phase)) {
                JSONObject result=body(client.request("POST",base,new JSONObject().put("sessionId",id).put("device",session.getJSONObject("context").getString("device")).toString()));
                store.activate(result);message="领用清单已缓存，可以连续采集";
            } else {
                JSONArray events=store.pending(20);
                if(events.length()>0) {
                    JSONObject result=body(client.request("POST",base+"/"+id+"/events",new JSONObject().put("events",events).toString()));
                    store.acknowledge(result);
                    if(!result.optBoolean("ok")) {
                        if(result.optInt("statusCode")==401){authenticated=false;loginRequired=true;}
                        else if(result.optInt("statusCode")==403){authenticated=false;if(client.deviceMode())deviceBlocked();}
                        throw new Exception(result.optString("message","部分记录未确认，本机保留并重试"));
                    }
                    message="云端已确认本次"+events.length()+"条记录，本机备份继续保留";
                } else if("closing".equals(phase)) {
                    JSONObject result=body(client.request("POST",base+"/"+id+"/complete",new JSONObject().put("lastSequence",session.getInt("final_seq")).put("endTask",session.getInt("end_task")==1).toString()));
                    store.complete(result);message=result.optBoolean("taskEnded")?"已全部同步，本批生产已结束":result.optInt("otherDevices")>0?"本机采集已结束，其他设备仍在采集":"本机采集已结束，任务可在后台继续管理";
                } else message="本机记录已全部上传云端，本机备份继续保留";
            }
            failures=0;retryAt=0;
        } catch(Exception error){message=error.getMessage()==null?"自动同步暂未确认，本机数据保留":error.getMessage();failures=Math.min(4,failures+1);retryAt=System.currentTimeMillis()+Math.min(30000,2000L*(1L<<failures));}
    }
}
