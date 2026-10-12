package com.regcode.app;
import android.content.SharedPreferences;
import android.security.keystore.*;
import android.util.Base64;
import org.json.*;
import java.security.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import java.nio.charset.StandardCharsets;
/** 按工人保存加密授权；一个设备可缓存多个已验证工人，不固定员工。 */
final class WorkerVault {
 private final SharedPreferences prefs;private JSONObject current;
 WorkerVault(SharedPreferences prefs){this.prefs=prefs;}
 private SecretKey key()throws Exception{KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);if(!ks.containsAlias("nz315-worker-vault")){KeyGenerator g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder("nz315-worker-vault",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());g.generateKey();}return (SecretKey)ks.getKey("nz315-worker-vault",null);}
 private JSONObject read()throws Exception{String s=prefs.getString("workerVault","");if(s.isEmpty())return new JSONObject().put("workers",new JSONObject()).put("grants",new JSONObject());JSONObject b=new JSONObject(s);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(b.getString("iv"),Base64.NO_WRAP)));return new JSONObject(new String(c.doFinal(Base64.decode(b.getString("data"),Base64.NO_WRAP)),StandardCharsets.UTF_8));}
 @android.annotation.SuppressLint("ApplySharedPref") private void save(JSONObject value)throws Exception{Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key());String box=new JSONObject().put("iv",Base64.encodeToString(c.getIV(),Base64.NO_WRAP)).put("data",Base64.encodeToString(c.doFinal(value.toString().getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP)).toString();if(!prefs.edit().putString("workerVault",box).commit())throw new Exception("无法保存本机工人授权");}
 private static byte[] verifier(String password,byte[] salt)throws Exception{PBEKeySpec spec=new PBEKeySpec(password.toCharArray(),salt,120000,256);try{return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();}finally{spec.clearPassword();}}
 synchronized void online(JSONObject response,String password)throws Exception{JSONObject box=read();byte[] salt=new byte[16];new SecureRandom().nextBytes(salt);JSONObject profile=new JSONObject(response.toString()).put("salt",Base64.encodeToString(salt,Base64.NO_WRAP)).put("verifier",Base64.encodeToString(verifier(password,salt),Base64.NO_WRAP));box.getJSONObject("workers").put(response.getJSONObject("identity").getString("username"),profile);box.getJSONObject("grants").put(response.getString("grantId"),response.getString("grant"));if(!box.has("exports"))box.put("exports",new JSONObject());if(response.has("exportKey"))box.getJSONObject("exports").put(response.getString("grantId"),response.getString("exportKey"));save(box);current=profile;}
 synchronized void offline(String username,String password,long now,long deviceId,String fingerprint)throws Exception{JSONObject box=read(),p=box.getJSONObject("workers").optJSONObject(username);if(p==null||p.getLong("expiresAt")<now||p.getJSONObject("identity").getLong("deviceId")!=deviceId||!fingerprint.equals(p.optString("deviceFingerprint")))throw new Exception("账号未缓存、设备已重新激活或72小时授权已过期，请联网登录");String attemptKey="workerAttempts:"+username;int failures=prefs.getInt(attemptKey,0);long unlock=prefs.getLong(attemptKey+":unlock",0);if(unlock>now)throw new Exception("离线登录失败次数过多，请稍后重试");byte[] value=verifier(password,Base64.decode(p.getString("salt"),Base64.NO_WRAP));if(!MessageDigest.isEqual(value,Base64.decode(p.getString("verifier"),Base64.NO_WRAP))){int n=failures+1;prefs.edit().putInt(attemptKey,n).putLong(attemptKey+":unlock",n>=5?now+900000:0).apply();throw new Exception("工号或密码错误");}prefs.edit().remove(attemptKey).remove(attemptKey+":unlock").apply();current=p;}
 synchronized JSONObject current(){return current;}
 synchronized void refresh(long expires)throws Exception{if(current==null)return;JSONObject box=read();current.put("expiresAt",expires);box.getJSONObject("workers").put(current.getJSONObject("identity").getString("username"),current);save(box);}
 synchronized void logout(){current=null;}
 synchronized void revokeCurrent()throws Exception{if(current==null)return;JSONObject box=read();current.put("expiresAt",0);box.getJSONObject("workers").put(current.getJSONObject("identity").getString("username"),current);save(box);current=null;}
 synchronized String exportKey(String id)throws Exception{JSONObject keys=read().optJSONObject("exports");if(keys==null||!keys.has(id))throw new Exception("该旧授权没有生产文件签名材料，旧记录请保留JSON备份并自动上传");return keys.getString(id);}
 synchronized String grant(String id)throws Exception{return read().getJSONObject("grants").getString(id);}
 synchronized void check(long now)throws Exception{if(current==null||current.getLong("expiresAt")<now)throw new Exception("工人授权失效，请登录；已有记录保留");}
}
