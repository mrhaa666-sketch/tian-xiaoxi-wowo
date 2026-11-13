package com.tianxiaoxi.wowo;

import android.app.AlarmManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** 给网页用的原生插件：开关前台服务、请求不受省电策略限制 */
@CapacitorPlugin(name = "KeepAlive")
public class KeepAlivePlugin extends Plugin {

    /** 更新桌面小组件的内容 */
    @PluginMethod
    public void updateWidget(PluginCall call) {
        try {
            WowoWidget.push(getContext(), call.getString("title", "恬静小窝"), call.getString("body", ""), call.getString("time", ""));
            call.resolve();
        } catch (Exception e) {
            call.reject("没能更新小组件：" + e.getMessage());
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        Context ctx = getContext();
        Intent i = new Intent(ctx, KeepAliveService.class);
        i.putExtra("title", call.getString("title", "恬静小窝"));
        i.putExtra("text", call.getString("text", "大家在家里过日子"));
        if (call.getString("big") != null) i.putExtra("big", call.getString("big"));
        try {
            ContextCompat.startForegroundService(ctx, i);
            call.resolve();
        } catch (Exception e) {
            call.reject("没能开启后台常驻：" + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), KeepAliveService.class));
        call.resolve();
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Context ctx = getContext();
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        if (!granted) {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { ctx.startActivity(i); } catch (Exception ignored) {}
        }
        JSObject r = new JSObject();
        r.put("granted", granted);
        call.resolve(r);
    }

    /** 各项后台权限现在的状态 */
    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        JSObject r = new JSObject();
        r.put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
        r.put("battery", Build.VERSION.SDK_INT < Build.VERSION_CODES.M || pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
        boolean exact = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            exact = am.canScheduleExactAlarms();
        }
        r.put("exactAlarm", exact);
        r.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase());
        r.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(r);
    }

    /** 打开「准时提醒（精确闹钟）」的系统设置页 */
    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        Context ctx = getContext();
        Intent i;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + ctx.getPackageName()));
        } else {
            i = appDetails(ctx);
        }
        call.resolve(open(ctx, i) ? ok(true) : ok(open(ctx, appDetails(ctx))));
    }

    /** 打开应用的通知设置页 */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Context ctx = getContext();
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        i.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
        call.resolve(open(ctx, i) ? ok(true) : ok(open(ctx, appDetails(ctx))));
    }

    /** 尽量打开各家手机系统的「自启动 / 后台管理」页面，打不开就打开应用详情页 */
    @PluginMethod
    public void openAutostartSettings(PluginCall call) {
        Context ctx = getContext();
        String[][] pages = {
            {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
            {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
            {"com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"},
            {"com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
            {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
            {"com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"},
            {"com.oplus.safecenter", "com.oplus.safecenter.permission.startup.StartupAppListActivity"},
            {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
            {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"},
            {"com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"},
            {"com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"},
            {"com.meizu.safe", "com.meizu.safe.permission.SmartBGActivity"},
        };
        for (String[] pg : pages) {
            Intent i = new Intent();
            i.setComponent(new ComponentName(pg[0], pg[1]));
            if (open(ctx, i)) { call.resolve(ok(true)); return; }
        }
        call.resolve(ok(open(ctx, appDetails(ctx)) && false));
    }

    private Intent appDetails(Context ctx) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        i.setData(Uri.parse("package:" + ctx.getPackageName()));
        return i;
    }

    private boolean open(Context ctx, Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private JSObject ok(boolean opened) {
        JSObject r = new JSObject();
        r.put("opened", opened);
        return r;
    }
}
