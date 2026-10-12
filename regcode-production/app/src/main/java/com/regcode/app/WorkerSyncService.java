package com.regcode.app;
import android.app.*;
import android.content.*;
import android.os.IBinder;
public final class WorkerSyncService extends Service {
 @Override public int onStartCommand(Intent intent,int flags,int startId){
  NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);manager.createNotificationChannel(new NotificationChannel("worker-sync","生产记录同步",NotificationManager.IMPORTANCE_LOW));
  PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  Notification notice=new Notification.Builder(this,"worker-sync").setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("农资315采集记录同步").setContentText("本机记录保留，联网时定时上传").setContentIntent(open).setOngoing(true).build();
  if(android.os.Build.VERSION.SDK_INT>=29)startForeground(315,notice,android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);else startForeground(315,notice);
  try{WorkerEngine.get(this);}catch(Exception error){stopSelf();}return START_STICKY;
 }
 @Override public IBinder onBind(Intent intent){return null;}
}
