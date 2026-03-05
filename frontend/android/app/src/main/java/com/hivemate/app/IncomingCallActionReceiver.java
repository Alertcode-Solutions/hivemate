package com.hivemate.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class IncomingCallActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        String action = intent.getAction();
        if (IncomingCallNotificationManager.ACTION_ANSWER.equals(action)) {
            IncomingCallNotificationManager.handleAnswerAction(context, intent);
            return;
        }
        if (IncomingCallNotificationManager.ACTION_DECLINE.equals(action)) {
            IncomingCallNotificationManager.handleDeclineAction(context, intent);
        }
    }
}

