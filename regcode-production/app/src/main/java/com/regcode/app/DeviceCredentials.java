package com.regcode.app;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.security.KeyStore;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** 设备凭证仅在原生层使用，以Android Keystore密钥加密；不通过JS或备份导出。 */
final class DeviceCredentials {
    private final String alias;
    private final SharedPreferences preferences;
    DeviceCredentials(SharedPreferences preferences){this(preferences,"nz315.production.device.v1");}
    DeviceCredentials(SharedPreferences preferences,String alias){this.preferences=preferences;this.alias=alias;}
    private SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(alias))return (SecretKey)store.getKey(alias,null);
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    synchronized JSONObject read() throws Exception {
        String box=preferences.getString("deviceCredentialBox","");if(box.isEmpty())return null;
        JSONObject data=new JSONObject(box);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(data.getString("iv"),Base64.NO_WRAP)));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(data.getString("data"),Base64.NO_WRAP)),java.nio.charset.StandardCharsets.UTF_8));
    }
    @android.annotation.SuppressLint("ApplySharedPref") synchronized void save(JSONObject data) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        String box=new JSONObject().put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP))
            .put("data",Base64.encodeToString(cipher.doFinal(data.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)),Base64.NO_WRAP)).toString();
        if(!preferences.edit().putString("deviceCredentialBox",box).commit())throw new Exception("设备凭证未能保存，请暂停激活");
    }
    synchronized JSONObject prepare(String activationCode,String server) throws Exception {
        JSONObject prior;
        try{prior=read();}catch(Exception unreadable){prior=null;}
        if(prior!=null&&activationCode.equals(prior.optString("activationCode"))&&server.equals(prior.optString("server")))return prior;
        byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);StringBuilder secret=new StringBuilder();for(byte b:bytes)secret.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
        JSONObject data=new JSONObject().put("server",server).put("credential",secret.toString()).put("activationCode",activationCode).put("registered",false);
        save(data);return data;
    }
    synchronized void ready() throws Exception {JSONObject data=read();if(data!=null){data.put("registered",true);save(data);}}
}
