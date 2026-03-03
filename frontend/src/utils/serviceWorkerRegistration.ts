import { syncExistingPushSubscription } from './pushNotifications';

let waitingServiceWorker: ServiceWorker | null = null;
let hasUpdateEventFired = false;

const dispatchUpdateAvailable = () => {
  if (hasUpdateEventFired) return;
  hasUpdateEventFired = true;
  window.dispatchEvent(new CustomEvent('hivemate:update-available'));
};

const trackWaitingWorker = (registration: ServiceWorkerRegistration) => {
  if (registration.waiting) {
    waitingServiceWorker = registration.waiting;
    dispatchUpdateAvailable();
  }
};

export function register() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    const swUrl = '/sw.js';

    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        console.log('Service Worker registered:', registration);
        trackWaitingWorker(registration);

        const scheduleUpdateCheck = () => {
          if (document.visibilityState === 'visible') {
            registration.update().catch(() => undefined);
            syncExistingPushSubscription().catch((error) => {
              console.error('Push subscription sync failed:', error);
            });
          }
        };

        syncExistingPushSubscription().catch((error) => {
          console.error('Push subscription sync failed:', error);
        });

        const updateInterval = window.setInterval(scheduleUpdateCheck, 5 * 60 * 1000);
        document.addEventListener('visibilitychange', scheduleUpdateCheck);
        window.addEventListener('focus', scheduleUpdateCheck);

        registration.onupdatefound = () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;

          installingWorker.onstatechange = () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              waitingServiceWorker = registration.waiting || installingWorker;
              dispatchUpdateAvailable();
            }
          };
        };

        window.addEventListener('beforeunload', () => {
          window.clearInterval(updateInterval);
          document.removeEventListener('visibilitychange', scheduleUpdateCheck);
          window.removeEventListener('focus', scheduleUpdateCheck);
        });
      })
      .catch((error) => {
        console.error('Service Worker registration failed:', error);
      });
  });
}

export function applyUpdate() {
  if (!('serviceWorker' in navigator)) return;

  const triggerReload = () => window.location.reload();

  navigator.serviceWorker.addEventListener('controllerchange', triggerReload, { once: true });

  navigator.serviceWorker.getRegistration().then((registration) => {
    const candidateWorker =
      waitingServiceWorker ||
      registration?.waiting ||
      registration?.installing ||
      registration?.active ||
      null;

    if (candidateWorker) {
      candidateWorker.postMessage({ type: 'SKIP_WAITING' });
      waitingServiceWorker = null;
    }

    // Fallback reload so the update is applied even if controllerchange is delayed.
    window.setTimeout(triggerReload, 500);
  });
}

export function unregister() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .then(() => {
      if (!('caches' in window)) return;
      return caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
    })
    .catch((error) => {
      console.error('Service Worker unregistration failed:', error);
    });
}
