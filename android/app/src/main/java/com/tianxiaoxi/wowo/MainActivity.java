package com.tianxiaoxi.wowo;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KeepAlivePlugin.class);
        super.onCreate(savedInstanceState);
    }

    // 切到后台时让网页继续运行：角色要接着生活、给主人发消息
    @Override
    public void onPause() {
        super.onPause();
        keepWebViewRunning();
    }

    @Override
    public void onStop() {
        super.onStop();
        keepWebViewRunning();
    }

    private void keepWebViewRunning() {
        if (getBridge() == null) return;
        WebView wv = getBridge().getWebView();
        if (wv == null) return;
        wv.onResume();
        wv.resumeTimers();
    }
}
