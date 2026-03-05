import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { useLocation, useNavigate } from 'react-router-dom';
import { getApiBaseUrl } from '../utils/runtimeConfig';
import { acquireSharedSocket, releaseSharedSocket } from '../utils/socketManager';
import './NotificationBell.css';

interface Notification {
  _id: string;
  userId: string;
  type:
    | 'nearby'
    | 'friend_request'
    | 'friend_accepted'
    | 'gig_application'
    | 'message'
    | 'call_request'
    | 'match'
    | 'match_unlike';
  title: string;
  message: string;
  data?: any;
  read: boolean;
  createdAt: string;
}

const BellIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M12 4.5a4.2 4.2 0 0 0-4.2 4.2v2.6c0 1.4-.6 2.7-1.6 3.7L5 16.2h14l-1.2-1.2a5.2 5.2 0 0 1-1.6-3.7V8.7A4.2 4.2 0 0 0 12 4.5Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <path d="M10.2 18a1.8 1.8 0 0 0 3.6 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const normalizeNotification = (notification: any): Notification => ({
  _id: notification?._id || notification?.id || `${Date.now()}-${Math.random()}`,
  userId: notification?.userId || '',
  type: notification?.type || 'message',
  title: notification?.title || 'Notification',
  message: notification?.message || '',
  data: notification?.data,
  read: Boolean(notification?.read),
  createdAt: notification?.createdAt || notification?.timestamp || new Date().toISOString()
});

const getNotificationKey = (notification: Notification): string => {
  const requestId = notification?.data?.requestId;
  const messageId = notification?.data?.messageId;
  const senderId = notification?.data?.senderId;
  if (requestId) return `friend:${requestId}`;
  if (messageId) return `message:${messageId}`;
  return `${notification.type}:${senderId || ''}:${notification.message}:${notification.createdAt}`;
};

const normalizeId = (value: any): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (value.$oid) return String(value.$oid);
    if (value._id) return normalizeId(value._id);
    if (typeof value.toString === 'function') {
      const asText = value.toString();
      if (asText && asText !== '[object Object]') return asText;
    }
  }
  return String(value);
};

const NotificationBell = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const socketHandlersRef = useRef<{
    connect?: () => void;
    notification?: (notification: any) => void;
    notificationClear?: (payload: any) => void;
    disconnect?: () => void;
  }>({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const loadNotificationsRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    loadNotifications();
    connectWebSocket();

    // Close dropdown when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      if (socketRef.current) {
        if (socketHandlersRef.current.connect) {
          socketRef.current.off('connect', socketHandlersRef.current.connect);
        }
        if (socketHandlersRef.current.notification) {
          socketRef.current.off('notification:new', socketHandlersRef.current.notification);
        }
        if (socketHandlersRef.current.notificationClear) {
          socketRef.current.off('notification:clear', socketHandlersRef.current.notificationClear);
        }
        if (socketHandlersRef.current.disconnect) {
          socketRef.current.off('disconnect', socketHandlersRef.current.disconnect);
        }
        releaseSharedSocket();
        socketRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const onSoftRefresh = () => {
      loadNotificationsRef.current();
    };

    window.addEventListener('hivemate:soft-refresh', onSoftRefresh as EventListener);
    window.addEventListener('hivemate:critical-refresh', onSoftRefresh as EventListener);
    return () => {
      window.removeEventListener('hivemate:soft-refresh', onSoftRefresh as EventListener);
      window.removeEventListener('hivemate:critical-refresh', onSoftRefresh as EventListener);
    };
  }, []);

  const connectWebSocket = () => {
    const newSocket = acquireSharedSocket();
    if (!newSocket) return;

    const handleConnect = () => {
      console.log('WebSocket connected for notifications');
      loadNotificationsRef.current();
    };

    const handleNotification = (notification: any) => {
      console.log('New notification received:', notification);
      const normalized = normalizeNotification(notification);
      setNotifications(prev => {
        const nextKey = getNotificationKey(normalized);
        const exists = prev.some((item) => getNotificationKey(item) === nextKey);
        if (exists) return prev;
        if (!normalized.read) {
          setUnreadCount((count) => count + 1);
        }
        return [normalized, ...prev];
      });
    };

    const handleNotificationClear = (payload: any) => {
      const clearType = String(payload?.type || '');
      const clearChatRoomId = normalizeId(payload?.chatRoomId);
      const clearCallId = normalizeId(payload?.callId);
      const clearCallerId = normalizeId(payload?.callerId);
      const senderIdList = Array.isArray(payload?.senderIds)
        ? payload.senderIds.map((value: any) => normalizeId(value)).filter(Boolean)
        : [];

      setNotifications((prev) => {
        const next = prev.filter((item) => {
          if (clearType === 'message' && item.type === 'message') {
            const itemChatRoomId = normalizeId(item?.data?.chatRoomId);
            const itemSenderId = normalizeId(
              item?.data?.senderId ||
              item?.data?.fromUserId ||
              item?.data?.userId
            );
            if (clearChatRoomId && itemChatRoomId === clearChatRoomId) return false;
            if (senderIdList.length > 0 && itemSenderId && senderIdList.includes(itemSenderId)) return false;
          }

          if (clearType === 'call_request' && item.type === 'call_request') {
            const itemCallId = normalizeId(item?.data?.callId);
            const itemCallerId = normalizeId(item?.data?.callerId);
            if (clearCallId && itemCallId === clearCallId) return false;
            if (clearCallerId && itemCallerId === clearCallerId) return false;
          }

          return true;
        });
        setUnreadCount(next.filter((n) => !n.read).length);
        return next;
      });
    };

    const handleDisconnect = () => {
      console.log('WebSocket disconnected');
    };

    newSocket.on('connect', handleConnect);
    newSocket.on('notification:new', handleNotification);
    newSocket.on('notification:clear', handleNotificationClear);
    newSocket.on('disconnect', handleDisconnect);
    socketHandlersRef.current = {
      connect: handleConnect,
      notification: handleNotification,
      notificationClear: handleNotificationClear,
      disconnect: handleDisconnect
    };

    socketRef.current = newSocket;
  };

  const loadNotifications = async () => {
    try {
      const token = localStorage.getItem('token');
      const API_URL = getApiBaseUrl();

      const response = await fetch(`${API_URL}/api/notifications?limit=20`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        const normalizedList: Notification[] = (data.notifications || []).map(normalizeNotification);
        const dedupedMap = new Map<string, Notification>();
        normalizedList.forEach((item) => {
          const key = getNotificationKey(item);
          if (!dedupedMap.has(key)) dedupedMap.set(key, item);
        });
        setNotifications(Array.from(dedupedMap.values()));
        setUnreadCount(data.unreadCount);
      }
    } catch (error) {
      console.error('Failed to load notifications:', error);
    }
  };

  useEffect(() => {
    loadNotificationsRef.current = loadNotifications;
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadNotificationsRef.current();
    }
  }, [isOpen]);

  const markAsRead = async (notificationId: string) => {
    try {
      const token = localStorage.getItem('token');
      const API_URL = getApiBaseUrl();

      const response = await fetch(`${API_URL}/api/notifications/${notificationId}/read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        setNotifications(prev =>
          prev.map(n => n._id === notificationId ? { ...n, read: true } : n)
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  const clearAllNotifications = async () => {
    try {
      const token = localStorage.getItem('token');
      const API_URL = getApiBaseUrl();

      const response = await fetch(`${API_URL}/api/notifications`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        setNotifications([]);
        setUnreadCount(0);
      }
    } catch (error) {
      console.error('Failed to clear all notifications:', error);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      const token = localStorage.getItem('token');
      const API_URL = getApiBaseUrl();

      const response = await fetch(`${API_URL}/api/notifications/${notificationId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const notification = notifications.find(n => n._id === notificationId);
        setNotifications(prev => prev.filter(n => n._id !== notificationId));
        if (notification && !notification.read) {
          setUnreadCount(prev => Math.max(0, prev - 1));
        }
      }
    } catch (error) {
      console.error('Failed to delete notification:', error);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'nearby':
        return '\u{1F4CD}';
      case 'friend_request':
        return '\u{1F464}';
      case 'friend_accepted':
        return '\u2705';
      case 'gig_application':
        return '\u{1F4BC}';
      case 'message':
        return '\u{1F4AC}';
      case 'call_request':
        return '\u{1F4DE}';
      case 'match':
        return '\u{1F49C}';
      case 'match_unlike':
        return '\u{1F494}';
      default:
        return '\u{1F514}';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (notification.type === 'message' || notification.type === 'call_request') {
      await deleteNotification(notification._id);
    } else if (!notification.read) {
      await markAsRead(notification._id);
    }

    setIsOpen(false);

    if (notification.type === 'friend_request' || notification.type === 'friend_accepted') {
      navigate('/connections');
      return;
    }

    if (notification.type === 'message') {
      const chatRoomId = normalizeId(notification?.data?.chatRoomId);
      const targetUserId = normalizeId(
        notification?.data?.senderId ||
        notification?.data?.fromUserId ||
        notification?.data?.userId ||
        notification?.data?.callerId
      );

      if (chatRoomId) {
        navigate(`/chat?room=${encodeURIComponent(chatRoomId)}`, {
          state: { from: `${location.pathname}${location.search}` }
        });
      } else if (targetUserId) {
        navigate(`/chat/${targetUserId}`, {
          state: { from: `${location.pathname}${location.search}` }
        });
      } else {
        navigate('/chat', {
          state: { from: `${location.pathname}${location.search}` }
        });
      }
      return;
    }

    if (notification.type === 'call_request') {
      const callId = normalizeId(notification?.data?.callId);
      const callType = notification?.data?.callType === 'video' ? 'video' : 'voice';
      const callerId = normalizeId(notification?.data?.callerId);
      const callerName = String(notification?.data?.callerName || 'Unknown');
      if (callId) {
        const params = new URLSearchParams({
          incomingCall: '1',
          callId,
          type: callType,
          from: callerId,
          name: callerName
        });
        navigate(`/chat?${params.toString()}`, {
          state: { from: `${location.pathname}${location.search}` }
        });
      } else {
        navigate('/chat', {
          state: { from: `${location.pathname}${location.search}` }
        });
      }
      return;
    }

    if (notification.type === 'match' || notification.type === 'match_unlike') {
      const targetUserId = normalizeId(
        notification?.data?.withUserId ||
        notification?.data?.requesterId ||
        notification?.data?.targetUserId
      );
      if (targetUserId) {
        navigate(`/profile/${targetUserId}`);
      } else {
        navigate('/home');
      }
      return;
    }
  };

  return (
    <div className="notification-bell-container" ref={dropdownRef}>
      <button
        className="notification-bell-button"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
        aria-label="Notifications"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <span className="bell-icon">
          <BellIcon />
        </span>
        {unreadCount > 0 && (
          <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {isOpen && (
        <div className="notification-dropdown">
          <div className="notification-header">
            <h3>Notifications</h3>
            {notifications.length > 0 && (
              <button className="mark-all-read" type="button" onClick={clearAllNotifications}>
                Clear all
              </button>
            )}
          </div>

          <div className="notification-list">
            {notifications.length === 0 ? (
              <div className="no-notifications">
                <p>No notifications yet</p>
              </div>
            ) : (
              notifications.map(notification => (
                <div
                  key={notification._id}
                  className={`notification-item ${notification.read ? 'read' : 'unread'}`}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className="notification-icon">
                    {getNotificationIcon(notification.type)}
                  </div>
                  <div className="notification-content">
                    <div className="notification-title">{notification.title}</div>
                    <div className="notification-message">{notification.message}</div>
                    <div className="notification-time">
                      {formatTimestamp(notification.createdAt)}
                    </div>
                  </div>
                  <button
                    className="notification-delete"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNotification(notification._id);
                    }}
                    aria-label="Delete notification"
                  >
                    &times;
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
