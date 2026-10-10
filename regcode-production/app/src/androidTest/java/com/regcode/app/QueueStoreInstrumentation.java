package com.regcode.app;

import android.app.Instrumentation;
import android.app.Activity;
import android.content.Context;
import android.content.ContextWrapper;
import android.os.Bundle;
import com.regcode.collection.QueueStore;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.File;
import java.util.UUID;

/** 实机SQLite适配验收：独立临时数据库，不访问业务库或生产会话。 */
public final class QueueStoreInstrumentation extends Instrumentation {
    @Override public void onCreate(Bundle arguments){super.onCreate(arguments);start();}
    private static void check(boolean value,String reason){if(!value)throw new AssertionError(reason);}
    @Override public void onStart(){
        Bundle result=new Bundle();
        File testFile=new File(getTargetContext().getCacheDir(),"queue-instrumentation-"+UUID.randomUUID()+".sqlite");
        Context isolated=new ContextWrapper(getTargetContext()){
            @Override public File getDatabasePath(String name){return testFile;}
        };
        QueueDatabase driver=null;
        int outcome=Activity.RESULT_CANCELED;
        String credentialTestName="device-credential-test-"+UUID.randomUUID();
        android.content.SharedPreferences credentialPrefs=getTargetContext().getSharedPreferences(credentialTestName,Context.MODE_PRIVATE);
        try{
            DeviceCredentials credentials=new DeviceCredentials(credentialPrefs,credentialTestName);
            JSONObject initial=credentials.prepare("NZ315-DEVICE:test-code","https://www.nz315.cn");
            String secret=initial.getString("credential");check(secret.matches("[a-f0-9]{64}"),"credential is not 256 bits");
            check(!credentialPrefs.getString("deviceCredentialBox","").contains(secret),"credential persisted in plaintext");
            check(secret.equals(new DeviceCredentials(credentialPrefs,credentialTestName).read().getString("credential")),"Keystore credential did not survive reopen");
            credentials.ready();check(secret.equals(credentials.prepare("NZ315-DEVICE:test-code","https://www.nz315.cn").getString("credential")),"lost activation response changed credential");
            check(credentials.read().getBoolean("registered"),"activation confirmation not persisted");
            check(!secret.equals(credentials.prepare("NZ315-DEVICE:new-code","https://www.nz315.cn").getString("credential")),"new activation reused credential");
            check(credentialPrefs.edit().putString("deviceCredentialBox","broken-box").commit(),"test corruption not committed");
            check(credentials.prepare("NZ315-DEVICE:recovery-code","https://www.nz315.cn").getString("credential").matches("[a-f0-9]{64}"),"fresh enrollment cannot recover damaged credential storage");
            try(android.database.sqlite.SQLiteDatabase legacy=android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(testFile,null)){
                try{legacy.execSQL("PRAGMA journal_mode=DELETE");}
                catch(android.database.sqlite.SQLiteException expected){android.util.Log.i("NZ315NativeTest","旧初始化语句实机复现："+expected.getMessage());}
            }
            String code="00000000000000000000000000000001";
            driver=new QueueDatabase(isolated);
            QueueStore queue=new QueueStore(driver);
            check(queue.current()==null,"new queue is not empty");
            JSONObject session=queue.prepare("https://www.nz315.cn",123,new JSONObject().put("userId",1).put("device","native-test"));
            String id=session.getString("id");
            queue.activate(new JSONObject().put("ok",true).put("sessionId",id).put("state","active").put("lastSequence",0)
                .put("context",new JSONObject().put("taskId",123).put("userId",1))
                .put("codes",new JSONArray().put(new JSONObject().put("code",code).put("eligible",1).put("state","reserved"))));
            JSONObject valid=queue.capture("https://a.example/?i="+code);
            check("valid".equals(valid.getString("kind"))&&code.equals(valid.getString("code")),"leading zero code was not preserved");
            check("duplicate".equals(queue.capture("half-url?47="+code).getString("kind")),"same code URL not deduplicated");
            check("invalid".equals(queue.capture("12345").getString("kind")),"invalid code not audited");
            JSONObject counts=queue.snapshot().getJSONObject("counts");
            check(counts.getInt("collected")==1&&counts.getInt("duplicates")==1&&counts.getInt("rejected")==1&&counts.getInt("waiting")==3,"SQLite counts differ");
            driver.close();driver=new QueueDatabase(isolated);queue=new QueueStore(driver);
            check(id.equals(queue.current().getString("id"))&&queue.pending(20).length()==3,"queue did not survive reopen");
            queue.acknowledge(new JSONObject().put("sessionId",id).put("receipts",new JSONArray().put(new JSONObject().put("eventId",valid.getString("eventId"))
                .put("sequence",valid.getInt("sequence")).put("code",code).put("kind","valid").put("state","accepted").put("reason",""))));
            check(queue.snapshot().getJSONObject("counts").getInt("accepted")==1&&queue.pending(20).length()==2,"partial receipts incorrect");
            java.io.ByteArrayOutputStream backupBytes=new java.io.ByteArrayOutputStream();queue.writeBackup(backupBytes);
            JSONObject backup=new JSONObject(backupBytes.toString("UTF-8"));
            check(backup.getJSONArray("events").length()==3&&backup.getJSONArray("allowed").length()==1,"complete native backup missing records");
            check(code.equals(backup.getJSONArray("events").getJSONObject(0).getString("code"))&&queue.pending(20).length()==2,"backup changed code or pending queue");
            queue.close(true);
            boolean stopped=false;try{queue.capture(code);}catch(Exception expected){stopped=true;}
            check(stopped&&queue.current().getInt("final_seq")==3,"stop did not freeze final sequence");
            driver.close();driver=new QueueDatabase(isolated);queue=new QueueStore(driver);
            check("closing".equals(queue.current().getString("phase"))&&queue.pending(20).length()==2,"stopped pending queue did not recover");
            result.putString("result","NATIVE_SQLITE_AND_KEYSTORE_PASSED: encrypted durable credential, response retry, credential rotation, initialization, durable transactions, leading zeros, URL dedupe, anomalies, reopen, partial receipts, complete backup, closing recovery");
            outcome=Activity.RESULT_OK;
        }catch(Throwable error){android.util.Log.e("NZ315NativeTest","Native SQLite test failed",error);result.putString("result","NATIVE_SQLITE_FAILED: "+error);}
        finally{if(driver!=null)driver.close();testFile.delete();getTargetContext().deleteSharedPreferences(credentialTestName);try{java.security.KeyStore keys=java.security.KeyStore.getInstance("AndroidKeyStore");keys.load(null);keys.deleteEntry(credentialTestName);}catch(Exception ignored){}}
        finish(outcome,result);
    }
}
