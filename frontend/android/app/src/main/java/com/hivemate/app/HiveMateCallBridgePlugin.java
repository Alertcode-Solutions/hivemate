package com.hivemate.app;

import android.text.TextUtils;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "HiveMateCallBridge")
public class HiveMateCallBridgePlugin extends Plugin {

    @PluginMethod
    public void showIncomingCall(PluginCall call) {
        String callId = call.getString("callId", "");
        String rawType = call.getString("type", "voice");
        String callerId = call.getString("callerId", "");
        String callerName = call.getString("callerName", "Unknown");

        if (TextUtils.isEmpty(callId)) {
            call.reject("callId is required");
            return;
        }

        String callType = "video".equalsIgnoreCase(rawType) ? "video" : "voice";
        IncomingCallNotificationManager.showIncomingCall(
                getContext(),
                callId,
                callType,
                callerId,
                TextUtils.isEmpty(callerName) ? "Unknown" : callerName
        );

        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void dismissIncomingCall(PluginCall call) {
        String callId = call.getString("callId", "");
        if (TextUtils.isEmpty(callId)) {
            call.reject("callId is required");
            return;
        }

        IncomingCallNotificationManager.dismissIncomingCall(getContext(), callId);

        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }
}

