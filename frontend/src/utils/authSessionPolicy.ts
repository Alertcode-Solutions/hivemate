const isStandalonePwa = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as any).standalone === true;

const clearAuthStorage = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('userId');
  localStorage.removeItem('privateKey');
  localStorage.removeItem('publicKey');
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('userId');
};

export const applyAuthSessionPolicy = () => {
  if (typeof window === 'undefined') return;

  // PWA installs should keep auth until manual logout.
  if (isStandalonePwa()) return;

  // Browser-web sessions are tab-session scoped: if this marker is missing,
  // the previous browser session is gone, so clear persisted auth.
  const markerKey = 'hivemate:web-session-active';
  const hasMarker = sessionStorage.getItem(markerKey) === '1';
  if (!hasMarker && localStorage.getItem('token')) {
    clearAuthStorage();
  }
  sessionStorage.setItem(markerKey, '1');
};

