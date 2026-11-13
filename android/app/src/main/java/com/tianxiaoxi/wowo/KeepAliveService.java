package com.tianxiaoxi.wowo;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

/**
 * 前台服务：通知栏里一条常驻消息，让系统不要把应用关掉，
 * 这样网页里的游戏在后台也能继续推进时间、让角色给主人发消息。
 */
public class KeepAliveService extends Service {
    // 换了频道 id：旧的「keepalive」是最低等级，很多手机会把它折叠起来看不到；频道等级建好后改不了，只能换新的
    static final String CHANNEL = "keepalive_v2";
    static final int ID = 7001;
    private PowerManager.WakeLock wakeLock;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null && intent.hasExtra("title") ? intent.getStringExtra("title") : "恬静小窝";
        String text = intent != null && intent.hasExtra("text") ? intent.getStringExtra("text") : "大家在家里过日子";
        String big = intent != null && intent.hasExtra("big") ? intent.getStringExtra("big") : null;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.deleteNotificationChannel("keepalive");
            // 低等级：通知栏里一直看得到，但不响、不弹出
            NotificationChannel ch = new NotificationChannel(CHANNEL, "正在运行", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("通知栏里一直显示小窝正在运行、大家在做什么，让系统不要把应用关掉");
            ch.setShowBadge(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_wowo)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(pi)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setSubText("正在运行")
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setStyle(big != null ? new NotificationCompat.BigTextStyle().bigText(big) : null)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(ID, n);
        }
        // 保持 CPU 不完全睡死，后台计时器才能按时跑（屏幕照常关）
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "wowo:keepalive");
            wakeLock.setReferenceCounted(false);
        }
        if (!wakeLock.isHeld()) wakeLock.acquire();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
