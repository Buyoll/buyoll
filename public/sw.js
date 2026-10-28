// Buyoll Social Fintech Service Worker - Push Notifications & PWA
const CACHE_NAME = 'buyoll-cache-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        )
      ),
    ])
  );
});

// Push notification event (triggered from Web Push server)
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Buyoll Alert', body: event.data ? event.data.text() : 'You have a new update in Buyoll.' };
  }

  const title = data.title || 'Buyoll Chama Notification';
  const options = {
    body: data.body || 'Open Buyoll to check your latest Chama update.',
    icon: data.icon || '/buyoll_logo.png',
    badge: data.badge || '/buyoll_logo.png',
    tag: data.tag || `buyoll_${Date.now()}`,
    vibrate: [200, 100, 200, 100, 200],
    data: {
      url: data.url || '/',
      groupId: data.groupId,
      type: data.type || 'general',
      timestamp: Date.now(),
    },
    actions: data.actions || [
      { action: 'open', title: 'Open Chama' },
      { action: 'close', title: 'Dismiss' },
    ],
    requireInteraction: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Message event from main window to trigger visual push notifications even when minimized
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    const notificationOptions = {
      icon: '/buyoll_logo.png',
      badge: '/buyoll_logo.png',
      vibrate: [200, 100, 200],
      requireInteraction: true,
      ...options,
    };
    event.waitUntil(
      self.registration.showNotification(title || 'Buyoll Alert', notificationOptions)
    );
  }
});

// Notification click event: focus window or open target link
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  const groupId = event.notification.data && event.notification.data.groupId;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a window is already open, focus it and post a navigation message
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({
            type: 'NOTIFICATION_CLICKED',
            url: targetUrl,
            groupId: groupId,
          });
          return;
        }
      }
      // If no window is open, open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
