self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || self.location.origin;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existingClient = clients.find((client) => 'focus' in client);

      if (existingClient) {
        if ('navigate' in existingClient) {
          existingClient.navigate(targetUrl);
        }
        return existingClient.focus();
      }

      return self.clients.openWindow(targetUrl);
    }),
  );
});
