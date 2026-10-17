package com.regcode.app;

import android.app.Activity;
import android.os.Bundle;
import android.content.*;
import android.view.*;
import android.widget.*;
import android.graphics.Color;
import android.media.ToneGenerator;
import android.media.AudioManager;
import org.json.*;
import com.regcode.collection.WorkerStore;
import java.nio.charset.StandardCharsets;
import java.io.FileOutputStream;

/** 无联网权限的独立探针，复用项目真实采集核心和SQLite适配，不接触正式包数据。 */
public final class ScannerProbeActivity extends Activity {
 private QueueDatabase driver; private WorkerStore store; private TextView status,last; private EditText input;
 private boolean armed=false,registered=false; private String channel="",lastRaw="",lastKind="",message="等待开始";
 private long acceptedInputs=0,pausedInputs=0; private ToneGenerator tone;
 private final JSONObject profile=new JSONObject();
 private final BroadcastReceiver receiver=new BroadcastReceiver(){public void onReceive(Context c,Intent i){
  String action=i.getAction(),raw=null;
  try{
   if("com.android.server.scannerservice.broadcast".equals(action))raw=i.getStringExtra("scannerdata");
   else if("nlscan.action.SCANNER_RESULT".equals(action))raw=i.getStringExtra("SCAN_BARCODE1");
   else if("com.honeywell.scan.broadcast".equals(action))raw=i.getStringExtra("data");
   else if("com.zebra.adc.decoder.BARCODE_SCANNER".equals(action))raw=i.getStringExtra("barcode");
   else if("android.intent.ACTION_DECODE_DATA".equals(action)){
    raw=i.getStringExtra("barcode_string");if(raw==null){byte[] b=i.getByteArrayExtra("barcode");if(b!=null){int n=i.getIntExtra("length",b.length);if(n>0&&n<=b.length)raw=new String(b,0,n,StandardCharsets.UTF_8);}}
   }
   if(raw!=null)capture(raw,"广播："+action);
  }catch(Exception e){message="输入错误："+e.getMessage();render();}
 }};
 public void onCreate(Bundle b){super.onCreate(b);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  try{
   profile.put("identity",new JSONObject().put("id",1).put("name","隔离测试员").put("username","probe").put("enterpriseId",999999).put("deviceId",999999)).put("grantId","local-probe");
   driver=new QueueDatabase(this,"isolated-probe.sqlite");store=new WorkerStore(driver);
   if(store.currentRun()==null){
    store.stage("probe","products",new JSONArray().put(new JSONObject().put("id",1).put("name","虚构产品").put("code_head","00000000000")));
    store.stage("probe","pools",new JSONArray().put(new JSONObject().put("id","task-9").put("task_id",9).put("task_name","隔离测试").put("line_name","隔离测试线")));
    store.stage("probe","codes",new JSONArray());store.commitCache(new JSONObject().put("id","probe").put("stockVersion",2).put("productionScanVersion",1).put("expiresAt",Long.MAX_VALUE).put("products",1).put("pools",1).put("codes",0));
    store.start(new JSONObject().put("mode","production").put("lineWorkflow",true).put("stockWorkflow",true).put("unifiedScan",true).put("taskId",9).put("productId",1).put("batchNo","USB-PROBE").put("produceDate","2026-10-17").put("expireDate","2027-10-17"),profile,System.currentTimeMillis());
   }
   tone=new ToneGenerator(AudioManager.STREAM_NOTIFICATION,65);
   LinearLayout box=new LinearLayout(this);box.setOrientation(1);box.setPadding(20,20,20,20);box.setBackgroundColor(Color.WHITE);
   TextView title=new TextView(this);title.setText("内外码·实机隔离检测");title.setTextSize(23);box.addView(title);
   TextView note=new TextView(this);note.setText("无联网权限，仅本机测试，不上传生产系统。\n使用电脑上的专用测试码；不要扫描生产标签。");note.setTextSize(15);box.addView(note);
   status=new TextView(this);status.setTextSize(20);box.addView(status);
   Button start=new Button(this);start.setText("开始／继续检测");start.setOnClickListener(v->{armed=true;message="检测运行中";render();input.requestFocus();});box.addView(start);
   Button pause=new Button(this);pause.setText("暂停检测");pause.setOnClickListener(v->{armed=false;message="检测已暂停";render();});box.addView(pause);
   input=new EditText(this);input.setSingleLine(true);input.setHint("实体扫描或键盘输入");input.setOnKeyListener((v,key,event)->{if(key==KeyEvent.KEYCODE_ENTER&&event.getAction()==KeyEvent.ACTION_DOWN){capture(input.getText().toString(),"键盘");input.setText("");return true;}return false;});box.addView(input);
   last=new TextView(this);last.setTextSize(16);box.addView(last);setContentView(box);getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);render();
  }catch(Exception e){TextView fail=new TextView(this);fail.setText("检测初始化失败："+e);setContentView(fail);}
 }
 protected void onResume(){super.onResume();IntentFilter f=new IntentFilter();for(String a:new String[]{"com.android.server.scannerservice.broadcast","nlscan.action.SCANNER_RESULT","com.honeywell.scan.broadcast","com.zebra.adc.decoder.BARCODE_SCANNER","android.intent.ACTION_DECODE_DATA"})f.addAction(a);registerReceiver(receiver,f);registered=true;render();}
 protected void onPause(){armed=false;if(registered){unregisterReceiver(receiver);registered=false;}message="离开页面，检测已暂停";render();super.onPause();}
 protected void onDestroy(){if(driver!=null)driver.close();if(tone!=null)tone.release();super.onDestroy();}
 private void capture(String raw,String source){
  channel=source;lastRaw=raw;
  if(!armed){pausedInputs++;message="暂停期间未保存，请开始后重扫";lastKind="paused";render();return;}
  try{JSONObject event=store.capture(raw,profile,System.currentTimeMillis());acceptedInputs++;lastKind=event.getString("kind");message="valid".equals(lastKind)?"本机事务已保存":"duplicate".equals(lastKind)?"重复码已记录":"异常码已记录";if(tone!=null)tone.startTone("valid".equals(lastKind)?ToneGenerator.TONE_PROP_ACK:ToneGenerator.TONE_PROP_NACK,120);render();}
  catch(Exception e){armed=false;message="本次未保存："+e.getMessage();render();}
 }
 private void render(){if(store==null||status==null)return;try{
  JSONObject snapshot=store.snapshot(1),c=snapshot.getJSONObject("counts");status.setText((armed?"运行中":"已暂停")+"\n有效 "+c.optInt("collected")+"　内码 "+c.optInt("internal")+"　外码 "+c.optInt("external")+"\n重复 "+c.optInt("duplicates")+"　异常 "+c.optInt("exceptions")+"\n本地测试记录 "+c.optInt("total"));
  last.setText(message+"\n"+channel+"\n"+(lastRaw.length()>200?lastRaw.substring(0,200):lastRaw));
  JSONObject report=new JSONObject().put("armed",armed).put("counts",c).put("channel",channel).put("lastRaw",lastRaw).put("lastKind",lastKind).put("message",message).put("acceptedInputsThisProcess",acceptedInputs).put("pausedInputsThisProcess",pausedInputs).put("snapshot",snapshot);
  try(FileOutputStream out=openFileOutput("probe-report.json",MODE_PRIVATE)){out.write(report.toString().getBytes(StandardCharsets.UTF_8));}
 }catch(Exception e){status.setText("读取失败："+e);}}
}
