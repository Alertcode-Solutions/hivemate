package com.hivemate.app;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class HiveMateFirebaseMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        Map<String, String> data = remoteMessage.getData();
        if (data == null || data.isEmpty()) return;

        String notificationType = safe(data.get("notificationType"));
        if (notificationType.isEmpty()) {
            notificationType = safe(data.get("type"));
        }
        if (!"call_request".equals(notificationType)) return;

        String callId = safe(data.get("callId"));
        if (callId.isEmpty()) return;

        String callType = "video".equalsIgnoreCase(safe(data.get("callType"))) ? "video" : "voice";
        String callerId = safe(data.get("callerId"));
        if (callerId.isEmpty()) {
            callerId = safe(data.get("fromUserId"));
        }
        String callerName = safe(data.get("callerName"));
        if (callerName.isEmpty()) {
            callerName = "Unknown";
        }

        IncomingCallNotificationManager.showIncomingCall(
                getApplicationContext(),
                callId,
                callType,
                callerId,
                callerName
        );
    }

    private String safe(String value) {
        return value == null ? "" : value;
    }
}

