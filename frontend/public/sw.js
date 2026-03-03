// Service Worker for HiveMate
const CACHE_VERSION = 'v4';
const STATIC_CACHE = `hivemate-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `hivemate-dynamic-${CACHE_VERSION}`;
const DYNAMIC_CACHE_MAX_ENTRIES = 120;

// Assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons.svg'
];

async function trimDynamicCache(maxEntries) {
  const cache = await caches.open(DYNAMIC_CACHE);
  const requests = await cache.keys();
  if (requests.length <= maxEntries) return;

  const deleteCount = requests.length - maxEntries;
  await Promise.all(requests.slice(0, deleteCount).map((request) => cache.delete(request)));
}

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
      fetch(request)
        .then(async (networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put('/index.html', networkResponse.clone());
          }
          return networkResponse;
        })
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
          await cache.put(request, networkResponse.clone());
          await trimDynamicCache(DYNAMIC_CACHE_MAX_ENTRIES);
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
          await cache.put(request, networkResponse.clone());
          await trimDynamicCache(DYNAMIC_CACHE_MAX_ENTRIES);
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
  console.log('[SW] Push ping received from FCM/APNs');

  const defaultPayload = { title: 'HiveMate', body: 'You have a new update.' };
  let payload = { ...defaultPayload };

  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = { ...defaultPayload, ...parsed };
      } else {
        payload = { ...defaultPayload, body: String(parsed || defaultPayload.body) };
      }
      console.log('[SW] Parsed JSON payload:', payload);
    } catch (err) {
      console.error('[SW] Failed to parse JSON, falling back to text:', err);
      try {
        const textBody = event.data.text();
        payload = { ...defaultPayload, body: textBody || defaultPayload.body };
      } catch (textErr) {
        console.error('[SW] Failed to parse text fallback:', textErr);
      }
    }
  }

  console.log('Push Payload:', payload);

  const title = payload.title || 'HiveMate';
  const payloadData =
    payload && typeof payload.data === 'object' && payload.data !== null ? payload.data : {};
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
    body: payload.body || 'You have a new message.',
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

  const unreadCount = Math.max(
    0,
    Number(
      payload.unreadCount ||
      payloadData.unreadCount ||
      payload.badgeCount ||
      payloadData.badgeCount ||
      1
    )
  );

  const badgePromise = (async () => {
    try {
      if (self.registration && 'setAppBadge' in self.registration) {
        await self.registration.setAppBadge(unreadCount);
      } else if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
        await navigator.setAppBadge(unreadCount);
      }
    } catch (badgeError) {
      console.error('[SW] setAppBadge failed:', badgeError);
    }
  })();

  const notificationPromise = self.registration
    .showNotification(title, options)
    .then(() => {
      console.log('[SW] showNotification painted successfully');
    })
    .catch((err) => {
      console.error('[SW] showNotification FATAL ERROR:', err);
    });

  event.waitUntil(Promise.all([badgePromise, notificationPromise]));
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
