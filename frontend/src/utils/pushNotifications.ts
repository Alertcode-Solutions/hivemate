import { getApiBaseUrl } from './runtimeConfig';
import { isNativeApp } from './platform';

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

const postSubscriptionToBackend = async (subscription: PushSubscription, token: string) => {
  const API_URL = getApiBaseUrl();
  await fetch(`${API_URL}/api/push/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(subscription)
  });
};

export const syncExistingPushSubscription = async () => {
  if (isNativeApp()) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return;
  }

  const token = localStorage.getItem('token');
  if (!token) return;
  if (Notification.permission !== 'granted') return;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  await postSubscriptionToBackend(subscription, token);
};

export const ensureFriendRequestPushSubscription = async () => {
  if (isNativeApp()) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return;
  }

  const token = localStorage.getItem('token');
  if (!token) return;

  if (Notification.permission === 'denied') return;
  const API_URL = getApiBaseUrl();

  const keyResponse = await fetch(`${API_URL}/api/push/public-key`);
  if (!keyResponse.ok) return;
  const keyData = await keyResponse.json();
  if (!keyData?.enabled || !keyData?.publicKey) return;

  const registration = await navigator.serviceWorker.ready;
  let permission: NotificationPermission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') return;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
    });
  }

  await postSubscriptionToBackend(subscription, token);
};
