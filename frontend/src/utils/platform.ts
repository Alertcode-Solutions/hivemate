const getCapacitorRuntime = (): any => {
  if (typeof window === 'undefined') return null;
  return (window as any).Capacitor || null;
};

export const isNativeApp = (): boolean => {
  const cap = getCapacitorRuntime();
  if (!cap) return false;

  if (typeof cap.isNativePlatform === 'function') {
    return Boolean(cap.isNativePlatform());
  }

  const platform = typeof cap.getPlatform === 'function' ? String(cap.getPlatform()) : '';
  return platform === 'ios' || platform === 'android';
};

export const getNativePlatform = (): 'ios' | 'android' | 'web' => {
  const cap = getCapacitorRuntime();
  if (!cap) return 'web';
  const platform = typeof cap.getPlatform === 'function' ? String(cap.getPlatform()) : 'web';
  if (platform === 'ios' || platform === 'android') return platform;
  return 'web';
};

