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
  db.exec("CREATE TABLE IF NOT EXISTS ww_action(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,seq INTEGER NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,ack INTEGER NOT NULL DEFAULT 0,UNIQUE(session_id,seq))");
  boolean hasUpload=false;for(JSONObject column:db.rows("PRAGMA table_info(ww_session)"))if("uploaded_at".equals(column.getString("name")))hasUpload=true;if(!hasUpload)db.exec("ALTER TABLE ww_session ADD COLUMN uploaded_at TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS ww_event_code ON ww_event(run_id,dedup,kind)");
  db.exec("CREATE TABLE IF NOT EXISTS ww_known(snapshot TEXT NOT NULL,code TEXT NOT NULL,PRIMARY KEY(snapshot,code))");
  db.exec("CREATE TABLE IF NOT EXISTS ww_source(event_id TEXT PRIMARY KEY,classification TEXT NOT NULL)");
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
    JSONObject cache=new JSONObject(meta("cache","{}"));if(cache.optLong("expiresAt")<now)throw new Exception("产品缓存已过期，请联网更新");if(context.optBoolean("unifiedScan")&&cache.optInt("productionScanVersion")<1)throw new Exception("网站尚未支持统一生产扫码，请联网更新缓存后开始");if(cache.optInt("stockVersion")<2)throw new Exception("产品校验资料正在升级，请联网等待完整下载后开始");
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
 private void closeSession(JSONObject s)throws Exception{if(s!=null&&"active".equals(s.getString("state"))){actionFor(s.getString("id"),"end",System.currentTimeMillis()+Long.parseLong(meta("serverOffset","0")));db.exec("UPDATE ww_session SET state='closing',final_seq=next_seq-1,stopped_at=? WHERE id=?",new java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.ofEpochMilli(System.currentTimeMillis()+Long.parseLong(meta("serverOffset","0")))),s.getString("id"));}}
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
   boolean unified=r.getJSONObject("context").optBoolean("unifiedScan");
   JSONObject cachePolicy=new JSONObject(meta("cache","{}"));String source=unified?TraceUrlPolicy.productionClassification(raw,cachePolicy.optString("traceBaseUrl",TraceUrlPolicy.DEFAULT_BASE)):"";
   String code=unified?("internal".equals(source)?TraceUrlPolicy.codeOf(raw,cachePolicy.optString("traceBaseUrl",TraceUrlPolicy.DEFAULT_BASE)):null):QueueStore.codeOf(raw);
   if(unified&&"internal".equals(source)&&code==null)code=raw.trim();
   String kind="valid",reason="",key=unified&&"external".equals(source)?"external:"+raw:code!=null?"code:"+code:"raw:"+raw.trim();
   if(unified&&"unparsed".equals(source)){kind="invalid";reason="来源无法识别或标签网址、路径、码格式不正确";}
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
   else if(unified&&"external".equals(source)){}
   else if("production".equals(r.getString("mode"))&&r.getJSONObject("context").optBoolean("stockWorkflow")){
    JSONObject c=r.getJSONObject("context");String head=c.optString("codeHead");if(head.isEmpty()){JSONArray products=catalog("products");for(int i=0;i<products.length();i++)if(products.getJSONObject(i).getLong("id")==c.getLong("productId"))head=products.getJSONObject(i).optString("code_head");if(!head.matches("[0-9]{11}"))throw new Exception("请联网更新产品校验资料后重扫，本次未保存");c.put("codeHead",head);db.exec("UPDATE ww_run SET context=? WHERE id=?",c.toString(),r.getString("id"));}
    if(code==null||!code.startsWith(head)){kind="invalid";reason="缺位、多候选或不符合所选产品的登记证、规格";}
    else if(db.rows("SELECT event_id FROM ww_line_usage WHERE code=? AND task_id=?",code,c.getLong("taskId")).isEmpty()){
     JSONObject cache=new JSONObject(meta("cache","{}"));List<JSONObject> known=db.rows("SELECT data FROM ww_catalog WHERE snapshot=? AND kind='codes' AND key=?",cache.optString("id"),"stock:"+c.getLong("productId")+":"+code);
     if(!known.isEmpty()){JSONObject inventory=new JSONObject(known.get(0).getString("data"));String owner=inventory.optString("owner_kind","");if(!"reserved".equals(inventory.optString("state"))||(!owner.isEmpty()&&!("legacy".equals(owner)&&Long.toString(c.getLong("taskId")).equals(inventory.optString("owner_id"))))){kind="invalid";reason="此码已有生产资料、处于异常状态或已被其他任务占用";}}
    }
   }
   else if("production".equals(r.getString("mode"))&&(code==null||db.rows("SELECT code FROM ww_allowed WHERE run_id=? AND code=?",r.getString("id"),code).isEmpty())){kind="invalid";reason="缺位、多候选、未领用到本任务或其他产品的码";}
   if("valid".equals(kind)&&code!=null&&r.getJSONObject("context").optBoolean("lineWorkflow")&&r.getJSONObject("context").optLong("taskId")>0&&!db.rows("SELECT event_id FROM ww_line_usage WHERE code=? AND task_id=? LIMIT 1",code,r.getJSONObject("context").getLong("taskId")).isEmpty()){kind="duplicate";reason="此任务在本设备已采集过该码，保留重复记录";}
   else if("valid".equals(kind)&&!db.rows("SELECT id FROM ww_event WHERE run_id=? AND dedup=? AND kind='valid' LIMIT 1",r.getString("id"),key).isEmpty()){kind="duplicate";reason="重复扫码，保留记录但不重复计数";}
   JSONObject event=new JSONObject().put("eventId",UUID.randomUUID().toString()).put("sequence",s.getInt("next_seq")).put("rawCode",raw).put("code",code==null?JSONObject.NULL:code).put("kind",kind).put("reason",reason).put("capturedAt",new java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.ofEpochMilli(now)));
   if(unified)event.put("classification",source);
   if("external".equals(r.getString("mode"))){JSONObject cache=new JSONObject(meta("cache","{}"));event.put("classification",TraceUrlPolicy.classification(raw,cache.optString("traceBaseUrl",TraceUrlPolicy.DEFAULT_BASE)));}
   db.exec("INSERT INTO ww_event(id,session_id,run_id,seq,code,dedup,kind,payload) VALUES(?,?,?,?,?,?,?,?)",event.getString("eventId"),s.getString("id"),r.getString("id"),s.getInt("next_seq"),code,key,kind,event.toString());
   if("valid".equals(kind)&&code!=null&&r.getJSONObject("context").optBoolean("lineWorkflow"))db.exec("INSERT INTO ww_line_usage(task_id,code,event_id) VALUES(?,?,?)",r.getJSONObject("context").getLong("taskId"),code,event.getString("eventId"));
   if(unified)db.exec("INSERT INTO ww_source(event_id,classification) VALUES(?,?)",event.getString("eventId"),source);
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
 public synchronized void completed(String id,int sequence)throws Exception{db.transaction(()->{JSONObject s=db.rows("SELECT * FROM ww_session WHERE id=?",id).get(0);if(!"closing".equals(s.getString("state"))||sequence!=s.getInt("final_seq")||pending(id,1).length()!=0)throw new Exception("结束收据不完整，本机保留");db.exec("UPDATE ww_session SET state='completed',uploaded_at=COALESCE(uploaded_at,?) WHERE id=?",Instant.ofEpochMilli(System.currentTimeMillis()+Long.parseLong(meta("serverOffset","0"))).toString(),id);return null;});}
 public synchronized JSONArray closingRuns()throws Exception{JSONArray r=new JSONArray();for(JSONObject row:db.rows("SELECT id FROM ww_run WHERE state='sealed' AND cloud_done=0 AND NOT EXISTS(SELECT 1 FROM ww_session s WHERE s.run_id=ww_run.id AND s.state<>'completed') ORDER BY rowid")){JSONObject value=run(row.getString("id"));JSONArray sessions=new JSONArray();for(JSONObject s:db.rows("SELECT id,final_seq FROM ww_session WHERE run_id=?",value.getString("id")))sessions.put(new JSONObject().put("id",s.getString("id")).put("lastSequence",s.getInt("final_seq")));value.put("sessions",sessions);r.put(value);}return r;}
 public synchronized void runDone(String id)throws Exception{db.exec("UPDATE ww_run SET cloud_done=1 WHERE id=? AND state='sealed'",id);}
 // 全量历史只在打开记录页时读取；日常快照仍限50批，避免影响连续扫码。
 public synchronized JSONArray history(long userId)throws Exception{if(userId<=0)throw new Exception("请先登录工人账号");return history(userId,-1);}
 private JSONArray history(long userId,int limit)throws Exception{
  JSONArray history=new JSONArray();for(JSONObject row:db.rows("SELECT r.id,MIN(s.started_at) AS started_at,MAX(s.stopped_at) AS stopped_at FROM ww_run r JOIN ww_session s ON s.run_id=r.id WHERE s.user_id=? GROUP BY r.id ORDER BY r.rowid DESC LIMIT ?",userId,limit))history.put(run(row.getString("id")).put("summary",runSummary(row.getString("id"),userId)).put("startedAt",row.get("started_at")).put("stoppedAt",row.get("stopped_at")));return history;
 }
 public synchronized JSONObject snapshot(long userId)throws Exception{
  JSONObject out=new JSONObject().put("run",currentRun()==null?JSONObject.NULL:currentRun()).put("cache",new JSONObject(meta("cache","{}"))).put("products",catalog("products")).put("pools",catalog("pools"));
  JSONArray open=new JSONArray();for(JSONObject row:db.rows("SELECT id FROM ww_run WHERE state='open' AND EXISTS(SELECT 1 FROM ww_session s WHERE s.run_id=ww_run.id AND s.user_id=?) ORDER BY rowid DESC",userId))open.put(run(row.getString("id")));out.put("openRuns",open);
  out.put("history",history(userId,50));
  String runId=meta("currentRun","");JSONObject counts=db.rows("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN result IS NOT NULL THEN result='saved' ELSE kind='valid' END),0) AS collected,COALESCE(SUM(receipt IS NULL),0) AS waiting,COALESCE(SUM(result='saved'),0) AS saved,COALESCE(SUM(CASE WHEN result IS NOT NULL THEN result='duplicate' ELSE kind='duplicate' END),0) AS duplicates,COALESCE(SUM(CASE WHEN result IS NOT NULL THEN result='exception' ELSE kind='invalid' END),0) AS exceptions FROM ww_event WHERE run_id=?",runId).get(0);
  sourceCounts(counts,runId,0);out.put("counts",counts).put("allWaiting",db.rows("SELECT COUNT(*) AS n FROM ww_event WHERE receipt IS NULL").get(0).getLong("n"));JSONArray recent=new JSONArray();for(JSONObject e:db.rows("SELECT e.payload,e.receipt FROM ww_event e JOIN ww_session s ON s.id=e.session_id WHERE e.run_id=? AND s.user_id=? ORDER BY e.rowid DESC LIMIT 30",runId,userId))recent.put(new JSONObject().put("event",new JSONObject(e.getString("payload"))).put("receipt",e.isNull("receipt")?JSONObject.NULL:new JSONObject(e.getString("receipt"))));return out.put("recent",recent);
 }
 public synchronized JSONObject runSummary(String id,long userId)throws Exception{
  JSONObject summary=db.rows("SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN e.receipt IS NULL THEN e.kind='valid' ELSE e.result='saved' END),0) AS collected,COALESCE(SUM(e.receipt IS NULL),0) AS waiting,COALESCE(SUM(e.result='saved'),0) AS saved,COALESCE(SUM(CASE WHEN e.receipt IS NULL THEN e.kind='duplicate' ELSE e.result='duplicate' END),0) AS duplicates,COALESCE(SUM(CASE WHEN e.receipt IS NULL THEN e.kind='invalid' ELSE e.result='exception' END),0) AS exceptions FROM ww_event e JOIN ww_session s ON s.id=e.session_id WHERE e.run_id=? AND s.user_id=?",id,userId).get(0);sourceCounts(summary,id,userId);return summary;
 }
 private void sourceCounts(JSONObject counts,String runId,long userId)throws Exception{
  String source="COALESCE(src.classification,CASE WHEN r.mode='external' THEN 'external' ELSE 'internal' END)",valid="(CASE WHEN e.receipt IS NULL THEN e.kind='valid' ELSE e.result='saved' END)";
  JSONObject totals=db.rows("SELECT COALESCE(SUM("+valid+" AND "+source+"='internal'),0) AS inside,COALESCE(SUM("+valid+" AND "+source+"='external'),0) AS outside FROM ww_event e JOIN ww_session s ON s.id=e.session_id JOIN ww_run r ON r.id=e.run_id LEFT JOIN ww_source src ON src.event_id=e.id WHERE e.run_id=?"+(userId>0?" AND s.user_id=?":""),userId>0?new Object[]{runId,userId}:new Object[]{runId}).get(0);
  counts.put("internal",totals.getLong("inside")).put("external",totals.getLong("outside"));
 }
 public synchronized JSONArray productionExport(String runId,long userId)throws Exception{
  return db.transaction(()->{
   JSONObject r=run(runId);if(r==null||!r.getJSONObject("context").optBoolean("lineWorkflow"))throw new Exception("请选择新版生产记录；旧记录仍可导出JSON备份");
   JSONArray manifest=new JSONArray();for(JSONObject s:db.rows("SELECT id,final_seq FROM ww_session WHERE run_id=?",runId))manifest.put(new JSONObject().put("id",s.getString("id")).put("lastSequence",s.isNull("final_seq")?JSONObject.NULL:s.getInt("final_seq")));
   JSONArray result=new JSONArray();for(JSONObject s:db.rows("SELECT * FROM ww_session WHERE run_id=? AND user_id=? ORDER BY rowid",runId,userId)){
    JSONArray events=new JSONArray();for(JSONObject e:db.rows("SELECT payload FROM ww_event WHERE session_id=? ORDER BY seq",s.getString("id")))events.put(new JSONObject(e.getString("payload")));
    JSONArray actions=new JSONArray();for(JSONObject a:db.rows("SELECT payload FROM ww_action WHERE session_id=? ORDER BY seq",s.getString("id")))actions.put(new JSONObject(a.getString("payload")));
    result.put(new JSONObject().put("grantId",s.getString("grant_id")).put("sessionId",s.getString("id")).put("startedAt",s.getString("started_at")).put("stoppedAt",s.isNull("stopped_at")?JSONObject.NULL:s.getString("stopped_at")).put("finalSequence",s.isNull("final_seq")?JSONObject.NULL:s.getInt("final_seq")).put("run",new JSONObject().put("id",runId).put("context",r.getJSONObject("context")).put("sealed",!"open".equals(r.getString("state"))).put("sessions",manifest)).put("events",events).put("actions",actions));
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

 /** A state change is committed before scanning is enabled or a finish is acknowledged. */
 public synchronized void action(long userId,boolean enabled,long now)throws Exception{
  db.transaction(()->{JSONObject s=currentSession(userId);if(s==null)return null;
   List<JSONObject> last=db.rows("SELECT kind FROM ww_action WHERE session_id=? ORDER BY seq DESC LIMIT 1",s.getString("id"));String kind=last.isEmpty()?"":last.get(0).getString("kind");
   if(enabled){if(!"start".equals(kind)&&!"resume".equals(kind)&&!"end".equals(kind))actionFor(s.getString("id"),kind.isEmpty()?"start":"resume",now);}
   else if("start".equals(kind)||"resume".equals(kind))actionFor(s.getString("id"),"pause",now);return null;});
 }
 private void actionFor(String id,String kind,long now)throws Exception{
  int seq=db.rows("SELECT COALESCE(MAX(seq),0)+1 n FROM ww_action WHERE session_id=?",id).get(0).getInt("n");String event=UUID.randomUUID().toString();
  JSONObject a=new JSONObject().put("eventId",event).put("sequence",seq).put("kind",kind).put("capturedAt",new java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.ofEpochMilli(now)));
  db.exec("INSERT INTO ww_action(id,session_id,seq,kind,payload) VALUES(?,?,?,?,?)",event,id,seq,kind,a.toString());
 }
 public synchronized JSONArray pendingActions(String id)throws Exception{JSONArray rows=new JSONArray();for(JSONObject r:db.rows("SELECT payload FROM ww_action WHERE session_id=? AND ack=0 ORDER BY seq LIMIT 20",id))rows.put(new JSONObject(r.getString("payload")));return rows;}
 public synchronized JSONObject completion(String id)throws Exception{
  JSONObject row=db.rows("SELECT * FROM ww_session WHERE id=?",id).get(0);if(!"closing".equals(row.getString("state")))throw new Exception("本机会话尚未结束");
  JSONObject data=new JSONObject().put("lastSequence",row.getInt("final_seq")).put("stoppedAt",row.isNull("stopped_at")?JSONObject.NULL:row.getString("stopped_at"));int actions=lastActionSequence(id);
  // Pre-upgrade closing queues have no action stream; retain their original completion protocol.
  if(actions>0)data.put("lastActionSequence",actions);return data;
 }
 public synchronized int lastActionSequence(String id)throws Exception{return db.rows("SELECT COALESCE(MAX(seq),0) n FROM ww_action WHERE session_id=?",id).get(0).getInt("n");}
 public synchronized void acknowledgeActions(String id,JSONObject response)throws Exception{db.transaction(()->{
  if(!id.equals(response.getString("sessionId")))throw new Exception("操作收据会话不一致");JSONArray receipts=response.getJSONArray("receipts");
  for(int i=0;i<receipts.length();i++){JSONObject a=receipts.getJSONObject(i);if(db.rows("SELECT id FROM ww_action WHERE id=? AND session_id=? AND seq=?",a.getString("eventId"),id,a.getInt("sequence")).isEmpty())throw new Exception("操作收据不一致");db.exec("UPDATE ww_action SET ack=1 WHERE id=?",a.getString("eventId"));}return null;});}
 private JSONObject record(JSONObject s)throws Exception{
  JSONObject r=run(s.getString("run_id")),identity=new JSONObject(s.getString("identity"));
  JSONObject c=db.rows("SELECT COUNT(*) total,COALESCE(SUM(CASE WHEN receipt IS NULL THEN kind='valid' ELSE result='saved' END),0) collected,COALESCE(SUM(result='saved'),0) saved,COALESCE(SUM(receipt IS NULL),0) waiting,COALESCE(SUM(CASE WHEN receipt IS NULL THEN kind='duplicate' ELSE result='duplicate' END),0) duplicates,COALESCE(SUM(CASE WHEN receipt IS NULL THEN kind='invalid' ELSE result='exception' END),0) exceptions FROM ww_event WHERE session_id=?",s.getString("id")).get(0);
  List<JSONObject> first=db.rows("SELECT payload FROM ww_event WHERE session_id=? ORDER BY seq LIMIT 1",s.getString("id")),last=db.rows("SELECT payload FROM ww_event WHERE session_id=? ORDER BY seq DESC LIMIT 1",s.getString("id"));
  return new JSONObject().put("id",s.getString("id")).put("runId",r.getString("id")).put("mode",r.getString("mode")).put("context",r.getJSONObject("context")).put("identity",identity).put("state",s.getString("state")).put("summary",c).put("startedAt",s.get("started_at")).put("stoppedAt",s.get("stopped_at")).put("uploadedAt",s.get("uploaded_at")).put("firstScan",first.isEmpty()?JSONObject.NULL:new JSONObject(first.get(0).getString("payload")).opt("capturedAt")).put("lastScan",last.isEmpty()?JSONObject.NULL:new JSONObject(last.get(0).getString("payload")).opt("capturedAt")).put("scope","device").put("cloud_done",r.optInt("cloud_done")==1);
 }
 public synchronized JSONArray records(long enterprise)throws Exception{
  JSONArray rows=new JSONArray();for(JSONObject s:db.rows("SELECT * FROM ww_session ORDER BY rowid DESC")){JSONObject identity=new JSONObject(s.getString("identity"));if(identity.optLong("enterpriseId")==enterprise)rows.put(record(s));}return rows;
 }
 private JSONObject factorySession(String id,long enterprise)throws Exception{
  List<JSONObject> rows=db.rows("SELECT * FROM ww_session WHERE id=?",id);if(rows.isEmpty())throw new Exception("未找到本机记录");JSONObject s=rows.get(0);CaptureAccess.sameFactory(new JSONObject(s.getString("identity")),enterprise);return s;
 }
 public synchronized JSONObject recordDetail(String id,long enterprise,int page,String result)throws Exception{
  JSONObject s=factorySession(id,enterprise);String filter=Arrays.asList("saved","duplicate","exception").contains(result)?" AND (CASE WHEN receipt IS NULL THEN CASE kind WHEN 'valid' THEN 'saved' WHEN 'invalid' THEN 'exception' ELSE kind END ELSE result END)=?":"";Object[] args=filter.isEmpty()?new Object[]{id}:new Object[]{id,result};
  int total=db.rows("SELECT COUNT(*) n FROM ww_event WHERE session_id=?"+filter,args).get(0).getInt("n");JSONArray events=new JSONArray();
  Object[] pageArgs=filter.isEmpty()?new Object[]{id,Math.max(0,page-1)*100}:new Object[]{id,result,Math.max(0,page-1)*100};
  for(JSONObject e:db.rows("SELECT payload,receipt,result FROM ww_event WHERE session_id=?"+filter+" ORDER BY seq LIMIT 100 OFFSET ?",pageArgs)){JSONObject a=new JSONObject(e.getString("payload"));if(!e.isNull("receipt"))a.put("receipt",new JSONObject(e.getString("receipt")));events.put(a);}
  JSONArray actions=new JSONArray();for(JSONObject a:db.rows("SELECT payload,ack FROM ww_action WHERE session_id=? ORDER BY seq",id))actions.put(new JSONObject(a.getString("payload")).put("uploaded",a.getInt("ack")==1));
  return new JSONObject().put("ok",true).put("record",record(s)).put("events",events).put("actions",actions).put("total",total).put("page",Math.max(1,page)).put("pageSize",100);
 }
 public synchronized JSONObject recordExport(String id,long enterprise)throws Exception{
  JSONObject s=factorySession(id,enterprise),row=record(s);if("production".equals(row.getString("mode"))){JSONArray sessions=productionExport(s.getString("run_id"),s.getLong("user_id"));for(int i=0;i<sessions.length();i++)if(id.equals(sessions.getJSONObject(i).getString("sessionId")))return row.put("payloads",new JSONArray().put(sessions.getJSONObject(i)));throw new Exception("未找到会话");}
  LinkedHashMap<String,String> unique=new LinkedHashMap<>();for(JSONObject e:db.rows("SELECT dedup,payload FROM ww_event WHERE session_id=? AND kind='valid' ORDER BY seq",id))unique.putIfAbsent(e.getString("dedup"),new JSONObject(e.getString("payload")).getString("rawCode"));return row.put("text",String.join("\r\n",unique.values())+"\r\n").put("count",unique.size());
 }
 public synchronized void factoryBackup(OutputStream output,long enterprise,long actor)throws Exception{
  db.transaction(()->{Writer writer=new OutputStreamWriter(output,StandardCharsets.UTF_8);writer.write("{\"format\":\"nz315-worker-backup\",\"version\":2,\"scope\":\"current-device-factory\",\"exportActorId\":"+actor+",\"events\":[");boolean first=true;long last=0;
   while(true){List<JSONObject> rows=db.rows("SELECT e.rowid record_row,e.*,s.identity,r.context,r.mode FROM ww_event e JOIN ww_session s ON s.id=e.session_id JOIN ww_run r ON r.id=e.run_id WHERE e.rowid>? ORDER BY e.rowid LIMIT 500",last);if(rows.isEmpty())break;for(JSONObject e:rows){last=e.getLong("record_row");e.remove("record_row");if(new JSONObject(e.getString("identity")).optLong("enterpriseId")!=enterprise)continue;if(!first)writer.write(',');first=false;writer.write(e.toString());}}
   writer.write("],\"records\":[");first=true;JSONArray rows=records(enterprise);for(int i=0;i<rows.length();i++){if(!first)writer.write(',');first=false;writer.write(recordDetail(rows.getJSONObject(i).getString("id"),enterprise,1,"").put("events",JSONObject.NULL).toString());}writer.write("]}");writer.flush();return null;});
 }
}
