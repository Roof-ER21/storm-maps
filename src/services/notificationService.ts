const SERVICE_WORKER_URL = '/sw.js';

let serviceWorkerRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null =
  null;

export function isNotificationSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator
  );
}

export function getNotificationPermission(): NotificationPermission {
  if (!isNotificationSupported()) {
    return 'denied';
  }

  return Notification.permission;
}

export async function registerNotificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isNotificationSupported()) {
    return null;
  }

  if (!serviceWorkerRegistrationPromise) {
    serviceWorkerRegistrationPromise = navigator.serviceWorker
      .register(SERVICE_WORKER_URL)
      .catch((error) => {
        console.warn(
          '[notificationService] Failed to register service worker:',
          error,
        );
        return null;
      });
  }

  return serviceWorkerRegistrationPromise;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) {
    return 'denied';
  }

  const permission = await Notification.requestPermission();

  if (permission === 'granted') {
    await registerNotificationServiceWorker();
  }

  return permission;
}

interface HailZoneNotificationInput {
  title: string;
  body: string;
  tag: string;
}

export async function showHailZoneNotification({
  title,
  body,
  tag,
}: HailZoneNotificationInput): Promise<boolean> {
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return false;
  }

  const options: NotificationOptions = {
    body,
    tag,
    requireInteraction: true,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: {
      url: window.location.href,
    },
  };

  const registration = await registerNotificationServiceWorker();
  if (registration) {
    await registration.showNotification(title, options);
    return true;
  }

  new Notification(title, options);
  return true;
}
