package com.regcode.app;
import android.content.*;
import android.net.*;
import org.json.*;
import com.regcode.collection.WorkerStore;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.security.SecureRandom;
/** 上传使用设备身份；各历史会话携带原工人授权，交班不会把旧记录改成新工人。 */
public final class WorkerEngine {
 private static WorkerEngine instance;
 public final WorkerStore store;private final WorkerVault vault;private final ProductionClient client;
 private final Context context;private final SharedPreferences prefs;private final ScheduledExecutorService executor=Executors.newSingleThreadScheduledExecutor();
 private final AtomicBoolean forced=new AtomicBoolean();private volatile String message="请登录工人账号";private volatile boolean blocked;private long retryAt;
 private volatile JSONObject forcedLimits=new JSONObject();
 private volatile boolean registrationRequired;private volatile long nextDeviceCheck;private volatile long nextHeartbeat;private volatile boolean wasOnline;
 private final ExecutorService actions=Executors.newSingleThreadExecutor();
 private volatile boolean capturing;
 private WorkerEngine(Context c)throws Exception{context=c.getApplicationContext();prefs=context.getSharedPreferences("production",Context.MODE_PRIVATE);store=new WorkerStore(new QueueDatabase(context));vault=new WorkerVault(prefs);client=new ProductionClient(BuildConfig.ALLOW_LOCAL_HTTP);credentials();executor.scheduleWithFixedDelay(this::tick,1,2,TimeUnit.SECONDS);
  ConnectivityManager cm=(ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);if(cm!=null)cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback(){@Override public void onAvailable(Network network){requestSync();}});
 }
 public static synchronized WorkerEngine get(Context c)throws Exception{if(instance==null)instance=new WorkerEngine(c);return instance;}
 private String fingerprint="";
 public synchronized void credentials()throws Exception{String server=prefs.getString("server",BuildConfig.DEFAULT_SERVER);client.configure(server);JSONObject data=new DeviceCredentials(prefs).read();if(!client.restoreRegisteredDevice(server,data)){fingerprint="";blocked=true;registrationRequired=true;message="请扫描后台设备激活二维码；本机记录保留";return;}String value=data.getString("credential");byte[] digest=java.security.MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));fingerprint=android.util.Base64.encodeToString(digest,android.util.Base64.NO_WRAP);if(!fingerprint.equals(store.meta("deviceFingerprint",""))){store.putMeta("cache","{}");store.putMeta("deviceFingerprint",fingerprint);vault.logout();store.putMeta("deviceBlocked","0");store.putMeta("deviceRegistrationRequired","0");store.putMeta("nextCache","0");retryAt=0;}blocked="1".equals(store.meta("deviceBlocked","0"));registrationRequired="1".equals(store.meta("deviceRegistrationRequired","0"));nextDeviceCheck=0;if(new JSONObject(store.meta("cache","{}")).optInt("stockVersion")<3||new JSONObject(store.meta("cache","{}")).optInt("productionScanVersion")<1)store.putMeta("nextCache","0");}
 /** 只依据设备核验接口判断登记；工人401、业务403和断网都不当作删除设备。 */
 private synchronized JSONObject verifyDevice()throws Exception{
  JSONObject response=client.request("GET","/api/device/context","{}");int status=response.optInt("status");nextDeviceCheck=android.os.SystemClock.elapsedRealtime()+30000;
  if(status==401){registrationRequired=true;blocked=true;capturing=false;store.putMeta("deviceRegistrationRequired","1");store.putMeta("deviceBlocked","1");message="设备登记已失效，请重新扫码激活；本机记录保留";throw new Exception(message);}
  if(status==403){registrationRequired=false;blocked=true;capturing=false;store.putMeta("deviceRegistrationRequired","0");store.putMeta("deviceBlocked","1");message=response.optString("error","设备已停用，请联系管理员；本机记录保留");throw new Exception(message);}
  JSONObject result=body(response);if(result.getJSONObject("device").getLong("id")<=0)throw new Exception("设备核验未完成，本机记录保留");registrationRequired=false;blocked=false;store.putMeta("deviceRegistrationRequired","0");store.putMeta("deviceBlocked","0");return result;
 }
 public void checkDeviceSoon(){nextDeviceCheck=0;retryAt=0;}
 public boolean registrationRequired(){return registrationRequired;}
 private long now()throws Exception{long value=System.currentTimeMillis()+Long.parseLong(store.meta("serverOffset","0")),high=Long.parseLong(store.meta("timeHigh","0"));if(value+60000<high)throw new Exception("设备时间回退，请先联网核验");if(value>high)store.putMeta("timeHigh",Long.toString(value));return value;}
 private void serverTime(long time)throws Exception{store.putMeta("serverOffset",Long.toString(time-System.currentTimeMillis()));store.putMeta("timeHigh",Long.toString(time));}
 private JSONObject body(JSONObject response)throws Exception{int status=response.optInt("status");if(status<200||status>=300||!response.has("body"))throw new Exception(response.optString("error","云端尚未确认，本机数据保留"));return response.getJSONObject("body");}
 public JSONObject login(String username,String password)throws Exception{
  if(client.deviceMode()){
   try{verifyDevice();}catch(Exception error){if(blocked)throw error;}
  }
  JSONObject response=client.request("POST","/api/device/operator/login",new JSONObject().put("username",username).put("password",password).toString());
  if(response.optInt("status")==200){JSONObject data=body(response);serverTime(data.getLong("serverTime"));data.put("deviceFingerprint",fingerprint);vault.online(data,password);store.putMeta("deviceId",Long.toString(data.getJSONObject("device").getLong("id")));store.putMeta("deviceLabel",data.getJSONObject("device").toString());blocked=false;store.putMeta("deviceBlocked","0");message="登录成功，正在同步缓存";requestSync();}
  else if(response.optInt("status")==0){if(blocked)throw new Exception("设备已停用，须联网确认后使用");vault.offline(username,password,now(),Long.parseLong(store.meta("deviceId","0")),fingerprint);message="离线登录，使用已缓存产品及码清单";}
  else {if(response.optInt("status")==401||response.optInt("status")==403)verifyDevice();throw new Exception(response.optString("error","工人登录未通过"));}
  return snapshot();
 }
 public void logout()throws Exception{capturing=false;JSONObject p=vault.current();if(p!=null&&store.currentSession(p.getJSONObject("identity").getLong("id"))!=null)throw new Exception("请先结束本机采集，再退出登录");vault.logout();requestSync();}
 public JSONObject start(JSONObject context)throws Exception{vault.check(now());if(blocked)throw new Exception("设备已停用或认证失效");JSONObject r=store.start(context,vault.current(),now());if(context.optBoolean("autoLine")){registerAutomatic();r=store.currentRun();}else if(context.optBoolean("stockWorkflow"))requestSync();startService();return r;}
 public void resume(String id)throws Exception{vault.check(now());if(blocked)throw new Exception("设备已停用");store.resume(id,vault.current(),now());if(store.currentRun().getJSONObject("context").optBoolean("autoLine"))registerAutomatic();startService();}
 public void captureEnabled(boolean value){try{JSONObject r=store.currentRun();if(value&&r!=null&&r.getJSONObject("context").optBoolean("autoLine")){JSONObject s=store.currentSession(userId());if(r.getJSONObject("context").optLong("taskId")<=0||s==null||s.optInt("server_open")==0){capturing=false;message="请联网登记生产线后开始采集";return;}}capturing=value;nextHeartbeat=0;}catch(Exception error){capturing=false;message=error.getMessage();}}
 public JSONObject capture(String raw)throws Exception{if(!capturing||blocked)throw new Exception("扫码已暂停，请先开始采集");vault.check(now());return store.capture(raw,vault.current(),now());}
 public void finish()throws Exception{capturing=false;if(vault.current()==null)throw new Exception("请登录原工人账号结束本机采集");store.finish(vault.current().getJSONObject("identity").getLong("id"));nextHeartbeat=0;requestSync();}
 public JSONObject snapshot()throws Exception{JSONObject p=vault.current();JSONObject s=store.snapshot(p==null?0:p.getJSONObject("identity").getLong("id"));s.put("identity",p==null?JSONObject.NULL:p.getJSONObject("identity")).put("expiresAt",p==null?0:p.getLong("expiresAt")).put("device",new JSONObject(store.meta("deviceLabel","{}"))).put("blocked",blocked).put("registrationRequired",registrationRequired).put("unconfirmedWork",store.hasUnconfirmedWork()).put("message",message).put("nextUpload",Long.parseLong(store.meta("nextUpload","0"))).put("networkAvailable",networkAvailable()).put("ok",true);return s;}
 public boolean networkAvailable(){ConnectivityManager cm=(ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);if(cm==null)return false;Network n=cm.getActiveNetwork();NetworkCapabilities caps=n==null?null:cm.getNetworkCapabilities(n);return caps!=null&&caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);}
 public JSONObject finishInfo()throws Exception{JSONObject value=snapshot(),r=store.currentRun();if(r!=null&&r.getJSONObject("context").optLong("taskId")>0&&vault.current()!=null){try{JSONObject data=new JSONObject().put("taskId",r.getJSONObject("context").getLong("taskId")).put("grant",vault.current().getString("grant"));JSONObject response=body(client.request("POST","/api/device/line-progress",data.toString()));value.put("cloudProgress",response).put("cloudReachable",true);}catch(Exception error){value.put("cloudReachable",false).put("cloudError",error.getMessage());}}return value;}
 public void backup(java.io.OutputStream stream,long userId)throws Exception{store.backup(stream,userId);}
 public long userId()throws Exception{if(vault.current()==null)throw new Exception("请先登录工人账号");return vault.current().getJSONObject("identity").getLong("id");}
 public synchronized void requestSync(){try{JSONObject limits=new JSONObject();JSONArray sessions=store.sessions();for(int i=0;i<sessions.length();i++){JSONObject s=sessions.getJSONObject(i);limits.put(s.getString("id"),s.getInt("next_seq")-1);}forcedLimits=limits;}catch(Exception ignored){return;}forced.set(true);retryAt=0;}
 private void startService(){Intent intent=new Intent(context,WorkerSyncService.class);context.startForegroundService(intent);}
 private void tick(){
  try{if(!client.deviceMode())return;boolean online=networkAvailable();if(online&&!wasOnline)requestSync();wasOnline=online;if(!online){message="当前离线，本机记录保留，联网后自动补传";return;}if(android.os.SystemClock.elapsedRealtime()>=nextDeviceCheck)verifyDevice();if(blocked)return;long time;try{time=now();}catch(Exception rollback){capturing=false;JSONObject verified=verifyDevice();serverTime(verified.getLong("serverTime"));time=now();}long due=Long.parseLong(store.meta("nextUpload","0")),cacheDue=Long.parseLong(store.meta("nextCache","0"));
   if(android.os.SystemClock.elapsedRealtime()>=nextHeartbeat){try{heartbeat();nextHeartbeat=android.os.SystemClock.elapsedRealtime()+30000;}catch(Exception ignored){nextHeartbeat=android.os.SystemClock.elapsedRealtime()+5000;}}
   if(android.os.SystemClock.elapsedRealtime()<retryAt)return;boolean force=forced.getAndSet(false);
   if(force||time>=due){if(upload(force&&time<due?forcedLimits:null))store.putMeta("nextUpload",Long.toString(now()+600000+new SecureRandom().nextInt(300001)));else{retryAt=android.os.SystemClock.elapsedRealtime()+5000;if(force)forced.set(true);}}
   if(force||time>=cacheDue){refreshCache();store.putMeta("nextCache",Long.toString(now()+900000));}
  }catch(Exception error){message=error.getMessage()==null?"上传尚未确认，本机保留":error.getMessage();retryAt=android.os.SystemClock.elapsedRealtime()+5000;}
 }
 private void registerAutomatic()throws Exception{
  JSONObject r=store.currentRun(),s=store.currentSession(userId());if(s==null)throw new Exception("采集会话不存在");if(s.optInt("server_open")==1&&r.getJSONObject("context").optLong("taskId")>0)return;
  if(!networkAvailable())throw new Exception("首次加入本轮生产线需要联网；登记后可以离线采集");
  JSONObject result=request("/api/device/worker-sessions",new JSONObject().put("runId",r.getString("id")).put("sessionId",s.getString("id")).put("context",r.getJSONObject("context")).put("grant",vault.grant(s.getString("grant_id"))).put("startedAt",s.getString("started_at")));
  if(!s.getString("id").equals(result.getString("sessionId")))throw new Exception("生产线登记收据不一致");store.automaticOpened(s.getString("id"),result.getJSONObject("context"));
 }
 private void heartbeat()throws Exception{
  JSONArray rows=store.heartbeatReports(capturing,vault.current()==null?0:userId());for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);request("/api/device/worker-sessions/"+row.getString("sessionId")+"/heartbeat",row);}
 }
 private JSONObject request(String path,JSONObject data)throws Exception{JSONObject r=client.request("POST",path,data.toString());if(r.optInt("status")==401||r.optInt("status")==403){capturing=false;verifyDevice();}return body(r);}
 private boolean upload(JSONObject limits)throws Exception{
  JSONArray sessions=store.sessions();
  boolean partial=false;
  for(int i=0;i<sessions.length();i++){
   JSONObject s=sessions.getJSONObject(i),r=s.getJSONObject("run");String id=s.getString("id");
   if(limits!=null&&!limits.has(id))continue;
   int maximum=limits==null?Integer.MAX_VALUE:limits.getInt(id);
   try{
   if(r.getJSONObject("context").optBoolean("lineWorkflow")&&r.getJSONObject("context").optLong("taskId")==0&&"open".equals(r.getString("state")))continue;
   if(s.getInt("server_open")==0){JSONObject result=request("/api/device/worker-sessions",new JSONObject().put("runId",r.getString("id")).put("sessionId",id).put("context",r.getJSONObject("context")).put("grant",vault.grant(s.getString("grant_id"))).put("startedAt",s.getString("started_at")));if(!id.equals(result.getString("sessionId")))throw new Exception("会话创建收据不一致");store.opened(id);}
   JSONArray pending;int pages=0;while((pending=store.pending(id,20,maximum)).length()>0&&pages++<10000){JSONObject ack=request("/api/device/worker-sessions/"+id+"/events",new JSONObject().put("events",pending));store.acknowledge(id,ack);message="云端已保存，本机记录继续保留";}
   if("closing".equals(s.getString("state"))&&store.pending(id,1).length()==0){try{heartbeat();}catch(Exception ignored){}JSONObject end=request("/api/device/worker-sessions/"+id+"/complete",new JSONObject().put("lastSequence",s.getInt("final_seq")).put("stoppedAt",s.isNull("stopped_at")?JSONObject.NULL:s.getString("stopped_at")));if(!id.equals(end.getString("sessionId")))throw new Exception("工人结束收据不一致");store.completed(id,end.getInt("lastSequence"));}
   }catch(Exception error){partial=true;message="部分批次尚未确认："+error.getMessage();store.putMeta("syncError:"+id,String.valueOf(error.getMessage()));}
  }
  JSONArray runs=store.closingRuns();for(int i=0;i<runs.length();i++){JSONObject r=runs.getJSONObject(i),ack=request("/api/device/worker-runs/"+r.getString("id")+"/complete",new JSONObject().put("sessions",r.getJSONArray("sessions")));if(!r.getString("id").equals(ack.getString("runId"))||!"sealed".equals(ack.getString("state")))throw new Exception("整批结束收据不一致");store.runDone(r.getString("id"));}
  if(!partial)message=store.snapshot(0).getLong("allWaiting")>0?"本机仍有待上传记录，联网后补传；原始数据继续保留":"本轮记录已由服务器确认；本机原始数据继续保留";
  return !partial;
 }
 private void refreshCache()throws Exception{
  JSONObject dc=verifyDevice();store.putMeta("deviceId",dc.getJSONObject("device").get("id").toString());
  JSONObject d=dc.getJSONObject("device");store.putMeta("deviceLabel",new JSONObject().put("id",d.get("id")).put("name",d.get("name")).put("lineName",d.get("line_name")).put("enterpriseName",d.get("enterprise_name")).toString());
  if(vault.current()!=null){JSONObject check=client.request("POST","/api/device/operator/check",new JSONObject().put("grant",vault.current().getString("grant")).toString());if(check.optInt("status")==401||check.optInt("status")==403){capturing=false;vault.revokeCurrent();throw new Exception("工人授权已失效，请重新登录，已有记录保留");}vault.refresh(body(check).getLong("expiresAt"));}
  String id="";JSONObject info=new JSONObject();
  for(String kind:new String[]{"products","pools","codes"}){int offset=0;while(true){String path="/api/device/worker-cache?workflow=line&monitor=1&kind="+kind+"&offset="+offset+(id.isEmpty()?"":"&id="+id);JSONObject page=body(client.request("GET",path,"{}"));if(id.isEmpty()){id=page.getString("id");info.put("id",id).put("productionScanVersion",page.optInt("productionScanVersion")).put("stockVersion",page.optInt("stockVersion")).put("createdAt",page.getLong("createdAt")).put("expiresAt",page.getLong("expiresAt")).put("traceBaseUrl",page.optString("traceBaseUrl",com.regcode.collection.TraceUrlPolicy.DEFAULT_BASE));serverTime(page.getLong("serverTime"));}else if(!id.equals(page.getString("id")))throw new Exception("缓存快照版本不一致");store.stage(id,kind,page.getJSONArray("rows"));info.put(kind,page.getInt("total"));if(page.isNull("next"))break;offset=page.getInt("next");}}
  store.commitCache(info);blocked=false;
 }
 public String exportProduction(String run)throws Exception{
  JSONArray sessions=store.productionExport(run,userId());StringBuilder text=new StringBuilder("NZ315-PRODUCTION-RECORDS/1\n");
  for(int i=0;i<sessions.length();i++){JSONObject data=sessions.getJSONObject(i);String payload=data.toString();javax.crypto.Mac mac=javax.crypto.Mac.getInstance("HmacSHA256");mac.init(new javax.crypto.spec.SecretKeySpec(vault.exportKey(data.getString("grantId")).getBytes(java.nio.charset.StandardCharsets.UTF_8),"HmacSHA256"));byte[] digest=mac.doFinal(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8));StringBuilder sig=new StringBuilder();for(byte b:digest)sig.append(String.format(java.util.Locale.ROOT,"%02x",b&255));text.append(new JSONObject().put("payload",payload).put("signature",sig.toString()).toString()).append('\n');}
  return text.toString();
 }
 public JSONObject exportExternal(String run)throws Exception{return store.externalExport(run,userId());}
 public void async(Runnable runnable){actions.execute(runnable);}
}
