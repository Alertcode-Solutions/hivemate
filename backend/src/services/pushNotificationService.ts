import webpush from 'web-push';
import PushSubscription from '../models/PushSubscription';

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

  static getPublicKey() {
    return process.env.VAPID_PUBLIC_KEY || '';
  }

  static isConfigured() {
    return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
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
    this.initialize();
    if (!this.isConfigured()) return;

    const subscriptions = await PushSubscription.find({ userId: recipientUserId }).lean();
    if (!subscriptions.length) return;

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

export default PushNotificationService;
