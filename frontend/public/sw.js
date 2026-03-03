// Service Worker for HiveMate
const CACHE_VERSION = 'v2';
const STATIC_CACHE = `hivemate-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `hivemate-dynamic-${CACHE_VERSION}`;

// Assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons.svg'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE && name !== DYNAMIC_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  return self.clients.claim();
});

// Fetch event - network-first for app shell, cache-first for static chunks
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip API calls and WebSocket connections
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) {
    return;
  }

  const isNavigation = request.mode === 'navigate';
  const isIndexRequest = url.pathname === '/' || url.pathname === '/index.html';
  const isHashedAsset = /^\/assets\/.+\.[a-z0-9]+?\.(js|css)$/i.test(url.pathname);

  if (isNavigation || isIndexRequest) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((networkResponse) => networkResponse)
        .catch(async () => {
          const cache = await caches.open(STATIC_CACHE);
          return (await cache.match('/')) || (await cache.match('/index.html'));
        })
    );
    return;
  }

  if (isHashedAsset) {
    event.respondWith(
      caches.match(request).then(async (cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
          const cache = await caches.open(DYNAMIC_CACHE);
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(async (networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const cache = await caches.open(DYNAMIC_CACHE);
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      })
      .catch(() => caches.match(request))
  );
});

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Push event - friend request notifications (PWA).
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'HiveMate', body: event.data.text() };
  }
  console.log('Push Payload:', payload);

  const title = payload.title || 'HiveMate';
  const payloadData = payload.data || {};
  const pushSentAt = Number(payload.sentAt || payloadData.sentAt || 0);
  if (pushSentAt > 0) {
    const latencyMs = Date.now() - pushSentAt;
    console.log('[SW] push delivery latency (ms):', latencyMs);
  }
  const resolvedNotificationType = payload.notificationType || payloadData.notificationType || '';
  const resolvedChatRoomId = payload.chatRoomId || payloadData.chatRoomId || '';
  const isMessageNotification = resolvedNotificationType === 'message';
  const isCallNotification = resolvedNotificationType === 'call_request';
  const primaryActionTitle = isCallNotification
    ? 'Answer call'
    : isMessageNotification
      ? 'View message'
      : 'View request';
  const primaryAction = isCallNotification ? 'answer' : 'open';
  const options = {
    body: payload.body || 'You have a new update.',
    icon: payload.icon || '/icons.svg',
    badge: payload.badge || '/icons.svg',
    tag: payload.tag || 'hivemate-notification',
    renotify: true,
    requireInteraction: isCallNotification,
    vibrate: isCallNotification ? [180, 80, 180, 80, 180] : [120, 60, 120],
    data: {
      url: payload.url || payloadData.url || '/connections',
      notificationType: resolvedNotificationType,
      chatRoomId: resolvedChatRoomId,
      senderId:
        payload.senderId ||
        payload.fromUserId ||
        payload.userId ||
        payloadData.senderId ||
        payloadData.fromUserId ||
        payloadData.userId ||
        '',
      callId: payload.callId || payloadData.callId || '',
      callType: payload.callType || payloadData.callType || '',
      callerId: payload.callerId || payloadData.callerId || ''
    },
    actions: [
      { action: primaryAction, title: primaryActionTitle },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  const notificationPromise = self.registration
    .showNotification(title, options)
    .catch((err) => {
      console.error('[SW] showNotification failed:', err);
    });

  event.waitUntil(notificationPromise);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const notificationData = (event.notification && event.notification.data) || {};
  console.log('[SW] notificationclick received', {
    action: event.action || 'default',
    notificationData
  });

  let targetUrl = notificationData.url || '/connections';
  const notificationType = String(notificationData.notificationType || '');
  const chatRoomId = String(notificationData.chatRoomId || '');
  const senderId = String(notificationData.senderId || '');
  const callId = String(notificationData.callId || '');
  const callerId = String(notificationData.callerId || '');
  const callType = String(notificationData.callType || 'voice');

  if (notificationType === 'message') {
    if (chatRoomId) {
      targetUrl = `/chat?room=${encodeURIComponent(chatRoomId)}`;
    } else if (senderId) {
      targetUrl = `/chat?user=${encodeURIComponent(senderId)}`;
    } else {
      targetUrl = '/chat';
    }
  } else if (notificationType === 'call_request' && callId) {
    const params = new URLSearchParams({
      incomingCall: '1',
      callId,
      type: callType === 'video' ? 'video' : 'voice',
      from: callerId,
      name: ''
    });
    targetUrl = `/chat?${params.toString()}`;
  }

  if (event.action === 'answer') {
    try {
      const urlObj = new URL(targetUrl, self.location.origin);
      urlObj.searchParams.set('autoAnswer', '1');
      targetUrl = urlObj.toString();
    } catch {
      // keep original url on parse issues
    }
  } else if (!/^https?:\/\//i.test(targetUrl)) {
    try {
      targetUrl = new URL(targetUrl, self.location.origin).toString();
    } catch {
      // keep original value
    }
  }

  console.log('[SW] notificationclick resolved targetUrl', {
    notificationType,
    chatRoomId,
    senderId,
    targetUrl
  });

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      console.log('[SW] notificationclick matched clients', {
        clientCount: clientList.length
      });
      for (const client of clientList) {
        if ('focus' in client) {
          try {
            console.log('[SW] Focusing existing client', { url: client.url });
            await client.focus();
            try {
              client.postMessage({
                type: 'NAVIGATE_TO_CHAT',
                url: targetUrl,
                chatRoomId
              });
              console.log('[SW] Posted SPA navigation message to focused client', { to: targetUrl, chatRoomId });
              return;
            } catch (postError) {
              console.error('[SW] postMessage failed, falling back to navigate', postError);
            }
            if ('navigate' in client) {
              console.log('[SW] Navigating existing client', { to: targetUrl });
              await client.navigate(targetUrl);
            }
            return;
          } catch {
            // try next fallback
          }
        }
      }
      if (clients.openWindow) {
        console.log('[SW] Opening new window for notification target', { to: targetUrl });
        return clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
