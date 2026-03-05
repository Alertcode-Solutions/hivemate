package com.hivemate.app;

import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String EXTRA_TARGET_URL = "hivemate_target_url";
    private String pendingLaunchUrl = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HiveMateCallBridgePlugin.class);
        super.onCreate(savedInstanceState);
        captureLaunchUrl(getIntent());
        flushPendingLaunchUrl();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureLaunchUrl(intent);
        flushPendingLaunchUrl();
    }

    @Override
    protected void onResume() {
        super.onResume();
        flushPendingLaunchUrl();
    }

    private void captureLaunchUrl(Intent intent) {
        if (intent == null) return;
        String targetUrl = intent.getStringExtra(EXTRA_TARGET_URL);
        if (TextUtils.isEmpty(targetUrl)) return;
        pendingLaunchUrl = targetUrl;
    }

    private void flushPendingLaunchUrl() {
        if (TextUtils.isEmpty(pendingLaunchUrl) || bridge == null || bridge.getWebView() == null) return;

        final String normalizedUrl =
                pendingLaunchUrl.startsWith("http://") || pendingLaunchUrl.startsWith("https://")
                        ? pendingLaunchUrl
                        : "https://localhost" + pendingLaunchUrl;

        bridge.getWebView().post(() -> bridge.getWebView().loadUrl(normalizedUrl));
        pendingLaunchUrl = null;
    }
}
