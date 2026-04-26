const CACHE_NAME = 'hail-yes-v2';

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(['/', '/manifest.json', '/favicon.svg'])
    )
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for assets, network-first for navigation
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;

  // Network-first: always try fresh, fall back to cache when offline
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }).catch(() =>
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('/');
        return new Response('Offline', { status: 503 });
      })
    )
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || self.location.origin;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existingClient = clients.find((client) => 'focus' in client);
      if (existingClient) {
        if ('navigate' in existingClient) existingClient.navigate(targetUrl);
        return existingClient.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

// Push handler — fires when the server pushes a payload to the
// browser's push subscription. Payload shape:
//   { title, body, url, tag, data: { ... } }
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Storm Maps', body: event.data.text() };
  }
  const title = payload.title || 'Storm Alert';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/favicon.svg',
    badge: payload.badge || '/favicon.svg',
    tag: payload.tag || 'storm-maps-alert',
    renotify: Boolean(payload.renotify),
    requireInteraction: Boolean(payload.requireInteraction),
    data: { url: payload.url || self.location.origin, ...payload.data },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Allow the page to ask the SW to fire a notification (used by the
// in-tab hail-zone proximity alert and the pre-storm alert hook).
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'show-notification' && data.title) {
    const options = {
      body: data.body || '',
      icon: data.icon || '/favicon.svg',
      badge: data.badge || '/favicon.svg',
      tag: data.tag || 'storm-maps-alert',
      renotify: Boolean(data.renotify),
      requireInteraction: Boolean(data.requireInteraction),
      data: { url: data.url || self.location.origin, ...data.data },
    };
    self.registration.showNotification(data.title, options);
  }
});
