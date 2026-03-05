# Hybrid Setup (Non-Breaking for Web)

This repo now includes a hybrid-ready structure for Android/iOS while keeping the website behavior unchanged.

## What is already wired
- Web-only service worker + web push remain active only on browser builds.
- Native wrapper detection is added (`frontend/src/utils/platform.ts`).
- Incoming call events can invoke a native bridge if present (`frontend/src/utils/nativeCallBridge.ts`).
- Existing in-app call modal and web flows remain unchanged.

## What to install (frontend)
Run from `frontend`:

```bash
npm i @capacitor/core
npm i -D @capacitor/cli
```

## Initialize native projects
From `frontend`:

```bash
npm run build
npm run cap:add:android
npm run cap:sync
```

Optional iOS:

```bash
npm run cap:add:ios
npm run cap:sync
```

## Native call UI requirement
This repo now includes Android-native call bridge + notification implementation:
- `HiveMateCallBridge.showIncomingCall({ callId, type, callerId, callerName })`
- `HiveMateCallBridge.dismissIncomingCall({ callId })`
- Full-screen call notification with `Answer` / `Decline`
- Android broadcast receiver for call actions
- Firebase messaging service hook for `call_request` data payloads

The web app calls these methods only when running in native platform and no-ops on website.

## Outside-app incoming call behavior (Android)
To show full-screen incoming call UI when app is backgrounded/closed, backend must send FCM **data** payload including:

```json
{
  "notificationType": "call_request",
  "callId": "CALL_ID",
  "callType": "voice",
  "callerId": "USER_ID",
  "callerName": "Caller Name"
}
```

Also required in native project:
- `android/app/google-services.json`
- Firebase project + server credentials for sending FCM

## Why this does not break website
- No web routes were replaced.
- No existing call or chat API contracts were changed.
- Native hooks are guarded behind runtime checks and no-op on web.
