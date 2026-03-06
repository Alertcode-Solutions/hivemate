import { useCallback, useEffect, useRef, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

declare global {
  interface Window {
    __hiveMateBeforeInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

const isStandaloneMode = () =>
  typeof window !== 'undefined' && (
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as any).standalone === true
  );

export const usePwaInstallPrompt = () => {
  const [isInstalled, setIsInstalled] = useState<boolean>(isStandaloneMode());
  const [isStandalone, setIsStandalone] = useState<boolean>(isStandaloneMode());
  const [canInstall, setCanInstall] = useState(Boolean(typeof window !== 'undefined' && window.__hiveMateBeforeInstallPrompt));
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(
    typeof window !== 'undefined' ? (window.__hiveMateBeforeInstallPrompt ?? null) : null
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const updateInstalledState = () => {
      const installed = isStandaloneMode();
      setIsStandalone(installed);
      setIsInstalled(installed);
      if (installed) {
        deferredPromptRef.current = null;
        window.__hiveMateBeforeInstallPrompt = null;
        setCanInstall(false);
        return;
      }
      const prompt = window.__hiveMateBeforeInstallPrompt ?? null;
      deferredPromptRef.current = prompt;
      setCanInstall(Boolean(prompt));
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (isStandaloneMode()) {
        deferredPromptRef.current = null;
        window.__hiveMateBeforeInstallPrompt = null;
        setCanInstall(false);
        return;
      }
      const promptEvent = event as BeforeInstallPromptEvent;
      deferredPromptRef.current = promptEvent;
      window.__hiveMateBeforeInstallPrompt = promptEvent;
      setCanInstall(true);
    };

    const handleAppInstalled = () => {
      deferredPromptRef.current = null;
      window.__hiveMateBeforeInstallPrompt = null;
      setCanInstall(false);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    mediaQuery.addEventListener('change', updateInstalledState);
    updateInstalledState();

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      mediaQuery.removeEventListener('change', updateInstalledState);
    };
  }, []);

  const triggerInstall = useCallback(async (): Promise<boolean> => {
    if (isInstalled) return false;
    const promptEvent = deferredPromptRef.current ?? window.__hiveMateBeforeInstallPrompt;
    if (!promptEvent) return false;

    deferredPromptRef.current = promptEvent;
    await promptEvent.prompt();
    const choiceResult = await promptEvent.userChoice;
    if (choiceResult.outcome === 'accepted') {
      deferredPromptRef.current = null;
      window.__hiveMateBeforeInstallPrompt = null;
      setCanInstall(false);
      setIsInstalled(true);
      return true;
    }
    const refreshedPrompt = window.__hiveMateBeforeInstallPrompt ?? deferredPromptRef.current;
    setCanInstall(Boolean(refreshedPrompt));
    return false;
  }, [isInstalled]);

  return {
    canInstall: canInstall && !isInstalled,
    isInstalled,
    isStandalone,
    triggerInstall
  };
};

export default usePwaInstallPrompt;
