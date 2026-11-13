package com.tianxiaoxi.wowo;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/**
 * 桌面小组件：显示窝窝里每个人在做什么。内容由应用每分钟写进 SharedPreferences，
 * 应用被关掉以后显示的是最后一次的状态（标题旁边写着更新时间）。点一下打开应用。
 */
public class WowoWidget extends AppWidgetProvider {
    static final String PREFS = "wowo_widget";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    static RemoteViews build(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_wowo);
        v.setTextViewText(R.id.widget_title, p.getString("title", "恬小溪窝窝"));
        v.setTextViewText(R.id.widget_body, p.getString("body", "打开一次应用，这里就会显示大家在做什么"));
        v.setTextViewText(R.id.widget_time, p.getString("time", ""));
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        v.setOnClickPendingIntent(R.id.widget_root, pi);
        return v;
    }

    /** 保存新内容并刷新所有小组件 */
    static void push(Context ctx, String title, String body, String time) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("title", title).putString("body", body).putString("time", time).apply();
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, WowoWidget.class));
        if (ids.length > 0) {
            RemoteViews v = build(ctx);
            for (int id : ids) mgr.updateAppWidget(id, v);
        }
    }
}
