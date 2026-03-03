import Notification from '../models/Notification';
import { getWebSocketServer } from '../websocket/server';
import PushNotificationService from './pushNotificationService';

export class NotificationService {
  /**
   * Create a notification and emit it via WebSocket
   */
  static async createNotification(
    userId: string,
    type:
      | 'nearby'
      | 'friend_request'
      | 'friend_accepted'
      | 'gig_application'
      | 'message'
      | 'call_request'
      | 'match'
      | 'match_unlike',
    title: string,
    message: string,
    data?: any
  ) {
    try {
      const dispatchPush = () => {
        if (type === 'friend_request') {
          const senderName = data?.senderName || message.split(' sent you')[0] || 'Someone';
          void PushNotificationService.sendFriendRequestPush(userId, senderName).catch((pushError) => {
            console.error('Friend request push send failed:', pushError);
          });
        } else if (type === 'message') {
          const senderName = data?.senderName || message.split(' sent you')[0] || 'Someone';
          const chatRoomId = data?.chatRoomId ? String(data.chatRoomId) : undefined;
          const senderId = data?.senderId ? String(data.senderId) : undefined;
          void PushNotificationService.sendMessagePush(userId, senderName, chatRoomId, senderId).catch((pushError) => {
            console.error('Message push send failed:', pushError);
          });
        } else if (type === 'call_request') {
          const callerName = data?.callerName || message.split(' is calling you')[0] || 'Someone';
          const callerId = data?.callerId ? String(data.callerId) : '';
          const callType = data?.callType === 'video' ? 'video' : 'voice';
          const callId = data?.callId ? String(data.callId) : '';
          if (callerId && callId) {
            void PushNotificationService.sendCallPush(userId, callerName, callerId, callType, callId).catch((pushError) => {
              console.error('Call push send failed:', pushError);
            });
          }
        }
      };

      // Dispatch message push immediately in background so push send doesn't wait for DB writes.
      if (type === 'message') {
        dispatchPush();
      }

      const notification = new Notification({
        userId,
        type,
        title,
        message,
        data
      });

      await notification.save();

      // Emit real-time notification via WebSocket
      try {
        const wsServer = getWebSocketServer();
        wsServer.emitToUser(userId, 'notification:new', {
          id: notification._id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          data: notification.data,
          read: notification.read,
          createdAt: notification.createdAt
        });
      } catch (wsError) {
        // WebSocket not initialized yet, skip real-time notification
        console.log('WebSocket not available, notification saved to database only');
      }

      // Push notification: friend requests and calls after persistence; message push already dispatched above.
      if (type !== 'message') {
        dispatchPush();
      }

      return notification;
    } catch (error) {
      console.error('Create notification error:', error);
      throw error;
    }
  }

  /**
   * Create nearby user notification
   */
  static async notifyNearbyUser(userId: string, nearbyUserName: string) {
    return this.createNotification(
      userId,
      'nearby',
      'Someone nearby',
      `${nearbyUserName} is nearby and in explore mode`,
      { type: 'nearby' }
    );
  }

  /**
   * Create friend request notification
   */
  static async notifyFriendRequest(userId: string, senderName: string, senderId: string) {
    return this.createNotification(
      userId,
      'friend_request',
      'New friend request',
      `${senderName} sent you a friend request`,
      { senderId, senderName, type: 'friend_request' }
    );
  }

  /**
   * Create friend accepted notification
   */
  static async notifyFriendAccepted(userId: string, accepterName: string, accepterId: string) {
    return this.createNotification(
      userId,
      'friend_accepted',
      'Friend request accepted',
      `${accepterName} accepted your friend request`,
      { accepterId, type: 'friend_accepted' }
    );
  }

  /**
   * Create gig application notification
   */
  static async notifyGigApplication(userId: string, applicantName: string, gigTitle: string, gigId: string) {
    return this.createNotification(
      userId,
      'gig_application',
      'New gig application',
      `${applicantName} applied to your gig: ${gigTitle}`,
      { gigId, type: 'gig_application' }
    );
  }

  /**
   * Create message notification
   */
  static async notifyMessage(
    userId: string,
    senderName: string,
    senderId: string,
    extraData?: Record<string, any>
  ) {
    return this.createNotification(
      userId,
      'message',
      'New message',
      `${senderName} sent you a message`,
      { senderId, type: 'message', ...(extraData || {}) }
    );
  }

  /**
   * Create call request notification
   */
  static async notifyCallRequest(
    userId: string,
    callerName: string,
    callerId: string,
    callType: 'voice' | 'video',
    callId?: string
  ) {
    return this.createNotification(
      userId,
      'call_request',
      `Incoming ${callType} call`,
      `${callerName} is calling you`,
      { callerId, callerName, callType, callId, type: 'call_request' }
    );
  }
}
