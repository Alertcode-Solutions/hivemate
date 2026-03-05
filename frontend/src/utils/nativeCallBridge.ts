import { isNativeApp } from './platform';

export type NativeIncomingCall = {
  callId: string;
  type: 'voice' | 'video';
  callerId?: string;
  callerName?: string;
};

const callBridge = () => {
  if (typeof window === 'undefined') return null;
  return (window as any)?.Capacitor?.Plugins?.HiveMateCallBridge || null;
};

export const notifyNativeIncomingCall = async (payload: NativeIncomingCall): Promise<boolean> => {
  if (!isNativeApp()) return false;
  const bridge = callBridge();
  if (!bridge || typeof bridge.showIncomingCall !== 'function') return false;

  try {
    await bridge.showIncomingCall(payload);
    return true;
  } catch {
    return false;
  }
};

export const notifyNativeCallDismissed = async (callId: string): Promise<void> => {
  if (!isNativeApp()) return;
  const bridge = callBridge();
  if (!bridge || typeof bridge.dismissIncomingCall !== 'function') return;
  try {
    await bridge.dismissIncomingCall({ callId });
  } catch {
    // no-op
  }
};

