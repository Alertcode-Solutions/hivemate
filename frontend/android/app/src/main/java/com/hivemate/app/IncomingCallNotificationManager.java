package com.hivemate.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.text.TextUtils;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

public final class IncomingCallNotificationManager {
    public static final String CHANNEL_ID = "hivemate_incoming_calls";
    public static final String ACTION_ANSWER = "com.hivemate.app.ACTION_ANSWER_CALL";
    public static final String ACTION_DECLINE = "com.hivemate.app.ACTION_DECLINE_CALL";
    public static final String EXTRA_CALL_ID = "extra_call_id";
    public static final String EXTRA_CALL_TYPE = "extra_call_type";
    public static final String EXTRA_CALLER_ID = "extra_caller_id";
    public static final String EXTRA_CALLER_NAME = "extra_caller_name";
    public static final String EXTRA_TARGET_URL = "hivemate_target_url";

    private IncomingCallNotificationManager() {}

    public static void showIncomingCall(
            Context context,
            String callId,
            String callType,
            String callerId,
            String callerName
    ) {
        createChannelIfNeeded(context);

        int notificationId = notificationIdFor(callId);
        String safeCallerName = TextUtils.isEmpty(callerName) ? "Unknown" : callerName;
        String safeCallType = "video".equalsIgnoreCase(callType) ? "video" : "voice";
        String targetUrl = buildCallUrl(callId, safeCallType, callerId, safeCallerName, false);

        Intent fullScreenIntent = new Intent(context, MainActivity.class);
        fullScreenIntent.putExtra(EXTRA_TARGET_URL, targetUrl);
        fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
                context,
                notificationId + 1,
                fullScreenIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        PendingIntent answerPendingIntent = buildActionPendingIntent(
                context, ACTION_ANSWER, callId, safeCallType, callerId, safeCallerName, notificationId + 2
        );
        PendingIntent declinePendingIntent = buildActionPendingIntent(
                context, ACTION_DECLINE, callId, safeCallType, callerId, safeCallerName, notificationId + 3
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(safeCallerName)
                .setContentText("Incoming " + safeCallType + " call")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setOnlyAlertOnce(false)
                .setContentIntent(fullScreenPendingIntent)
                .setFullScreenIntent(fullScreenPendingIntent, true)
                .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
                .setVibrate(new long[]{300, 150, 300, 150, 300})
                .addAction(0, "Decline", declinePendingIntent)
                .addAction(0, "Answer", answerPendingIntent);

        NotificationManagerCompat.from(context).notify(notificationId, builder.build());
    }

    public static void dismissIncomingCall(Context context, String callId) {
        NotificationManagerCompat.from(context).cancel(notificationIdFor(callId));
    }

    public static void handleAnswerAction(Context context, Intent intent) {
        String callId = safeString(intent.getStringExtra(EXTRA_CALL_ID));
        String callType = safeString(intent.getStringExtra(EXTRA_CALL_TYPE));
        String callerId = safeString(intent.getStringExtra(EXTRA_CALLER_ID));
        String callerName = safeString(intent.getStringExtra(EXTRA_CALLER_NAME));
        dismissIncomingCall(context, callId);

        String targetUrl = buildCallUrl(callId, callType, callerId, callerName, true);
        launchCallUi(context, targetUrl);
    }

    public static void handleDeclineAction(Context context, Intent intent) {
        String callId = safeString(intent.getStringExtra(EXTRA_CALL_ID));
        dismissIncomingCall(context, callId);
    }

    private static PendingIntent buildActionPendingIntent(
            Context context,
            String action,
            String callId,
            String callType,
            String callerId,
            String callerName,
            int requestCode
    ) {
        Intent receiverIntent = new Intent(context, IncomingCallActionReceiver.class);
        receiverIntent.setAction(action);
        receiverIntent.putExtra(EXTRA_CALL_ID, callId);
        receiverIntent.putExtra(EXTRA_CALL_TYPE, callType);
        receiverIntent.putExtra(EXTRA_CALLER_ID, callerId);
        receiverIntent.putExtra(EXTRA_CALLER_NAME, callerName);

        return PendingIntent.getBroadcast(
                context,
                requestCode,
                receiverIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static void launchCallUi(Context context, String targetUrl) {
        Intent activityIntent = new Intent(context, MainActivity.class);
        activityIntent.putExtra(EXTRA_TARGET_URL, targetUrl);
        activityIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        context.startActivity(activityIntent);
    }

    private static String buildCallUrl(
            String callId,
            String callType,
            String callerId,
            String callerName,
            boolean autoAnswer
    ) {
        Uri.Builder uriBuilder = new Uri.Builder()
                .path("/chat")
                .appendQueryParameter("incomingCall", "1")
                .appendQueryParameter("callId", callId)
                .appendQueryParameter("type", "video".equalsIgnoreCase(callType) ? "video" : "voice")
                .appendQueryParameter("from", callerId)
                .appendQueryParameter("name", callerName);

        if (autoAnswer) {
            uriBuilder.appendQueryParameter("autoAnswer", "1");
        }

        Uri built = uriBuilder.build();
        return built.toString();
    }

    private static int notificationIdFor(String callId) {
        return 700000 + Math.abs(safeString(callId).hashCode() % 100000);
    }

    private static String safeString(String value) {
        return value == null ? "" : value;
    }

    private static void createChannelIfNeeded(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Incoming calls",
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Incoming call alerts");
        channel.enableLights(true);
        channel.enableVibration(true);
        channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        channel.setVibrationPattern(new long[]{300, 150, 300, 150, 300});
        channel.setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
        );
        manager.createNotificationChannel(channel);
    }
}

