import { PushNotifications, Token, PermissionStatus } from '@capacitor/push-notifications';
import { getApiBaseUrl } from './runtimeConfig';
import { getNativePlatform, isNativeApp } from './platform';

const postNativeToken = async (token: string) => {
  const authToken = localStorage.getItem('token');
  if (!authToken || !token) return;
  const API_URL = getApiBaseUrl();
  await fetch(`${API_URL}/api/push/mobile-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({
      token,
      platform: getNativePlatform()
    })
  });
};

export const ensureNativePushRegistration = async () => {
  if (!isNativeApp()) return;

  const authToken = localStorage.getItem('token');
  if (!authToken) return;

  let permStatus: PermissionStatus = await PushNotifications.checkPermissions();
  if (permStatus.receive !== 'granted') {
    permStatus = await PushNotifications.requestPermissions();
  }
  if (permStatus.receive !== 'granted') return;

  PushNotifications.removeAllListeners().catch(() => undefined);

  PushNotifications.addListener('registration', (token: Token) => {
    void postNativeToken(token.value).catch((error) => {
      console.error('Failed to upload native push token:', error);
    });
  });

  PushNotifications.addListener('registrationError', (error) => {
    console.error('Native push registration error:', error);
  });

  await PushNotifications.register();
};

