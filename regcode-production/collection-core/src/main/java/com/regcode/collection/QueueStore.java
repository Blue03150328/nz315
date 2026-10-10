package com.regcode.collection;

import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;

/** 所有成功提示均在SQLite事务提交之后；网络线程仅处理持久化事件。 */
public final class QueueStore {
    public interface Sql {
        void exec(String sql, Object... args) throws Exception;
        List<JSONObject> rows(String sql, Object... args) throws Exception;
        <T> T transaction(Work<T> work) throws Exception;
    }
    public interface Work<T> { T run() throws Exception; }
    private final Sql db;
    private static final Pattern CODE = Pattern.compile("(?<![0-9])[0-9]{32}(?![0-9])");
    private static final DateTimeFormatter TIME = new DateTimeFormatterBuilder().appendInstant(3).toFormatter();
    public QueueStore(Sql db) throws Exception {
        this.db = db;
        db.exec("CREATE TABLE IF NOT EXISTS session(id TEXT PRIMARY KEY,server TEXT NOT NULL,task_id INTEGER NOT NULL,phase TEXT NOT NULL,context TEXT NOT NULL,next_seq INTEGER NOT NULL DEFAULT 1,final_seq INTEGER,end_task INTEGER NOT NULL DEFAULT 0)");
        db.exec("CREATE TABLE IF NOT EXISTS allowed(session_id TEXT NOT NULL,code TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(session_id,code))");
        db.exec("CREATE TABLE IF NOT EXISTS event(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,seq INTEGER NOT NULL,code TEXT,kind TEXT NOT NULL,payload TEXT NOT NULL,receipt TEXT,result_state TEXT,UNIQUE(session_id,seq))");
        db.exec("CREATE INDEX IF NOT EXISTS idx_event_code ON event(session_id,code,kind)");
    }
    public static String codeOf(String raw) {
        String text = raw.trim();
        try { text = URLDecoder.decode(text.replace("+", "%2B"), StandardCharsets.UTF_8.name()); } catch (Exception ignored) { }
        LinkedHashSet<String> values = new LinkedHashSet<>(); Matcher matcher = CODE.matcher(text);
        while (matcher.find()) values.add(matcher.group());
        return values.size() == 1 ? values.iterator().next() : null;
    }
    public synchronized JSONObject current() throws Exception {
        List<JSONObject> rows = db.rows("SELECT * FROM session WHERE phase<>'closed' ORDER BY rowid DESC LIMIT 1");
        if (rows.isEmpty()) return null;
        JSONObject row = rows.get(0); row.put("context", new JSONObject(row.getString("context"))); return row;
    }
    public synchronized JSONObject prepare(String server, long taskId, JSONObject context) throws Exception {
        return db.transaction(() -> {
            JSONObject existing = current();
            if (existing != null) { if (!server.equals(existing.getString("server")) || taskId != existing.getLong("task_id")) throw new Exception("请先完成本机原任务的同步和结束采集"); return existing; }
            db.exec("INSERT INTO session(id,server,task_id,phase,context) VALUES (?,?,?,'starting',?)", UUID.randomUUID().toString(),server,taskId,context.toString());
            return current();
        });
    }
    public synchronized void activate(JSONObject response) throws Exception {
        db.transaction(() -> {
            JSONObject session = current();
            if (session == null || !session.getString("id").equals(response.getString("sessionId")) || !response.optBoolean("ok") || !"active".equals(response.optString("state"))) throw new Exception("无效采集会话收据");
            if (!"starting".equals(session.getString("phase"))) return null;
            if (response.getInt("lastSequence") != 0) throw new Exception("云端序号与本机不一致，请管理员核对");
            JSONObject context = response.getJSONObject("context");
            if (context.getLong("taskId") != session.getLong("task_id")) throw new Exception("云端任务收据不一致");
            JSONArray codes = response.getJSONArray("codes");
            for (int i=0;i<codes.length();i++) {
                JSONObject item=codes.getJSONObject(i); String code=item.getString("code");
                if (!code.matches("[0-9]{32}")) throw new Exception("领用清单码格式不正确");
                db.exec("INSERT INTO allowed(session_id,code,state) VALUES (?,?,?)",session.getString("id"),code,item.optInt("eligible")==1 ? "eligible" : "used".equals(item.optString("state")) ? "used" : "invalid");
            }
            db.exec("UPDATE session SET phase='open',context=? WHERE id=?",context.toString(),session.getString("id")); return null;
        });
    }
    public synchronized JSONObject capture(String raw) throws Exception {
        return db.transaction(() -> {
            JSONObject session=current();
            if (session==null || !"open".equals(session.getString("phase"))) throw new Exception("采集未开始或已经停止，不能写入扫码");
            if (raw.length()>4096) throw new Exception("扫码原文超过4096字符，请检查设备设置");
            String code=codeOf(raw), kind="valid", reason="";
            List<JSONObject> allowed=code==null ? java.util.Collections.emptyList() : db.rows("SELECT state FROM allowed WHERE session_id=? AND code=?",session.getString("id"),code);
            if (allowed.isEmpty() || "invalid".equals(allowed.get(0).getString("state"))) { kind="invalid"; reason=code==null ? "无法提取唯一完整32位追溯码" : "此码不在本任务可生产领用清单内"; }
            else if ("used".equals(allowed.get(0).getString("state")) || !db.rows("SELECT id FROM event WHERE session_id=? AND code=? AND kind='valid' AND (receipt IS NULL OR result_state<>'rejected') LIMIT 1",session.getString("id"),code).isEmpty()) { kind="duplicate"; reason="重复扫码已剔除，不重复计入生产"; }
            JSONObject event=new JSONObject().put("eventId",UUID.randomUUID().toString()).put("sequence",session.getInt("next_seq")).put("rawCode",raw).put("code",code==null ? JSONObject.NULL : code).put("kind",kind).put("reason",reason).put("capturedAt",TIME.format(Instant.now()));
            db.exec("INSERT INTO event(id,session_id,seq,code,kind,payload) VALUES (?,?,?,?,?,?)",event.getString("eventId"),session.getString("id"),event.getInt("sequence"),code,kind,event.toString());
            db.exec("UPDATE session SET next_seq=next_seq+1 WHERE id=?",session.getString("id")); return event;
        });
    }
    public synchronized JSONArray pending(int limit) throws Exception {
        JSONObject session=current(); JSONArray result=new JSONArray(); if(session==null)return result;
        for(JSONObject row:db.rows("SELECT payload FROM event WHERE session_id=? AND receipt IS NULL ORDER BY seq LIMIT ?",session.getString("id"),Math.min(50,Math.max(1,limit)))) result.put(new JSONObject(row.getString("payload")));
        return result;
    }
    public synchronized void acknowledge(JSONObject response) throws Exception {
        db.transaction(() -> {
            JSONObject session=current();
            if(session==null || !session.getString("id").equals(response.getString("sessionId"))) throw new Exception("批量同步会话收据不一致");
            JSONArray receipts=response.getJSONArray("receipts");
            for(int i=0;i<receipts.length();i++) {
                JSONObject receipt=receipts.getJSONObject(i); List<JSONObject> rows=db.rows("SELECT * FROM event WHERE id=? AND session_id=?",receipt.getString("eventId"),session.getString("id"));
                if(rows.size()!=1)throw new Exception("同步收据含未知事件");
                JSONObject row=rows.get(0), event=new JSONObject(row.getString("payload"));
                String status=receipt.getString("state");
                if(event.getInt("sequence")!=receipt.getInt("sequence") || !event.optString("code", "").equals(receipt.optString("code", "")) || !event.getString("kind").equals(receipt.getString("kind")) || !java.util.Arrays.asList("accepted","duplicate","rejected").contains(status) || ("accepted".equals(status) && !"valid".equals(event.getString("kind")))) throw new Exception("同步事件收据不一致，保留本机数据");
                if(!row.isNull("receipt")) {
                    JSONObject prior=new JSONObject(row.getString("receipt"));
                    if(!prior.getString("state").equals(status) || !prior.optString("reason").equals(receipt.optString("reason")))throw new Exception("同一事件出现冲突收据");
                }
                db.exec("UPDATE event SET receipt=?,result_state=? WHERE id=?",receipt.toString(),status,event.getString("eventId"));
            }
            return null;
        });
    }
    public synchronized void close(boolean endTask) throws Exception {
        db.transaction(() -> {
            JSONObject session=current(); if(session==null)throw new Exception("没有设备采集任务");
            if("starting".equals(session.getString("phase"))) throw new Exception("请先确认会话是否已在云端创建");
            if("open".equals(session.getString("phase"))) db.exec("UPDATE session SET phase='closing',final_seq=next_seq-1,end_task=? WHERE id=?",endTask?1:0,session.getString("id")); return null;
        });
    }
    public synchronized void complete(JSONObject response) throws Exception {
        db.transaction(() -> {
            JSONObject session=current();
            if(session==null || !"closing".equals(session.getString("phase")) || !session.getString("id").equals(response.getString("sessionId")) || !response.optBoolean("ok") || !"completed".equals(response.optString("state")) || response.getInt("lastSequence")!=session.getInt("final_seq") || pending(1).length()!=0) throw new Exception("无效结束收据，保留本机记录");
            db.exec("UPDATE session SET phase='closed' WHERE id=?",session.getString("id")); return null;
        });
    }
    public synchronized JSONObject snapshot() throws Exception {
        JSONObject session=current(); JSONObject result=new JSONObject().put("session",session==null?JSONObject.NULL:session);
        if(session==null) return result;
        JSONObject counts=db.rows("SELECT COUNT(*) AS total,SUM(kind='valid') AS collected,SUM(receipt IS NULL) AS waiting,SUM(result_state='accepted') AS accepted,SUM(kind='duplicate' OR result_state='duplicate') AS duplicates,SUM(kind='invalid' OR result_state='rejected') AS rejected FROM event WHERE session_id=?",session.getString("id")).get(0);
        result.put("counts",counts);
        JSONArray recent=new JSONArray();
        for(JSONObject row:db.rows("SELECT payload,receipt FROM event WHERE session_id=? ORDER BY seq DESC LIMIT 30",session.getString("id")))recent.put(new JSONObject().put("event",new JSONObject(row.getString("payload"))).put("receipt",row.isNull("receipt")?JSONObject.NULL:new JSONObject(row.getString("receipt"))));
        return result.put("recent",recent);
    }
    /** 备份包含所有任务、完整扫码原文和云端收据，不受界面最近30条限制。 */
    public synchronized JSONObject backup() throws Exception {
        return db.transaction(() -> new JSONObject().put("format","nz315-production-backup").put("version",1)
            .put("exportedAt",TIME.format(Instant.now()))
            .put("sessions",new JSONArray(db.rows("SELECT * FROM session ORDER BY rowid")))
            .put("allowed",new JSONArray(db.rows("SELECT * FROM allowed ORDER BY session_id,code")))
            .put("events",new JSONArray(db.rows("SELECT * FROM event ORDER BY session_id,seq"))));
    }
    /** 分页写出完整备份，长时间采集的记录也不需要全部加载进内存。 */
    public synchronized void writeBackup(OutputStream output) throws Exception {
        db.transaction(() -> {
            Writer writer=new OutputStreamWriter(output,StandardCharsets.UTF_8);
            writer.write("{\"format\":\"nz315-production-backup\",\"version\":1,\"exportedAt\":"+JSONObject.quote(TIME.format(Instant.now())));
            String[] tables={"session","allowed","event"},keys={"sessions","allowed","events"};
            for(int i=0;i<tables.length;i++){
                writer.write(",\""+keys[i]+"\":[");long last=0;boolean first=true;
                while(true){
                    List<JSONObject> page=db.rows("SELECT rowid AS backup_rowid,* FROM "+tables[i]+" WHERE rowid>? ORDER BY rowid LIMIT 500",last);
                    if(page.isEmpty())break;
                    for(JSONObject row:page){last=row.getLong("backup_rowid");row.remove("backup_rowid");if(!first)writer.write(',');first=false;writer.write(row.toString());}
                }
                writer.write(']');
            }
            writer.write('}');writer.flush();return null;
        });
    }
}
