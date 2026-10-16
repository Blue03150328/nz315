package com.regcode.collection;
import org.json.JSONObject;
/** Missing/legacy roles are ordinary workers, never implicit supervisors. */
public final class CaptureAccess {
 private CaptureAccess() {}
 public static boolean leader(JSONObject identity){return identity!=null&&"line_leader".equals(identity.optString("role"));}
 public static long requireLeader(JSONObject identity)throws Exception{
  if(!leader(identity)||identity.optLong("enterpriseId")<=0)throw new Exception("仅线长可查看记录或导出备份");
  return identity.getLong("enterpriseId");
 }
 public static void sameFactory(JSONObject identity,long enterprise)throws Exception{
  if(enterprise<=0||identity.optLong("enterpriseId")!=enterprise)throw new Exception("记录不属于本厂");
 }
}
