package com.regcode.collection;
import org.json.*;
import java.util.*;
import java.time.Instant;
import java.io.*;
import java.nio.charset.StandardCharsets;
/** 新流程使用独立表，旧session/event队列原样保留。工人可以轮换，设备不绑定固定员工。 */
public final class WorkerStore {
 private final QueueStore.Sql db;
 public WorkerStore(QueueStore.Sql db)throws Exception{
  this.db=db;
  db.exec("CREATE TABLE IF NOT EXISTS ww_line_code(run_id TEXT NOT NULL,code TEXT NOT NULL,task_id INTEGER NOT NULL,task_json TEXT NOT NULL,PRIMARY KEY(run_id,code))");
  db.exec("CREATE TABLE IF NOT EXISTS ww_line_usage(task_id INTEGER NOT NULL,code TEXT NOT NULL,event_id TEXT NOT NULL,PRIMARY KEY(task_id,code))");
  db.exec("CREATE TABLE IF NOT EXISTS ww_meta(k TEXT PRIMARY KEY,v TEXT NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS ww_catalog(snapshot TEXT NOT NULL,kind TEXT NOT NULL,key TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(snapshot,kind,key))");
  db.exec("CREATE TABLE IF NOT EXISTS ww_run(id TEXT PRIMARY KEY,pool_id TEXT UNIQUE,mode TEXT NOT NULL,context TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'open',cloud_done INTEGER NOT NULL DEFAULT 0)");
  db.exec("CREATE TABLE IF NOT EXISTS ww_allowed(run_id TEXT NOT NULL,code TEXT NOT NULL,PRIMARY KEY(run_id,code))");
  db.exec("CREATE TABLE IF NOT EXISTS ww_session(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id INTEGER NOT NULL,identity TEXT NOT NULL,grant_id TEXT NOT NULL,started_at TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'active',server_open INTEGER NOT NULL DEFAULT 0,next_seq INTEGER NOT NULL DEFAULT 1,final_seq INTEGER)");
  db.exec("CREATE TABLE IF NOT EXISTS ww_event(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,run_id TEXT NOT NULL,seq INTEGER NOT NULL,code TEXT,dedup TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,receipt TEXT,result TEXT,UNIQUE(session_id,seq))");
  boolean hasStop=false;for(JSONObject column:db.rows("PRAGMA table_info(ww_session)"))if("stopped_at".equals(column.getString("name")))hasStop=true;if(!hasStop)db.exec("ALTER TABLE ww_session ADD COLUMN stopped_at TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS ww_event_code ON ww_event(run_id,dedup,kind)");
  db.exec("CREATE TABLE IF NOT EXISTS ww_known(snapshot TEXT NOT NULL,code TEXT NOT NULL,PRIMARY KEY(snapshot,code))");
 }
 public synchronized String meta(String key,String fallback)throws Exception{List<JSONObject> r=db.rows("SELECT v FROM ww_meta WHERE k=?",key);return r.isEmpty()?fallback:r.get(0).getString("v");}
 public synchronized void putMeta(String key,String value)throws Exception{db.exec("INSERT OR REPLACE INTO ww_meta(k,v) VALUES(?,?)",key,value);}
 public synchronized void stage(String snapshot,String kind,JSONArray rows)throws Exception{
  db.transaction(()->{for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);String key="codes".equals(kind)?r.getString("pool_id")+":"+r.getString("code"):String.valueOf(r.get("id"));db.exec("INSERT OR REPLACE INTO ww_catalog(snapshot,kind,key,data) VALUES(?,?,?,?)",snapshot,kind,key,r.toString());if("codes".equals(kind))db.exec("INSERT OR IGNORE INTO ww_known(snapshot,code) VALUES(?,?)",snapshot,r.getString("code"));}return null;});
 }
 public synchronized void commitCache(JSONObject info)throws Exception{
  db.transaction(()->{String id=info.getString("id");for(String kind:new String[]{"products","pools","codes"}){long count=db.rows("SELECT COUNT(*) AS n FROM ww_catalog WHERE snapshot=? AND kind=?",id,kind).get(0).getLong("n");if(count!=info.getLong(kind))throw new Exception("缓存未完整下载，保留原快照");}
   putMeta("cache",info.toString());db.exec("DELETE FROM ww_catalog WHERE snapshot<>?",id);db.exec("DELETE FROM ww_known WHERE snapshot<>?",id);return null;});
 }
 public synchronized JSONArray catalog(String kind)throws Exception{
  JSONObject info=new JSONObject(meta("cache","{}"));JSONArray result=new JSONArray();if(!info.has("id"))return result;
  for(JSONObject r:db.rows("SELECT data FROM ww_catalog WHERE snapshot=? AND kind=? ORDER BY key",info.getString("id"),kind))result.put(new JSONObject(r.getString("data")));return result;
 }
 private JSONObject run(String id)throws Exception{List<JSONObject> r=db.rows("SELECT * FROM ww_run WHERE id=?",id);if(r.isEmpty())return null;JSONObject v=r.get(0);v.put("context",new JSONObject(v.getString("context")));return v;}
 public synchronized JSONObject currentRun()throws Exception{return run(meta("currentRun",""));}
 // 即使事件已收齐，未结束原批或缺整批结束收据时仍不可换服务器及重新激活。
 public synchronized boolean hasUnconfirmedWork()throws Exception{return !db.rows("SELECT id FROM ww_run WHERE state='open' OR cloud_done=0 LIMIT 1").isEmpty();}
 public synchronized JSONObject currentSession(long userId)throws Exception{
  List<JSONObject> r=db.rows("SELECT * FROM ww_session WHERE run_id=? AND user_id=? AND state='active' ORDER BY rowid DESC LIMIT 1",meta("currentRun",""),userId);return r.isEmpty()?null:r.get(0);
 }
 public synchronized JSONObject start(JSONObject context,JSONObject profile,long now)throws Exception{
  return db.transaction(()->{
   String mode=context.getString("mode"),pool=null;JSONObject r;
   if("production".equals(mode)&&context.optBoolean("stockWorkflow")){
    JSONObject cache=new JSONObject(meta("cache","{}"));if(cache.optLong("expiresAt")<now)throw new Exception("产品缓存已过期，请联网更新");if(cache.optInt("stockVersion")<2)throw new Exception("产品校验资料正在升级，请联网等待完整下载后开始");
    JSONObject product=null;JSONArray products=catalog("products");for(int i=0;i<products.length();i++)if(products.getJSONObject(i).getLong("id")==context.getLong("productId"))product=products.getJSONObject(i);
    if(product==null)throw new Exception("请选择本厂启用的产品");String head=product.optString("code_head");if(!head.matches("[0-9]{11}"))throw new Exception("产品未配置有效的登记证或规格，请联系管理员");
    JSONObject selected=null;JSONArray tasks=catalog("pools");for(int i=0;i<tasks.length();i++){JSONObject t=tasks.getJSONObject(i);if(t.optLong("task_id")!=context.getLong("taskId"))continue;JSONArray people=t.optJSONArray("memberIds");boolean assigned=people==null;for(int j=0;people!=null&&j<people.length();j++)if(people.getLong(j)==profile.getJSONObject("identity").getLong("id"))assigned=true;if(assigned)selected=t;}
    if(context.optBoolean("autoLine")){if(new JSONObject(meta("cache","{}")).optInt("stockVersion")<3)throw new Exception("请联网更新产品信息后再开工");String line=context.optString("lineName").trim();if(line.isEmpty()||line.length()>100)throw new Exception("请填写或选择生产线");selected=new JSONObject().put("line_name",line).put("task_name",line);}else if(selected==null)throw new Exception("请选择已安排你参与的生产线");
    r=null;for(JSONObject row:db.rows("SELECT id,context FROM ww_run WHERE mode='production' AND state='open' ORDER BY rowid DESC")){JSONObject c=new JSONObject(row.getString("context"));if(!c.optBoolean("stockWorkflow")||c.optLong("productId")!=context.getLong("productId")||c.optLong("taskId")!=context.getLong("taskId")||(context.optBoolean("autoLine")&&!c.optString("lineName").equals(context.optString("lineName")))||db.rows("SELECT id FROM ww_session WHERE run_id=? AND user_id=? LIMIT 1",row.getString("id"),profile.getJSONObject("identity").getLong("id")).isEmpty())continue;for(String k:new String[]{"batchNo","produceDate","expireDate"})if(!c.getString(k).equals(context.getString(k)))throw new Exception("原批未结束，请继续原批，不能改生产资料");r=run(row.getString("id"));break;}
    if(r==null){String id=UUID.randomUUID().toString();JSONObject c=new JSONObject(context.toString()).put("codeHead",head).put("lineName",selected.getString("line_name")).put("taskName",selected.getString("task_name"));db.exec("INSERT INTO ww_run(id,pool_id,mode,context) VALUES(?,NULL,?,?)",id,mode,c.toString());
     r=run(id);
    }
   }else if("production".equals(mode)&&context.optBoolean("lineWorkflow")){
    JSONObject info=new JSONObject(meta("cache","{}"));if(info.optLong("expiresAt")<now)throw new Exception("产品及任务码缓存已过期，请联网更新");
    List<JSONObject> existing=db.rows("SELECT id,context FROM ww_run WHERE mode='production' AND state='open' ORDER BY rowid DESC");r=null;
    for(JSONObject row:existing){JSONObject old=new JSONObject(row.getString("context"));if(db.rows("SELECT id FROM ww_session WHERE run_id=? AND user_id=? LIMIT 1",row.getString("id"),profile.getJSONObject("identity").getLong("id")).isEmpty())continue;if(old.optBoolean("lineWorkflow")&&old.optLong("productId")==context.getLong("productId")){for(String k:new String[]{"batchNo","produceDate","expireDate"})if(!old.getString(k).equals(context.getString(k)))throw new Exception("此产品原批尚未结束，请继续原批，不能修改生产资料");r=run(row.getString("id"));break;}}
    if(r==null){
     String id=UUID.randomUUID().toString();JSONObject c=new JSONObject(context.toString()).put("taskId",0);c.remove("poolId");db.exec("INSERT INTO ww_run(id,pool_id,mode,context) VALUES(?,NULL,?,?)",id,mode,c.toString());
     JSONArray pools=catalog("pools"),codes=catalog("codes");Map<String,JSONObject> tasks=new HashMap<>();for(int i=0;i<pools.length();i++){JSONObject task=pools.getJSONObject(i);boolean assigned=true;JSONArray people=task.optJSONArray("memberIds");if(people!=null){assigned=false;for(int mi=0;mi<people.length();mi++)if(people.getLong(mi)==profile.getJSONObject("identity").getLong("id"))assigned=true;}if(assigned&&task.optLong("product_id")==c.getLong("productId")&&task.has("task_id"))tasks.put(task.getString("id"),task);}
     for(int i=0;i<codes.length();i++){JSONObject code=codes.getJSONObject(i),task=tasks.get(code.getString("pool_id"));if(task!=null&&"reserved".equals(code.getString("state"))){db.exec("INSERT INTO ww_line_code(run_id,code,task_id,task_json) VALUES(?,?,?,?)",id,code.getString("code"),task.getLong("task_id"),task.toString());db.exec("INSERT INTO ww_allowed(run_id,code) VALUES(?,?)",id,code.getString("code"));}}
     if(db.rows("SELECT code FROM ww_allowed WHERE run_id=? LIMIT 1",id).isEmpty())throw new Exception("所选产品没有已缓存的任务领用码，请联网更新任务清单");r=run(id);
    }
   }else if("production".equals(mode)){
    JSONObject info=new JSONObject(meta("cache","{}"));if(info.optLong("expiresAt")<now)throw new Exception("产品及码池缓存已过期，请先联网更新");
    pool=context.getString("poolId");List<JSONObject> matches=db.rows("SELECT * FROM ww_run WHERE pool_id=?",pool);
    if(!matches.isEmpty()){
     r=run(matches.get(0).getString("id"));if(!"open".equals(r.getString("state")))throw new Exception("本产品余码尚待审核，不能用于下一批");
     JSONObject c=r.getJSONObject("context");for(String k:new String[]{"productId","batchNo","produceDate","expireDate"})if(!String.valueOf(c.get(k)).equals(String.valueOf(context.get(k))))throw new Exception("原批次尚未结束，请继续原批或先结束，不得修改已采集资料");
    }else{
     JSONObject selected=null;JSONArray pools=catalog("pools");for(int pi=0;pi<pools.length();pi++){JSONObject row=pools.getJSONObject(pi);if(pool.equals(row.getString("id"))&&row.getLong("product_id")==context.getLong("productId"))selected=row;}
     if(selected==null||!"ready".equals(selected.getString("state")))throw new Exception("此产品没有可开始的预配码清单");
     String id=UUID.randomUUID().toString();db.exec("INSERT INTO ww_run(id,pool_id,mode,context) VALUES(?,?,?,?)",id,pool,mode,context.toString());
     JSONObject cache=new JSONObject(meta("cache","{}"));
     for(JSONObject code:db.rows("SELECT data FROM ww_catalog WHERE snapshot=? AND kind='codes' AND key LIKE ?",cache.getString("id"),pool+":%")){JSONObject c=new JSONObject(code.getString("data"));if("reserved".equals(c.getString("state")))db.exec("INSERT INTO ww_allowed(run_id,code) VALUES(?,?)",id,c.getString("code"));}
     if(db.rows("SELECT code FROM ww_allowed WHERE run_id=? LIMIT 1",id).isEmpty())throw new Exception("预配码清单为空，不能开始生产");r=run(id);
    }
   }else{String id=UUID.randomUUID().toString();db.exec("INSERT INTO ww_run(id,pool_id,mode,context) VALUES(?,NULL,?,?)",id,mode,context.toString());r=run(id);}
   putMeta("currentRun",r.getString("id"));JSONObject s=currentSession(profile.getJSONObject("identity").getLong("id"));
   if(s!=null&&!s.getString("grant_id").equals(profile.getString("grantId"))){closeSession(s);s=null;}
   if(s==null)db.exec("INSERT INTO ww_session(id,run_id,user_id,identity,grant_id,started_at) VALUES(?,?,?,?,?,?)",UUID.randomUUID().toString(),r.getString("id"),profile.getJSONObject("identity").getLong("id"),profile.getJSONObject("identity").toString(),profile.getString("grantId"),Instant.ofEpochMilli(now).toString());
   return r;
  });
 }
 private void closeSession(JSONObject s)throws Exception{if(s!=null&&"active".equals(s.getString("state")))db.exec("UPDATE ww_session SET state='closing',final_seq=next_seq-1,stopped_at=? WHERE id=?",new java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.ofEpochMilli(System.currentTimeMillis()+Long.parseLong(meta("serverOffset","0")))),s.getString("id"));}
 public synchronized void handover(long userId)throws Exception{db.transaction(()->{closeSession(currentSession(userId));return null;});}
 public synchronized void finish(long userId)throws Exception{
  db.transaction(()->{JSONObject r=currentRun();if(r==null)throw new Exception("没有本机采集批次");closeSession(currentSession(userId));List<JSONObject> other=db.rows("SELECT id FROM ww_session WHERE run_id=? AND state='active'",r.getString("id"));if(!other.isEmpty())throw new Exception("仍有工人会话未交班");db.exec("UPDATE ww_run SET state='sealed' WHERE id=?",r.getString("id"));putMeta("currentRun","");return null;});
 }
 public synchronized void resume(String id,JSONObject profile,long now)throws Exception{
  JSONObject r=run(id);if(r==null||!"open".equals(r.getString("state")))throw new Exception("此批已结束");
  if("external".equals(r.getString("mode"))||r.getJSONObject("context").optBoolean("lineWorkflow")){
   db.transaction(()->{
    putMeta("currentRun",id);JSONObject s=currentSession(profile.getJSONObject("identity").getLong("id"));
    // 重新登录可更新授权；封存旧会话，旧事件继续按原身份补传，不改原批资料。
    if(s!=null&&!s.getString("grant_id").equals(profile.getString("grantId"))){closeSession(s);s=null;}
    if(s==null)db.exec("INSERT INTO ww_session(id,run_id,user_id,identity,grant_id,started_at) VALUES(?,?,?,?,?,?)",UUID.randomUUID().toString(),id,profile.getJSONObject("identity").getLong("id"),profile.getJSONObject("identity").toString(),profile.getString("grantId"),Instant.ofEpochMilli(now).toString());
    return null;
   });
  }else start(r.getJSONObject("context"),profile,now);
 }
 public synchronized JSONObject capture(String raw,JSONObject profile,long now)throws Exception{
  return db.transaction(()->{
   if(raw==null||raw.trim().isEmpty()||raw.length()>4096)throw new Exception("扫码内容为空或过长，本次未保存");
   JSONObject r=currentRun(),s=currentSession(profile.getJSONObject("identity").getLong("id"));if(r==null||s==null||!"open".equals(r.getString("state")))throw new Exception("请先开始本批采集");
   if(r.getJSONObject("context").optBoolean("autoLine")&&(r.getJSONObject("context").optLong("taskId")<=0||s.optInt("server_open")==0))throw new Exception("请联网登记生产线后开始采集，本次未保存");
   if(!s.getString("grant_id").equals(profile.getString("grantId")))throw new Exception("工人授权已更换，请重新进入本批");
   String code=QueueStore.codeOf(raw),kind="valid",reason="",key=code!=null?"code:"+code:"raw:"+raw.trim();
   if("production".equals(r.getString("mode"))&&r.getJSONObject("context").optBoolean("lineWorkflow")&&!r.getJSONObject("context").optBoolean("stockWorkflow")&&code!=null){
    JSONObject c=r.getJSONObject("context");List<JSONObject> matches=db.rows("SELECT * FROM ww_line_code WHERE run_id=? AND code=?",r.getString("id"),code);
    if(!matches.isEmpty()){
     JSONObject match=matches.get(0),task=new JSONObject(match.getString("task_json"));
     if(c.optLong("taskId")==0){
      JSONObject established=task.optJSONObject("context");boolean conflict=false;if(established!=null)for(String k:new String[]{"batchNo","produceDate","expireDate"})if(!established.getString(k).equals(c.getString(k)))conflict=true;
      if(conflict){kind="invalid";reason="本任务已有不同生产资料，请暂停并核对批号、日期";}
      else {c.put("taskId",match.getLong("task_id")).put("taskName",task.getString("task_name")).put("lineName",task.getString("line_name"));db.exec("UPDATE ww_run SET context=? WHERE id=?",c.toString(),r.getString("id"));db.exec("DELETE FROM ww_allowed WHERE run_id=? AND code NOT IN(SELECT code FROM ww_line_code WHERE run_id=? AND task_id=?)",r.getString("id"),r.getString("id"),match.getLong("task_id"));}
     }else if(c.getLong("taskId")!=match.getLong("task_id")){kind="invalid";reason="此码属于其他任务或生产线，不能自动切换";}
    }
   }
   if(!"valid".equals(kind)){}
   else if("production".equals(r.getString("mode"))&&r.getJSONObject("context").optBoolean("stockWorkflow")){
    JSONObject c=r.getJSONObject("context");String head=c.optString("codeHead");if(head.isEmpty()){JSONArray products=catalog("products");for(int i=0;i<products.length();i++)if(products.getJSONObject(i).getLong("id")==c.getLong("productId"))head=products.getJSONObject(i).optString("code_head");if(!head.matches("[0-9]{11}"))throw new Exception("请联网更新产品校验资料后重扫，本次未保存");c.put("codeHead",head);db.exec("UPDATE ww_run SET context=? WHERE id=?",c.toString(),r.getString("id"));}
    if(code==null||!code.startsWith(head)){kind="invalid";reason="缺位、多候选或不符合所选产品的登记证、规格";}
    else if(db.rows("SELECT event_id FROM ww_line_usage WHERE code=? AND task_id=?",code,c.getLong("taskId")).isEmpty()){
     JSONObject cache=new JSONObject(meta("cache","{}"));List<JSONObject> known=db.rows("SELECT data FROM ww_catalog WHERE snapshot=? AND kind='codes' AND key=?",cache.optString("id"),"stock:"+c.getLong("productId")+":"+code);
     if(!known.isEmpty()){JSONObject inventory=new JSONObject(known.get(0).getString("data"));String owner=inventory.optString("owner_kind","");if(!"reserved".equals(inventory.optString("state"))||(!owner.isEmpty()&&!("legacy".equals(owner)&&Long.toString(c.getLong("taskId")).equals(inventory.optString("owner_id"))))){kind="invalid";reason="此码已有生产资料、处于异常状态或已被其他任务占用";}}
    }
   }
   else if("production".equals(r.getString("mode"))&&(code==null||db.rows("SELECT code FROM ww_allowed WHERE run_id=? AND code=?",r.getString("id"),code).isEmpty())){kind="invalid";reason="缺位、多候选、未领用到本任务或其他产品的码";}
   if("valid".equals(kind)&&r.getJSONObject("context").optBoolean("lineWorkflow")&&r.getJSONObject("context").optLong("taskId")>0&&!db.rows("SELECT event_id FROM ww_line_usage WHERE code=? AND task_id=? LIMIT 1",code,r.getJSONObject("context").getLong("taskId")).isEmpty()){kind="duplicate";reason="此任务在本设备已采集过该码，保留重复记录";}
   else if("valid".equals(kind)&&!db.rows("SELECT id FROM ww_event WHERE run_id=? AND dedup=? AND kind='valid' LIMIT 1",r.getString("id"),key).isEmpty()){kind="duplicate";reason="重复扫码，保留记录但不重复计数";}
   JSONObject event=new JSONObject().put("eventId",UUID.randomUUID().toString()).put("sequence",s.getInt("next_seq")).put("rawCode",raw).put("code",code==null?JSONObject.NULL:code).put("kind",kind).put("reason",reason).put("capturedAt",new java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.ofEpochMilli(now)));
   if("external".equals(r.getString("mode"))){JSONObject cache=new JSONObject(meta("cache","{}"));event.put("classification",TraceUrlPolicy.classification(raw,cache.optString("traceBaseUrl",TraceUrlPolicy.DEFAULT_BASE)));}
   db.exec("INSERT INTO ww_event(id,session_id,run_id,seq,code,dedup,kind,payload) VALUES(?,?,?,?,?,?,?,?)",event.getString("eventId"),s.getString("id"),r.getString("id"),s.getInt("next_seq"),code,key,kind,event.toString());
   if("valid".equals(kind)&&r.getJSONObject("context").optBoolean("lineWorkflow"))db.exec("INSERT INTO ww_line_usage(task_id,code,event_id) VALUES(?,?,?)",r.getJSONObject("context").getLong("taskId"),code,event.getString("eventId"));
   db.exec("UPDATE ww_session SET next_seq=next_seq+1 WHERE id=?",s.getString("id"));return event;
  });
 }
 public synchronized JSONArray sessions()throws Exception{JSONArray result=new JSONArray();for(JSONObject s:db.rows("SELECT * FROM ww_session WHERE state<>'completed' ORDER BY rowid")){s.put("identity",new JSONObject(s.getString("identity")));s.put("run",run(s.getString("run_id")));result.put(s);}return result;}
 public synchronized JSONArray pending(String session,int limit)throws Exception{JSONArray r=new JSONArray();for(JSONObject row:db.rows("SELECT payload FROM ww_event WHERE session_id=? AND receipt IS NULL ORDER BY seq LIMIT ?",session,Math.min(20,limit)))r.put(new JSONObject(row.getString("payload")));return r;}
 public synchronized JSONArray pending(String session,int limit,int maximum)throws Exception{JSONArray r=new JSONArray();for(JSONObject row:db.rows("SELECT payload FROM ww_event WHERE session_id=? AND receipt IS NULL AND seq<=? ORDER BY seq LIMIT ?",session,maximum,Math.min(20,limit)))r.put(new JSONObject(row.getString("payload")));return r;}
 public synchronized void opened(String id)throws Exception{db.exec("UPDATE ww_session SET server_open=1 WHERE id=?",id);}
 public synchronized void acknowledge(String sessionId,JSONObject response)throws Exception{
  db.transaction(()->{if(!sessionId.equals(response.getString("sessionId")))throw new Exception("工人会话收据不一致");JSONArray receipts=response.getJSONArray("receipts");
   for(int i=0;i<receipts.length();i++){JSONObject receipt=receipts.getJSONObject(i);List<JSONObject> rows=db.rows("SELECT * FROM ww_event WHERE id=? AND session_id=?",receipt.getString("eventId"),sessionId);if(rows.size()!=1)throw new Exception("收据含未知事件");JSONObject row=rows.get(0),event=new JSONObject(row.getString("payload"));String state=receipt.getString("state");if(event.getInt("sequence")!=receipt.getInt("sequence")||!event.optString("code","").equals(receipt.optString("code",""))||!Arrays.asList("saved","duplicate","exception").contains(state))throw new Exception("事件收据不一致");if(!row.isNull("receipt")&&!new JSONObject(row.getString("receipt")).getString("state").equals(state))throw new Exception("同一事件收据冲突");db.exec("UPDATE ww_event SET receipt=?,result=? WHERE id=?",receipt.toString(),state,event.getString("eventId"));}return null;});
 }
 public synchronized void completed(String id,int sequence)throws Exception{db.transaction(()->{JSONObject s=db.rows("SELECT * FROM ww_session WHERE id=?",id).get(0);if(!"closing".equals(s.getString("state"))||sequence!=s.getInt("final_seq")||pending(id,1).length()!=0)throw new Exception("结束收据不完整，本机保留");db.exec("UPDATE ww_session SET state='completed' WHERE id=?",id);return null;});}
 public synchronized JSONArray closingRuns()throws Exception{JSONArray r=new JSONArray();for(JSONObject row:db.rows("SELECT id FROM ww_run WHERE state='sealed' AND cloud_done=0 AND NOT EXISTS(SELECT 1 FROM ww_session s WHERE s.run_id=ww_run.id AND s.state<>'completed') ORDER BY rowid")){JSONObject value=run(row.getString("id"));JSONArray sessions=new JSONArray();for(JSONObject s:db.rows("SELECT id,final_seq FROM ww_session WHERE run_id=?",value.getString("id")))sessions.put(new JSONObject().put("id",s.getString("id")).put("lastSequence",s.getInt("final_seq")));value.put("sessions",sessions);r.put(value);}return r;}
 public synchronized void runDone(String id)throws Exception{db.exec("UPDATE ww_run SET cloud_done=1 WHERE id=? AND state='sealed'",id);}
 public synchronized JSONObject snapshot(long userId)throws Exception{
  JSONObject out=new JSONObject().put("run",currentRun()==null?JSONObject.NULL:currentRun()).put("cache",new JSONObject(meta("cache","{}"))).put("products",catalog("products")).put("pools",catalog("pools"));
  JSONArray open=new JSONArray();for(JSONObject row:db.rows("SELECT id FROM ww_run WHERE state='open' AND EXISTS(SELECT 1 FROM ww_session s WHERE s.run_id=ww_run.id AND s.user_id=?) ORDER BY rowid DESC",userId))open.put(run(row.getString("id")));out.put("openRuns",open);
  JSONArray history=new JSONArray();for(JSONObject row:db.rows("SELECT r.id,MIN(s.started_at) AS started_at,MAX(s.stopped_at) AS stopped_at FROM ww_run r JOIN ww_session s ON s.run_id=r.id WHERE s.user_id=? GROUP BY r.id ORDER BY r.rowid DESC LIMIT 50",userId))history.put(run(row.getString("id")).put("summary",runSummary(row.getString("id"),userId)).put("startedAt",row.get("started_at")).put("stoppedAt",row.get("stopped_at")));out.put("history",history);
  String runId=meta("currentRun","");JSONObject counts=db.rows("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN result IS NOT NULL THEN result='saved' ELSE kind='valid' END),0) AS collected,COALESCE(SUM(receipt IS NULL),0) AS waiting,COALESCE(SUM(result='saved'),0) AS saved,COALESCE(SUM(CASE WHEN result IS NOT NULL THEN result='duplicate' ELSE kind='duplicate' END),0) AS duplicates,COALESCE(SUM(CASE WHEN result IS NOT NULL THEN result='exception' ELSE kind='invalid' END),0) AS exceptions FROM ww_event WHERE run_id=?",runId).get(0);
  out.put("counts",counts).put("allWaiting",db.rows("SELECT COUNT(*) AS n FROM ww_event WHERE receipt IS NULL").get(0).getLong("n"));JSONArray recent=new JSONArray();for(JSONObject e:db.rows("SELECT e.payload,e.receipt FROM ww_event e JOIN ww_session s ON s.id=e.session_id WHERE e.run_id=? AND s.user_id=? ORDER BY e.rowid DESC LIMIT 30",runId,userId))recent.put(new JSONObject().put("event",new JSONObject(e.getString("payload"))).put("receipt",e.isNull("receipt")?JSONObject.NULL:new JSONObject(e.getString("receipt"))));return out.put("recent",recent);
 }
 public synchronized JSONObject runSummary(String id,long userId)throws Exception{
  return db.rows("SELECT COUNT(*) AS total,COALESCE(SUM(e.kind='valid' AND (e.receipt IS NULL OR e.result='saved')),0) AS collected,COALESCE(SUM(e.receipt IS NULL),0) AS waiting,COALESCE(SUM(e.result='saved'),0) AS saved,COALESCE(SUM(e.kind='duplicate' OR e.result='duplicate'),0) AS duplicates,COALESCE(SUM(e.kind='invalid' OR e.result='exception'),0) AS exceptions FROM ww_event e JOIN ww_session s ON s.id=e.session_id WHERE e.run_id=? AND s.user_id=?",id,userId).get(0);
 }
 public synchronized JSONArray productionExport(String runId,long userId)throws Exception{
  return db.transaction(()->{
   JSONObject r=run(runId);if(r==null||!r.getJSONObject("context").optBoolean("lineWorkflow"))throw new Exception("请选择新版生产记录；旧记录仍可导出JSON备份");
   JSONArray manifest=new JSONArray();for(JSONObject s:db.rows("SELECT id,final_seq FROM ww_session WHERE run_id=?",runId))manifest.put(new JSONObject().put("id",s.getString("id")).put("lastSequence",s.isNull("final_seq")?JSONObject.NULL:s.getInt("final_seq")));
   JSONArray result=new JSONArray();for(JSONObject s:db.rows("SELECT * FROM ww_session WHERE run_id=? AND user_id=? ORDER BY rowid",runId,userId)){
    JSONArray events=new JSONArray();for(JSONObject e:db.rows("SELECT payload FROM ww_event WHERE session_id=? ORDER BY seq",s.getString("id")))events.put(new JSONObject(e.getString("payload")));
    result.put(new JSONObject().put("grantId",s.getString("grant_id")).put("sessionId",s.getString("id")).put("startedAt",s.getString("started_at")).put("stoppedAt",s.isNull("stopped_at")?JSONObject.NULL:s.getString("stopped_at")).put("finalSequence",s.isNull("final_seq")?JSONObject.NULL:s.getInt("final_seq")).put("run",new JSONObject().put("id",runId).put("context",r.getJSONObject("context")).put("sealed",!"open".equals(r.getString("state"))).put("sessions",manifest)).put("events",events));
   }if(result.length()==0)throw new Exception("只能导出自己的工人记录");return result;
  });
 }
 /** 本机原文导出独立于上传收据，只读取本人外码记录，原文不缩减为码值。 */
 public synchronized JSONObject externalExport(String runId,long userId)throws Exception{
  return db.transaction(()->{
   JSONObject r=run(runId);if(r==null||!"external".equals(r.getString("mode")))throw new Exception("请选择外码采集记录");
   if(db.rows("SELECT id FROM ww_session WHERE run_id=? AND user_id=? LIMIT 1",runId,userId).isEmpty())throw new Exception("只能导出本人的外码记录");
   LinkedHashMap<String,String> unique=new LinkedHashMap<>();
   for(JSONObject row:db.rows("SELECT e.dedup,e.payload FROM ww_event e JOIN ww_session s ON s.id=e.session_id WHERE e.run_id=? AND s.user_id=? AND e.kind='valid' ORDER BY e.rowid",runId,userId))unique.putIfAbsent(row.getString("dedup"),new JSONObject(row.getString("payload")).getString("rawCode"));
   StringBuilder text=new StringBuilder();for(String raw:unique.values())text.append(raw).append("\r\n");
   return new JSONObject().put("text",text.toString()).put("count",unique.size());
  });
 }
 public synchronized void backup(OutputStream output,long userId)throws Exception{
  db.transaction(()->{Writer writer=new OutputStreamWriter(output,StandardCharsets.UTF_8);writer.write("{\"format\":\"nz315-worker-backup\",\"version\":1,\"events\":[");long last=0;boolean first=true;
   while(true){List<JSONObject> rows=db.rows("SELECT e.rowid AS record_row,e.*,s.identity,r.context,r.mode FROM ww_event e JOIN ww_session s ON s.id=e.session_id JOIN ww_run r ON r.id=e.run_id WHERE s.user_id=? AND e.rowid>? ORDER BY e.rowid LIMIT 500",userId,last);if(rows.isEmpty())break;for(JSONObject r:rows){last=r.getLong("record_row");r.remove("record_row");if(!first)writer.write(',');first=false;writer.write(r.toString());}}
   writer.write("]}");writer.flush();return null;});
 }

 /** 首次联网登记前禁止收码；丢失响应时使用原run/session重试。 */
 public synchronized void automaticOpened(String id,JSONObject context)throws Exception{
  db.transaction(()->{JSONObject s=db.rows("SELECT * FROM ww_session WHERE id=?",id).get(0),r=run(s.getString("run_id")),old=r.getJSONObject("context");
   if(!old.optBoolean("autoLine")||context.optLong("taskId")<=0)throw new Exception("生产线登记收据无效");
   for(String key:new String[]{"productId","batchNo","produceDate","expireDate"})if(!String.valueOf(old.get(key)).equals(String.valueOf(context.get(key))))throw new Exception("生产资料收据不一致");
   if(old.optLong("taskId")>0&&old.getLong("taskId")!=context.getLong("taskId"))throw new Exception("生产线任务收据不一致");
   old.put("taskId",context.getLong("taskId")).put("lineName",context.getString("lineName")).put("taskName",context.getString("lineName"));
   db.exec("UPDATE ww_run SET context=? WHERE id=?",old.toString(),r.getString("id"));db.exec("UPDATE ww_session SET server_open=1 WHERE id=?",id);return null;
  });
 }
 public synchronized JSONArray heartbeatReports(boolean capturing,long userId)throws Exception{
  JSONArray reports=new JSONArray();String current=meta("currentRun","");
  for(JSONObject s:db.rows("SELECT s.*,r.context FROM ww_session s JOIN ww_run r ON r.id=s.run_id WHERE s.state<>'completed' AND s.server_open=1")){
   JSONObject c=new JSONObject(s.getString("context"));if(!c.optBoolean("autoLine"))continue;
   JSONObject counts=db.rows("SELECT COUNT(*) AS sequence,COALESCE(SUM(CASE WHEN result IS NOT NULL THEN result='saved' ELSE kind='valid' END),0) AS valid,COALESCE(SUM(CASE WHEN result IS NOT NULL THEN result='duplicate' ELSE kind='duplicate' END),0) AS duplicate,COALESCE(SUM(CASE WHEN result IS NOT NULL THEN result='exception' ELSE kind='invalid' END),0) AS exception,COALESCE(SUM(receipt IS NULL),0) AS pending FROM ww_event WHERE session_id=?",s.getString("id")).get(0);
   long version=Long.parseLong(meta("heartbeatVersion:"+s.getString("id"),"0"))+1;putMeta("heartbeatVersion:"+s.getString("id"),Long.toString(version));
   counts.put("version",version).put("sessionId",s.getString("id")).put("state",!"active".equals(s.getString("state"))?"ended":capturing&&s.getLong("user_id")==userId&&s.getString("run_id").equals(current)?"running":"paused");reports.put(counts);
  }return reports;
 }
}
