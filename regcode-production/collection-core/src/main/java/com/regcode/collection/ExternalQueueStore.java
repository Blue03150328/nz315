package com.regcode.collection;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;

/** 外部码独立发件队列：完整原文不做网址解析，采集边界与序号均在事务中持久保存。 */
public final class ExternalQueueStore {
    private final QueueStore.Sql db;
    private static final DateTimeFormatter TIME=DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(java.time.ZoneOffset.UTC);
    private static String trimText(String value){return value.replaceAll("^[\\x09-\\x0d\\x20\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+|[\\x09-\\x0d\\x20\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+$","");}
    public ExternalQueueStore(QueueStore.Sql db) throws Exception {
        this.db=db;
        db.exec("CREATE TABLE IF NOT EXISTS external_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
        db.exec("CREATE TABLE IF NOT EXISTS external_batch(id TEXT PRIMARY KEY,server TEXT NOT NULL,enterprise_id INTEGER NOT NULL,device_id INTEGER NOT NULL,line_name TEXT NOT NULL,worker_no TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'open',registered INTEGER NOT NULL DEFAULT 0,next_seq INTEGER NOT NULL DEFAULT 1,final_seq INTEGER,created_at TEXT NOT NULL,completed_at TEXT)");
        db.exec("CREATE TABLE IF NOT EXISTS external_event(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,seq INTEGER NOT NULL,raw_code TEXT NOT NULL,raw_hash TEXT NOT NULL,local_kind TEXT NOT NULL,payload TEXT NOT NULL,receipt TEXT,result_state TEXT,UNIQUE(batch_id,seq))");
        db.exec("CREATE INDEX IF NOT EXISTS external_event_hash ON external_event(raw_hash)");
        db.exec("CREATE INDEX IF NOT EXISTS external_event_pending ON external_event(batch_id,seq)");
    }
    private JSONObject meta(String key) throws Exception {
        List<JSONObject> rows=db.rows("SELECT value FROM external_meta WHERE key=?",key);
        return rows.isEmpty()?null:new JSONObject(rows.get(0).getString("value"));
    }
    private void saveMeta(String key,JSONObject value) throws Exception { db.exec("INSERT OR REPLACE INTO external_meta(key,value) VALUES (?,?)",key,value.toString()); }
    public synchronized JSONObject trustedContext(String server) throws Exception {
        JSONObject context=meta("device");return context!=null&&server.equals(context.optString("server"))?context:null;
    }
    /** 仅原生HTTP收到的设备上下文可以更新归属；网页填写的企业与产线不参与授权。 */
    public synchronized void trust(String server,JSONObject response) throws Exception {
        JSONObject device=response.getJSONObject("device");
        long enterprise=device.getLong("enterprise_id"),id=device.getLong("id");String line=device.getString("line_name");
        if(enterprise<=0||id<=0||line.trim().isEmpty())throw new Exception("设备公司或生产线资料不完整");
        db.transaction(()->{saveMeta("device",new JSONObject().put("server",server).put("enterpriseId",enterprise).put("deviceId",id).put("lineName",line).put("enterpriseName",device.optString("enterprise_name")).put("deviceName",device.optString("name")));saveMeta("blocked",new JSONObject().put("value",false));return null;});
    }
    public synchronized void block() throws Exception { saveMeta("blocked",new JSONObject().put("value",true)); }
    public synchronized boolean blocked() throws Exception { JSONObject value=meta("blocked");return value!=null&&value.optBoolean("value"); }
    public synchronized JSONObject openBatch() throws Exception {List<JSONObject> rows=db.rows("SELECT * FROM external_batch WHERE state='open' ORDER BY rowid DESC LIMIT 1");return rows.isEmpty()?null:rows.get(0);}
    public synchronized JSONObject nextBatch() throws Exception {List<JSONObject> rows=db.rows("SELECT * FROM external_batch WHERE state<>'completed' ORDER BY rowid LIMIT 1");return rows.isEmpty()?null:rows.get(0);}
    private static boolean matches(JSONObject batch,JSONObject context) throws Exception {
        return batch.getString("server").equals(context.getString("server"))&&batch.getLong("enterprise_id")==context.getLong("enterpriseId")&&batch.getLong("device_id")==context.getLong("deviceId")&&batch.getString("line_name").equals(context.getString("lineName"));
    }
    public synchronized boolean compatible(String server) throws Exception {
        JSONObject context=trustedContext(server),batch=nextBatch();return context!=null&&(batch==null||matches(batch,context));
    }
    /** 完成收据丢失后允许同公司同设备只核对完成；旧产线快照不能被改写，也不再发送新码。 */
    public synchronized boolean canReplayCompletion(JSONObject batch) throws Exception {
        JSONObject context=trustedContext(batch.getString("server"));
        return context!=null&&context.getLong("enterpriseId")==batch.getLong("enterprise_id")&&context.getLong("deviceId")==batch.getLong("device_id")&&batch.optInt("registered")==1&&"sealed".equals(batch.getString("state"))&&pending(batch.getString("id"),1).length()==0;
    }
    public synchronized JSONObject prepare(String server,String workerNo) throws Exception {
        if(workerNo==null||trimText(workerNo).isEmpty()||trimText(workerNo).length()>64)throw new Exception("请填写64字以内的工号");
        String normalizedWorker=trimText(workerNo);
        if(blocked())throw new Exception("设备已停用或凭证失效，请重新验证设备；本机记录保留");
        JSONObject context=trustedContext(server);if(context==null)throw new Exception("请先联网验证设备公司和生产线，之后可离线采集");
        if(!compatible(server))throw new Exception("本机仍有原公司或产线的待上传记录，请恢复原设备登记完成同步");
        JSONObject batch=openBatch();if(batch!=null&&!normalizedWorker.equals(batch.getString("worker_no")))throw new Exception("本次采集工号已固定，请先完成本次采集再更换工号");
        saveMeta("selection",new JSONObject(context.toString()).put("workerNo",normalizedWorker));return snapshot();
    }
    public static void validateRaw(String raw) throws Exception {
        if(raw==null||trimText(raw).isEmpty())throw new Exception("扫码内容为空，未录入");
        if(raw.indexOf('\r')>=0||raw.indexOf('\n')>=0||raw.indexOf('\0')>=0)throw new Exception("码内含有换行或无效字符，未录入；请检查扫码头结束符设置");
        for(int i=0;i<raw.length();i++){char ch=raw.charAt(i);if(Character.isHighSurrogate(ch)){if(i+1>=raw.length()||!Character.isLowSurrogate(raw.charAt(++i)))throw new Exception("扫码原文含有不完整字符，未录入");}else if(Character.isLowSurrogate(ch))throw new Exception("扫码原文含有不完整字符，未录入");}
        if(raw.getBytes(StandardCharsets.UTF_8).length>8192)throw new Exception("扫码原文超过8192字节，未录入");
    }
    private static String hash(String raw) throws Exception {byte[] bytes=MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8));StringBuilder value=new StringBuilder();for(byte b:bytes)value.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return value.toString();}
    public synchronized JSONObject capture(String raw) throws Exception {
        validateRaw(raw);
        if(blocked())throw new Exception("设备已停用或凭证失效，已停止采集；本机记录保留");
        JSONObject selected=meta("selection");if(selected==null)throw new Exception("请先填写工号并开始外部采集");
        JSONObject trusted=trustedContext(selected.getString("server"));
        if(trusted==null||trusted.getLong("enterpriseId")!=selected.getLong("enterpriseId")||trusted.getLong("deviceId")!=selected.getLong("deviceId")||!trusted.getString("lineName").equals(selected.getString("lineName"))||!compatible(selected.getString("server")))throw new Exception("设备公司或产线已变化，请暂停并核对本机记录");
        String rawHash=hash(raw);
        return db.transaction(()->{
            JSONObject batch=openBatch();
            if(batch==null){String id=UUID.randomUUID().toString();db.exec("INSERT INTO external_batch(id,server,enterprise_id,device_id,line_name,worker_no,created_at) VALUES (?,?,?,?,?,?,?)",id,selected.getString("server"),selected.getLong("enterpriseId"),selected.getLong("deviceId"),selected.getString("lineName"),selected.getString("workerNo"),TIME.format(Instant.now()));batch=openBatch();}
            if(!matches(batch,selected))throw new Exception("当前采集批次归属不一致，请暂停核对");
            boolean repeated=!db.rows("SELECT e.id FROM external_event e JOIN external_batch b ON b.id=e.batch_id WHERE b.server=? AND b.enterprise_id=? AND e.raw_hash=? AND e.raw_code=? AND (e.result_state IS NULL OR e.result_state<>'rejected') LIMIT 1",batch.getString("server"),batch.getLong("enterprise_id"),rawHash,raw).isEmpty();
            JSONObject event=new JSONObject().put("eventId",UUID.randomUUID().toString()).put("sequence",batch.getInt("next_seq")).put("rawCode",raw).put("capturedAt",TIME.format(Instant.now()));
            db.exec("INSERT INTO external_event(id,batch_id,seq,raw_code,raw_hash,local_kind,payload) VALUES (?,?,?,?,?,?,?)",event.getString("eventId"),batch.getString("id"),event.getInt("sequence"),raw,rawHash,repeated?"duplicate":"valid",event.toString());
            db.exec("UPDATE external_batch SET next_seq=next_seq+1 WHERE id=?",batch.getString("id"));
            return new JSONObject(event.toString()).put("localKind",repeated?"duplicate":"valid").put("reason",repeated?"本机同厂家已采过，原文留存并等待云端查重":"");
        });
    }
    public synchronized JSONObject finish() throws Exception {
        return db.transaction(()->{JSONObject batch=openBatch();if(batch==null)return null;int last=batch.getInt("next_seq")-1;db.exec("UPDATE external_batch SET state='sealed',final_seq=? WHERE id=?",last,batch.getString("id"));batch.put("state","sealed").put("final_seq",last);return batch;});
    }
    public synchronized void registered(String id,JSONObject response) throws Exception {
            db.transaction(()->{JSONObject batch=batch(id);if(!response.optBoolean("ok")||!id.equals(response.optString("batchId"))||!java.util.Arrays.asList("active","completed").contains(response.optString("state"))||!batch.getString("worker_no").equals(response.optString("workerNo"))||!batch.getString("line_name").equals(response.optString("lineName"))||response.optInt("lastSequence",-1)<0||response.optInt("lastSequence")>=batch.getInt("next_seq"))throw new Exception("外部采集登记收据不一致，本机记录保留");db.exec("UPDATE external_batch SET registered=1 WHERE id=?",id);return null;});
    }
    private JSONObject batch(String id) throws Exception {List<JSONObject> rows=db.rows("SELECT * FROM external_batch WHERE id=?",id);if(rows.size()!=1)throw new Exception("外部采集批次不存在");return rows.get(0);}
    public synchronized JSONArray pending(String id,int limit) throws Exception {JSONArray result=new JSONArray();for(JSONObject row:db.rows("SELECT payload FROM external_event WHERE batch_id=? AND receipt IS NULL ORDER BY seq LIMIT ?",id,Math.min(20,Math.max(1,limit))))result.put(new JSONObject(row.getString("payload")));return result;}
    public synchronized void acknowledge(String id,JSONObject response) throws Exception {
        db.transaction(()->{
            if(!id.equals(response.optString("batchId")))throw new Exception("外部采集收据批次不一致");
            JSONArray receipts=response.getJSONArray("receipts");
            for(int i=0;i<receipts.length();i++){
                JSONObject receipt=receipts.getJSONObject(i);List<JSONObject> rows=db.rows("SELECT * FROM external_event WHERE batch_id=? AND id=?",id,receipt.getString("eventId"));
                String state=receipt.getString("state");
                if(rows.size()!=1||rows.get(0).getInt("seq")!=receipt.getInt("sequence")||!java.util.Arrays.asList("accepted","duplicate","rejected").contains(state))throw new Exception("外部采集收据与本机原记录不一致");
                JSONObject row=rows.get(0);if(!row.isNull("receipt")&&!new JSONObject(row.getString("receipt")).toString().equals(receipt.toString()))throw new Exception("同一外部采集记录收到不同收据，请暂停核对");
                db.exec("UPDATE external_event SET receipt=?,result_state=? WHERE id=?",receipt.toString(),state,row.getString("id"));
            }
            return null;
        });
    }
    public synchronized void completed(String id,JSONObject response) throws Exception {
        db.transaction(()->{
            JSONObject batch=batch(id),counts=counts(id);
            if(!response.optBoolean("ok")||!id.equals(response.optString("batchId"))||!"completed".equals(response.optString("state"))||batch.isNull("final_seq")||batch.getInt("final_seq")!=response.optInt("lastSequence",-1)||counts.optInt("waiting")!=0||counts.optInt("total")!=batch.getInt("final_seq")||counts.optInt("accepted")!=response.optInt("acceptedCount",-1)||counts.optInt("duplicates")!=response.optInt("duplicateCount",-1)||counts.optInt("rejected")!=response.optInt("rejectedCount",-1))throw new Exception("外部批次尚未收齐一致收据，本机记录保留");
            db.exec("UPDATE external_batch SET state='completed',completed_at=COALESCE(completed_at,?) WHERE id=?",TIME.format(Instant.now()),id);return null;
        });
    }
    private JSONObject counts(String id) throws Exception {return db.rows("SELECT COUNT(*) AS total,COALESCE(SUM(local_kind='valid'),0) AS collected,COALESCE(SUM(local_kind='duplicate'),0) AS localDuplicates,COALESCE(SUM(receipt IS NULL),0) AS waiting,COALESCE(SUM(result_state='accepted'),0) AS accepted,COALESCE(SUM(result_state='duplicate'),0) AS duplicates,COALESCE(SUM(result_state='rejected'),0) AS rejected FROM external_event WHERE batch_id=?",id).get(0);}
    public synchronized JSONObject snapshot() throws Exception {
        JSONObject current=openBatch();if(current==null){List<JSONObject> rows=db.rows("SELECT * FROM external_batch ORDER BY rowid DESC LIMIT 1");if(!rows.isEmpty())current=rows.get(0);}
        JSONObject result=new JSONObject().put("batch",current==null?JSONObject.NULL:current).put("selection",meta("selection")==null?JSONObject.NULL:meta("selection")).put("deviceContext",meta("device")==null?JSONObject.NULL:meta("device")).put("deviceBlocked",blocked());
        result.put("queueCounts",db.rows("SELECT COUNT(*) AS total,COALESCE(SUM(e.receipt IS NULL),0) AS waiting FROM external_event e").get(0));
        result.put("batchCounts",db.rows("SELECT COALESCE(SUM(state='sealed'),0) AS pending,COALESCE(SUM(state='completed'),0) AS completed FROM external_batch").get(0));
        JSONArray recent=new JSONArray();if(current!=null){result.put("counts",counts(current.getString("id")));for(JSONObject row:db.rows("SELECT payload,receipt,local_kind FROM external_event WHERE batch_id=? ORDER BY seq DESC LIMIT 30",current.getString("id")))recent.put(new JSONObject().put("event",new JSONObject(row.getString("payload"))).put("localKind",row.getString("local_kind")).put("receipt",row.isNull("receipt")?JSONObject.NULL:new JSONObject(row.getString("receipt"))));}
        return result.put("recent",recent);
    }
    /** 外码备份仅含业务快照和收据，任何设备凭证都不进入此数据库。 */
    public synchronized JSONObject backup() throws Exception {return new JSONObject().put("batches",new JSONArray(db.rows("SELECT * FROM external_batch ORDER BY rowid"))).put("events",new JSONArray(db.rows("SELECT * FROM external_event ORDER BY rowid")));}
    public synchronized void writeBackup(OutputStream output) throws Exception {
        db.transaction(()->{Writer writer=new OutputStreamWriter(output,StandardCharsets.UTF_8);writer.write("{\"version\":1");String[] tables={"external_batch","external_event"},keys={"batches","events"};for(int i=0;i<tables.length;i++){writer.write(",\""+keys[i]+"\":[");long last=0;boolean first=true;while(true){List<JSONObject> rows=db.rows("SELECT rowid AS backup_rowid,* FROM "+tables[i]+" WHERE rowid>? ORDER BY rowid LIMIT 500",last);if(rows.isEmpty())break;for(JSONObject row:rows){last=row.getLong("backup_rowid");row.remove("backup_rowid");if(!first)writer.write(',');first=false;writer.write(row.toString());}}writer.write(']');}writer.write('}');writer.flush();return null;});
    }
}
