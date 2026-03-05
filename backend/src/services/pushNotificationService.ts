import webpush from 'web-push';
import fs from 'fs';
import admin from 'firebase-admin';
import PushSubscription from '../models/PushSubscription';
import MobilePushToken from '../models/MobilePushToken';

type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
  icon?: string;
  badge?: string;
  notificationType?: 'friend_request' | 'message' | 'call_request';
  chatRoomId?: string;
  senderId?: string;
  data?: {
    chatRoomId?: string;
    senderId?: string;
    notificationType?: 'friend_request' | 'message' | 'call_request';
    url?: string;
    sentAt?: number;
  };
  sentAt?: number;
};

class PushNotificationService {
  private static initialized = false;
  private static firebaseInitialized = false;
  private static firebaseEnabled = false;

  private static async sendToSubscription(
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: PushPayload,
    options: webpush.RequestOptions,
    context: string
  ) {
    try {
      const result = await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys.p256dh,
            auth: sub.keys.auth
          }
        },
        JSON.stringify(payload),
        options
      );
      console.log(`[PUSH SUCCESS][${context}]`, {
        endpoint: sub.endpoint,
        statusCode: result?.statusCode
      });
    } catch (error: any) {
      const statusCode = error?.statusCode;
      const reason = error?.body || error?.message || 'Unknown push error';
      console.error(`[PUSH FATAL ERROR][${context}]`, {
        endpoint: sub.endpoint,
        statusCode,
        reason
      });

      if (statusCode === 404 || statusCode === 410 || statusCode === 400) {
        console.log('[PUSH] Deleting dead subscription', { endpoint: sub.endpoint });
        await PushSubscription.deleteOne({ endpoint: sub.endpoint });
      }
    }
  }

  private static initialize() {
    if (this.initialized) return;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:support@hivemate.app';

    if (!publicKey || !privateKey) {
      console.warn('VAPID keys are not configured. Web push is disabled.');
      this.initialized = true;
      return;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.initialized = true;
  }

  private static initializeFirebase() {
    if (this.firebaseInitialized) return;
    this.firebaseInitialized = true;

    try {
      if (admin.apps.length > 0) {
        this.firebaseEnabled = true;
        return;
      }

      const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
      const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '';
      let serviceAccount: admin.ServiceAccount | null = null;

      if (rawJson.trim()) {
        serviceAccount = JSON.parse(rawJson) as admin.ServiceAccount;
      } else if (serviceAccountPath.trim()) {
        const content = fs.readFileSync(serviceAccountPath.trim(), 'utf-8');
        serviceAccount = JSON.parse(content) as admin.ServiceAccount;
      }

      if (!serviceAccount || !serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
        console.warn('Firebase service account is not configured. FCM mobile push is disabled.');
        this.firebaseEnabled = false;
        return;
      }

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      this.firebaseEnabled = true;
    } catch (error) {
      console.error('Failed to initialize Firebase Admin SDK:', error);
      this.firebaseEnabled = false;
    }
  }

  static getPublicKey() {
    return process.env.VAPID_PUBLIC_KEY || '';
  }

  static isConfigured() {
    return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  }

  static isFirebaseConfigured() {
    this.initializeFirebase();
    return this.firebaseEnabled;
  }

  static async saveSubscription(
    userId: string,
    subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    }
  ) {
    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        userId,
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  static async removeSubscription(userId: string, endpoint: string) {
    await PushSubscription.deleteOne({ userId, endpoint });
  }

  static async saveMobileToken(userId: string, token: string, platform: 'android' | 'ios' = 'android') {
    if (!token || !token.trim()) return;
    await MobilePushToken.findOneAndUpdate(
      { token: token.trim() },
      {
        userId,
        token: token.trim(),
        platform
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  static async removeMobileToken(userId: string, token: string) {
    if (!token || !token.trim()) return;
    await MobilePushToken.deleteOne({ userId, token: token.trim() });
  }

  private static async sendFcmCallDataPush(
    recipientUserId: string,
    callerName: string,
    callerId: string,
    callType: 'voice' | 'video',
    callId: string
  ) {
    this.initializeFirebase();
    if (!this.firebaseEnabled) return;

    const mobileTokens = await MobilePushToken.find({ userId: recipientUserId }).lean();
    if (!mobileTokens.length) return;

    const tokens = mobileTokens.map((entry) => String(entry.token || '').trim()).filter(Boolean);
    if (!tokens.length) return;

    const message: admin.messaging.MulticastMessage = {
      tokens,
      data: {
        notificationType: 'call_request',
        callId: String(callId || ''),
        callType: callType === 'video' ? 'video' : 'voice',
        callerId: String(callerId || ''),
        callerName: String(callerName || 'Unknown')
      },
      android: {
        priority: 'high'
      },
      apns: {
        headers: {
          'apns-priority': '10'
        },
        payload: {
          aps: {
            sound: 'default'
          }
        }
      }
    };

    try {
      const result = await admin.messaging().sendEachForMulticast(message);
      if (result.failureCount <= 0) return;

      const invalidTokens: string[] = [];
      result.responses.forEach((response, index) => {
        if (response.success) return;
        const code = response.error?.code || '';
        if (
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-registration-token')
        ) {
          const badToken = tokens[index];
          if (badToken) invalidTokens.push(badToken);
        }
      });

      if (invalidTokens.length > 0) {
        await MobilePushToken.deleteMany({ token: { $in: invalidTokens } });
      }
    } catch (error) {
      console.error('FCM call push send failed:', error);
    }
  }

  static async sendFriendRequestPush(recipientUserId: string, senderName: string) {
    this.initialize();
    if (!this.isConfigured()) return;

    const subscriptions = await PushSubscription.find({ userId: recipientUserId }).lean();
    if (!subscriptions.length) return;

    const payload: PushPayload = {
      title: 'New Connection Request',
      body: `${senderName} wants to connect with you on HiveMate.`,
      url: '/connections',
      tag: `friend-request-${recipientUserId}`,
      icon: '/icons.svg',
      badge: '/icons.svg',
      notificationType: 'friend_request'
    };

    await Promise.all(
      subscriptions.map(async (sub) => {
        await this.sendToSubscription(
          sub,
          payload,
          {
            TTL: 30,
            urgency: 'high'
          },
          'friend_request'
        );
      })
    );
  }

  static async sendMessagePush(
    recipientUserId: string,
    senderName: string,
    chatRoomId?: string,
    senderId?: string
  ) {
    this.initialize();
    if (!this.isConfigured()) return;

    const subscriptions = await PushSubscription.find({ userId: recipientUserId }).lean();
    if (!subscriptions.length) return;
    const sentAt = Date.now();

    const payload: PushPayload = {
      title: 'New Message',
      body: `${senderName} sent you a message.`,
      url: chatRoomId ? `/chat?room=${encodeURIComponent(chatRoomId)}` : '/chat',
      tag: chatRoomId ? `chat-${chatRoomId}` : `chat-${recipientUserId}`,
      icon: '/icons.svg',
      badge: '/icons.svg',
      notificationType: 'message',
      chatRoomId,
      senderId,
      sentAt,
      data: {
        url: chatRoomId ? `/chat?room=${encodeURIComponent(chatRoomId)}` : '/chat',
        notificationType: 'message',
        chatRoomId,
        senderId,
        sentAt
      }
    };

    await Promise.all(
      subscriptions.map(async (sub) => {
        await this.sendToSubscription(
          sub,
          payload,
          {
            TTL: 30,
            urgency: 'high',
            topic: chatRoomId ? `chat-${chatRoomId}` : `chat-${recipientUserId}`
          },
          'message'
        );
      })
    );
  }

  static async sendCallPush(
    recipientUserId: string,
    callerName: string,
    callerId: string,
    callType: 'voice' | 'video',
    callId: string
  ) {
    const params = new URLSearchParams({
      incomingCall: '1',
      callId,
      type: callType,
      from: callerId,
      name: callerName || 'Unknown'
    });

    const payload: PushPayload = {
      title: `Incoming ${callType} call`,
      body: `${callerName || 'Someone'} is calling you on HiveMate.`,
      url: `/chat?${params.toString()}`,
      tag: `call-${callId}`,
      icon: '/icons.svg',
      badge: '/icons.svg',
      notificationType: 'call_request'
    };

    this.initialize();
    if (this.isConfigured()) {
      const subscriptions = await PushSubscription.find({ userId: recipientUserId }).lean();
      if (subscriptions.length > 0) {
        await Promise.all(
          subscriptions.map(async (sub) => {
            await this.sendToSubscription(
              sub,
              payload,
              {
                TTL: 30,
                urgency: 'high',
                topic: `call-${callId}`
              },
              'call_request'
            );
          })
        );
      }
    }

    await this.sendFcmCallDataPush(recipientUserId, callerName, callerId, callType, callId);
  }
}

export default PushNotificationService;
