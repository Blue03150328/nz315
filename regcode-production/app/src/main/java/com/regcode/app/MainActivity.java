package com.regcode.app;

import android.app.Activity;
import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.io.OutputStream;
import com.regcode.collection.QueueStore;

/** 基于来件的WebView和PDA广播接入，页面收口为联网生产扫码。 */
public class MainActivity extends Activity {
    private static final String PAGE = "file:///android_asset/www/index.html";
    private WebView webView;
    private SharedPreferences preferences;
    private ProductionClient client;
    private QueueStore queue;
    private CollectionSync sync;
    private DeviceCredentials deviceCredentials;
    private volatile boolean capturing;
    private volatile boolean foreground;
    private boolean registered;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private ToneGenerator tone;
    private static final int BACKUP_DOCUMENT=315;
    private boolean choosingBackup;

    private final BroadcastReceiver scanReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (!foreground || "keyboard".equals(preferences.getString("mode", "auto"))) return;
            String action = intent.getAction(); String code = null;
            try {
                if ("com.android.server.scannerservice.broadcast".equals(action)) code = intent.getStringExtra("scannerdata");
                else if ("nlscan.action.SCANNER_RESULT".equals(action)) code = intent.getStringExtra("SCAN_BARCODE1");
                else if ("com.honeywell.scan.broadcast".equals(action)) code = intent.getStringExtra("data");
                else if ("com.zebra.adc.decoder.BARCODE_SCANNER".equals(action)) code = intent.getStringExtra("barcode");
                else if ("android.intent.ACTION_DECODE_DATA".equals(action)) {
                    code = intent.getStringExtra("barcode_string");
                    if (code == null) {
                        byte[] bytes = intent.getByteArrayExtra("barcode");
                        if (bytes != null) {
                            int length = intent.getIntExtra("length", bytes.length);
                            if (length > 0 && length <= bytes.length) code = new String(bytes, 0, length, StandardCharsets.UTF_8);
                        }
                    }
                }
                if (code == null && action != null && action.equals(preferences.getString("action", ""))) code = intent.getStringExtra(preferences.getString("extra", "scannerdata"));
                if (code != null && !code.trim().isEmpty() && code.length() <= 4096) {
                    // 原始码经过JSON编码，禁止用字符串拼接把二维码文本当成脚本执行。
                    evaluate("window.PDAScanAdapter&&window.PDAScanAdapter.onScan(" + JSONObject.quote(code.trim()) + "," + JSONObject.quote(action) + ")");
                }
            } catch (RuntimeException ignored) { notifyText("扫码广播数据格式不正确，请核对设备输出设置"); }
        }
    };

    // JavaScript仅用于随应用打包的自有页面，拒绝外部页面与混合内容。
    @Override @SuppressLint("SetJavaScriptEnabled") protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences("production", MODE_PRIVATE);
        if (!preferences.contains("deviceId")) preferences.edit().putString("deviceId", UUID.randomUUID().toString()).apply();
        client = new ProductionClient(BuildConfig.ALLOW_LOCAL_HTTP);
        try { client.configure(preferences.getString("server", BuildConfig.DEFAULT_SERVER)); }
        catch (Exception ignored) { client.configure("https://www.nz315.cn"); }
        deviceCredentials=new DeviceCredentials(preferences);
        restoreDeviceCredential();
        try { queue=new QueueStore(new QueueDatabase(this));sync=new CollectionSync(queue,client); }
        catch(Exception error){android.util.Log.e("NZ315PDA","本机扫码数据库初始化失败",error);notifyText("本机扫码数据库无法打开，请检查存储；禁止继续采集");}
        try { tone = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 65); }
        catch (RuntimeException ignored) { tone = null; }
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !PAGE.equals(request.getUrl().toString()); }
            @Override public void onPageFinished(WebView view, String url) { evaluate("window.App&&window.App.lifecycle(" + foreground + ")"); }
        });
        webView.addJavascriptInterface(new ProductionBridge(), "Native");
        setContentView(webView);
        webView.loadUrl(PAGE);
    }

    @Override protected void onResume() { super.onResume(); foreground = true; registerScanner(); evaluate("window.App&&window.App.lifecycle(true)"); }
    @Override protected void onPause() { foreground = false; capturing=false; unregisterScanner(); evaluate("window.App&&window.App.lifecycle(false)"); super.onPause(); }
    @Override protected void onDestroy() { unregisterScanner(); if(sync!=null)sync.stop(); executor.shutdownNow(); if (tone != null) tone.release(); if (webView != null) { webView.removeJavascriptInterface("Native"); webView.destroy(); webView = null; } super.onDestroy(); }
    @Override @SuppressWarnings("deprecation") public void onBackPressed() { evaluate("window.App&&window.App.back()"); }
    @Override @SuppressWarnings("deprecation") protected void onActivityResult(int requestCode,int resultCode,Intent data){
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode!=BACKUP_DOCUMENT)return;
        choosingBackup=false;
        if(resultCode!=RESULT_OK || data==null || data.getData()==null){notifyText("已取消导出，本机记录仍保留");return;}
        android.net.Uri destination=data.getData();
        executor.execute(()->{
            try(OutputStream output=getContentResolver().openOutputStream(destination,"wt")){
                if(output==null)throw new IllegalStateException("无法打开备份文件");
                queue.writeBackup(output);output.flush();
                notifyText("备份已导出，包含完整采集记录和上传收据；本机记录保留");
            }catch(Exception error){notifyText("备份导出失败，请重新选择保存位置；本机记录保留");}
        });
    }

    private void registerScanner() {
        if (registered || preferences == null || "keyboard".equals(preferences.getString("mode", "auto"))) return;
        IntentFilter filter = new IntentFilter();
        for (String action : new String[] {"com.android.server.scannerservice.broadcast", "nlscan.action.SCANNER_RESULT", "com.honeywell.scan.broadcast", "com.zebra.adc.decoder.BARCODE_SCANNER", "android.intent.ACTION_DECODE_DATA"}) filter.addAction(action);
        String custom = preferences.getString("action", ""); if (custom != null && !custom.isEmpty()) filter.addAction(custom);
        // 扫码服务来自独立应用，Android13以上也需要接收其他UID的广播。
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(scanReceiver, filter, Context.RECEIVER_EXPORTED);
        else registerReceiver(scanReceiver, filter);
        registered = true;
    }
    private void unregisterScanner() { if (registered) { unregisterReceiver(scanReceiver); registered = false; } }
    private void evaluate(String script) { runOnUiThread(() -> { if (webView != null && !isFinishing() && !isDestroyed()) webView.evaluateJavascript(script, null); }); }
    private void notifyText(String message) { runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_SHORT).show()); }
    private String deviceName() { String value = Build.MANUFACTURER + " " + Build.MODEL + " / " + preferences.getString("deviceId", ""); return value.substring(0, Math.min(100, value.length())); }
    private void restoreDeviceCredential(){try{if(queue!=null&&queue.current()!=null&&queue.current().getJSONObject("context").optLong("deviceId")==0){client.accountMode();return;}JSONObject data=deviceCredentials.read();if(data!=null&&preferences.getString("server",BuildConfig.DEFAULT_SERVER).equals(data.optString("server")))client.deviceCredential(data.getString("credential"));}catch(Exception ignored){/* Keystore丢失时不假定设备已获授权。 */}}
    private JSONObject activateDevice(JSONObject input) throws Exception {
        if(queue==null||queue.current()!=null)throw new IllegalArgumentException("本机有未结束采集，请先使用原认证方式同步并结束后再激活");
        String code=input.optString("activationCode").trim();
        if(code.isEmpty()){JSONObject pending=deviceCredentials.read();if(pending!=null)code=pending.optString("activationCode");}
        if(!code.startsWith("NZ315-DEVICE:")||code.length()>2048)throw new IllegalArgumentException("请扫描后台生成的设备激活二维码");
        JSONObject activation=new JSONObject(new String(android.util.Base64.decode(code.substring(13),android.util.Base64.URL_SAFE|android.util.Base64.NO_WRAP|android.util.Base64.NO_PADDING),StandardCharsets.UTF_8));
        String server=preferences.getString("server",BuildConfig.DEFAULT_SERVER);
        if(activation.optInt("v")!=1||!server.equals(activation.optString("server")))throw new IllegalArgumentException("激活二维码与当前服务器不一致，请先检查连接设置");
        if(!activation.optString("token").matches("[a-f0-9]{64}"))throw new IllegalArgumentException("激活二维码格式无效");
        JSONObject credentials=deviceCredentials.prepare(code,server);
        JSONObject body=new JSONObject().put("token",activation.getString("token")).put("credential",credentials.getString("credential"))
            .put("instanceId",preferences.getString("deviceId","")).put("model",Build.MANUFACTURER+" "+Build.MODEL)
            .put("androidId",android.provider.Settings.Secure.getString(getContentResolver(),android.provider.Settings.Secure.ANDROID_ID));
        JSONObject result=client.request("POST","/api/device/activate",body.toString());
        if(result.optInt("status")==200){deviceCredentials.ready();client.deviceCredential(credentials.getString("credential"));}
        return result;
    }

    public final class ProductionBridge {
        @JavascriptInterface public String settings() {
            try { return new JSONObject().put("server", preferences.getString("server", BuildConfig.DEFAULT_SERVER)).put("mode", preferences.getString("mode", "auto"))
                    .put("action", preferences.getString("action", "")).put("extra", preferences.getString("extra", "scannerdata"))
                    .put("device", deviceName()).toString(); }
            catch (Exception ignored) { return "{}"; }
        }
        @JavascriptInterface public String deviceInfo(){
            try{JSONObject data=deviceCredentials.read();boolean exists=data!=null&&preferences.getString("server",BuildConfig.DEFAULT_SERVER).equals(data.optString("server"));return new JSONObject().put("hasCredential",exists).put("registered",exists&&data.optBoolean("registered")).put("pendingActivation",exists&&!data.optBoolean("registered")&&data.has("activationCode")).toString();}
            catch(Exception ignored){return "{\"hasCredential\":false,\"error\":\"设备凭证不可用，请联系管理员重新激活\"}";}
        }
        // 地址必须先持久化，防止断电后待核对码被带到另一服务器；调用在JS桥线程执行。
        @JavascriptInterface @SuppressLint("ApplySharedPref") public String configure(String input) {
            try {
                JSONObject data = new JSONObject(input);
                String target=data.getString("server").replaceAll("/+$", "");
                if(queue==null)throw new IllegalStateException("本机数据库不可用");
                JSONObject existing=queue.current();
                if (existing!=null && !target.equals(existing.getString("server"))) throw new IllegalArgumentException("本机采集尚未结束，请先在原服务器完成同步");
                String mode = data.optString("mode", "auto"), action = data.optString("action"), extra = data.optString("extra", "scannerdata");
                if (!(mode.equals("auto") || mode.equals("broadcast") || mode.equals("keyboard")) || action.length() > 150 || extra.length() > 100 || extra.isEmpty()) throw new IllegalArgumentException("扫码设置格式不正确");
                client.configure(target);if(sync!=null)sync.authenticated(false);
                if (!preferences.edit().putString("server", data.getString("server").replaceAll("/+$", "")).putString("mode", mode).putString("action", action).putString("extra", extra).commit()) throw new IllegalStateException("设备未能保存连接设置");
                restoreDeviceCredential();
                runOnUiThread(() -> { unregisterScanner(); if (foreground) registerScanner(); });
                return "";
            } catch (Exception error) { return error instanceof IllegalArgumentException ? error.getMessage() : "请检查服务器地址与扫码设置"; }
        }
        @JavascriptInterface public String requestId() { return UUID.randomUUID().toString(); }
        private String failure(Exception error){try{return new JSONObject().put("ok",false).put("error",error.getMessage()==null?"本机数据操作失败，请暂停检查存储":error.getMessage()).toString();}catch(Exception ignored){return "{\"ok\":false,\"error\":\"本机存储不可用\"}";}}
        @JavascriptInterface public String queue() {
            try { if(queue==null)throw new Exception("本机扫码数据库不可用");return queue.snapshot().put("ok",true).put("syncMessage",sync.message()).put("loginRequired",sync.loginRequired()).put("deviceBlocked",sync.blocked()).toString(); }
            catch(Exception error){return failure(error);}
        }
        @JavascriptInterface public String prepare(long taskId,String userJson) {
            capturing=false;
            try { JSONObject user=new JSONObject(userJson);if(sync.blocked())throw new Exception("设备已停用，请联系管理员");queue.prepare(preferences.getString("server",BuildConfig.DEFAULT_SERVER),taskId,new JSONObject().put("device",deviceName()).put("userId",user.getLong("id")).put("deviceId",client.deviceMode()?user.optLong("device_id"):0));return queue(); }
            catch(Exception error){return failure(error);}
        }
        @JavascriptInterface public String collect(String raw) {
            try { if(sync.blocked() || (queue.current()!=null && queue.current().getJSONObject("context").optLong("deviceId")>0 && !client.deviceMode()))throw new Exception("设备已停用或认证失效，已停止采集；本机记录保留");if(!foreground || !capturing)throw new Exception("扫码已暂停，请先点击开始采集");return new JSONObject().put("ok",true).put("event",queue.capture(raw)).toString(); }
            catch(Exception error){capturing=false;return failure(error);}
        }
        @JavascriptInterface public void capturing(boolean value){capturing=value && foreground;}
        @JavascriptInterface public String finishCollection(boolean endTask) {
            capturing=false;try{queue.close(endTask);return queue();}catch(Exception error){return failure(error);}
        }
        @JavascriptInterface public void resumeUpload(){if(sync!=null)sync.authenticated(true);}
        @JavascriptInterface public String uploadNow(){
            try{if(sync==null)throw new Exception("本机数据库不可用");return new JSONObject().put("ok",sync.uploadNow()).put("loginRequired",sync.loginRequired()).put("message",sync.message()).toString();}
            catch(Exception error){return failure(error);}
        }
        @JavascriptInterface @SuppressWarnings("deprecation") public void exportBackup(){
            runOnUiThread(()->{
                if(queue==null){notifyText("本机数据库不可用，无法导出");return;}
                if(choosingBackup)return;
                Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json")
                    .putExtra(Intent.EXTRA_TITLE,"nz315-production-backup-"+System.currentTimeMillis()+".json");
                try{choosingBackup=true;startActivityForResult(intent,BACKUP_DOCUMENT);}
                catch(RuntimeException error){choosingBackup=false;notifyText("无法打开保存位置，请检查设备文件管理器");}
            });
        }
        @JavascriptInterface public void request(String id, String method, String path, String body) {
            executor.execute(() -> {
                JSONObject result;
                String requestBody=body;
                try{
                    if("/api/device/activate".equals(path))result=activateDevice(new JSONObject(requestBody));
                    else{
                        if("/api/auth/login".equals(path)){if(queue.current()!=null&&queue.current().getJSONObject("context").optLong("deviceId")>0)throw new IllegalArgumentException("本机是设备认证采集，请先恢复原设备认证完成同步");client.accountMode();}
                        if("/api/device/context".equals(path))restoreDeviceCredential();
                        if("/api/device/context".equals(path)&&"POST".equals(method)){JSONObject snapshot=queue.snapshot();requestBody=new JSONObject().put("pending",snapshot.optJSONObject("counts")==null?0:snapshot.getJSONObject("counts").optInt("waiting")).toString();}
                        result=client.request(method,path,requestBody);
                        if("/api/device/context".equals(path)&&result.optInt("status")==200){deviceCredentials.ready();if(sync!=null)sync.authenticated(true);}
                    }
                }catch(Exception error){try{result=new JSONObject().put("status",0).put("error",error instanceof IllegalArgumentException?error.getMessage():"设备凭证未能保存，请暂停操作后重试");}catch(Exception impossible){return;}}
                if(sync!=null){if(result.optInt("status")==401)sync.authenticated(false);
                    else if("/api/auth/login".equals(path) && result.optInt("status")==200 && client.hasSession())sync.authenticated(true);}
                if(client.deviceMode()&&sync!=null&&(result.optInt("status")==401||result.optInt("status")==403)){sync.deviceBlocked();capturing=false;}
                evaluate("window.NzApi&&window.NzApi.receive(" + JSONObject.quote(id) + "," + result + ")");
            });
        }
        @JavascriptInterface public void confirmed() {
            runOnUiThread(() -> {
                if (!foreground) return;
                Vibrator vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
                if (vibrator != null) vibrator.vibrate(VibrationEffect.createOneShot(80, VibrationEffect.DEFAULT_AMPLITUDE));
                if (tone != null) tone.startTone(ToneGenerator.TONE_PROP_ACK, 100);
            });
        }
        @JavascriptInterface public void rejected() { runOnUiThread(()->{if(foreground && tone!=null)tone.startTone(ToneGenerator.TONE_PROP_NACK,180);}); }
        @JavascriptInterface public void clearSession() { if(sync!=null)sync.authenticated(false); executor.execute(client::clear); }
        @JavascriptInterface public void exit() { runOnUiThread(MainActivity.this::finish); }
    }
}
