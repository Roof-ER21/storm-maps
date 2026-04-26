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
  /** Optional URL the click action should navigate to. Defaults to the current page. */
  url?: string;
  /** Whether the notification should keep showing until dismissed. */
  requireInteraction?: boolean;
}

export async function showHailZoneNotification({
  title,
  body,
  tag,
  url,
  requireInteraction = true,
}: HailZoneNotificationInput): Promise<boolean> {
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return false;
  }

  const targetUrl = url || window.location.href;
  const options: NotificationOptions = {
    body,
    tag,
    requireInteraction,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { url: targetUrl },
  };

  const registration = await registerNotificationServiceWorker();
  if (registration) {
    await registration.showNotification(title, options);
    return true;
  }

  new Notification(title, options);
  return true;
}

/**
 * Subscribe the browser to push notifications. The VAPID public key must be
 * provided by the caller (read from VITE_VAPID_PUBLIC_KEY in the app entry).
 *
 * Returns the PushSubscription so the app can POST it to its own backend for
 * server-initiated push (e.g. NWS warning issued for the rep's territory).
 *
 * Idempotent: if a subscription already exists, that one is returned.
 */
export async function subscribeToPushNotifications(
  vapidPublicKey: string,
): Promise<PushSubscription | null> {
  const registration = await registerNotificationServiceWorker();
  if (!registration || !('pushManager' in registration)) {
    return null;
  }
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  try {
    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast through the contiguous-buffer view that the Push API spec
      // accepts; TS lib.dom is overly strict about ArrayBuffer vs SharedArrayBuffer.
      applicationServerKey: urlBase64ToBuffer(vapidPublicKey) as BufferSource,
    });
  } catch (err) {
    console.warn('[notificationService] push subscribe failed', err);
    return null;
  }
}

/**
 * Convert a base64url-encoded VAPID public key into the ArrayBuffer format
 * the Push API expects.
 */
function urlBase64ToBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i += 1) {
    view[i] = rawData.charCodeAt(i);
  }
  return buffer;
}
