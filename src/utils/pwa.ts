// PWA utility functions
import { Workbox } from 'workbox-window';
import { useState, useEffect } from 'react';

// PWA installation prompt
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// PWA installation state
export interface PWAInstallState {
  isInstallable: boolean;
  isInstalled: boolean;
  isStandalone: boolean;
  canInstall: boolean;
  isIOS: boolean;
  isChecking: boolean;
}

// Global variables for PWA state
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installState: PWAInstallState = {
  isInstallable: false,
  isInstalled: false,
  isStandalone: false,
  canInstall: false,
  isIOS: false,
  isChecking: true
};

type InstallStateListener = (state: PWAInstallState) => void;
type NavigatorWithRelatedApps = Navigator & {
  getInstalledRelatedApps?: () => Promise<Array<{ platform: string; id?: string; url?: string }>>;
};

const installStateListeners = new Set<InstallStateListener>();
let installListenersInitialized = false;

const isIOSBrowser = (): boolean => {
  const isIOSUserAgent = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isIOSUserAgent || isIPadOS;
};

const updateInstallState = (updates: Partial<PWAInstallState>) => {
  installState = { ...installState, ...updates };
  installStateListeners.forEach(listener => listener({ ...installState }));
};

// Check if app is running in standalone mode
export const isStandalone = (): boolean => {
  return window.matchMedia('(display-mode: standalone)').matches ||
         (window.navigator as any).standalone === true;
};

// Check if app is installed
export const isInstalled = (): boolean => {
  return isStandalone() || 
         window.matchMedia('(display-mode: minimal-ui)').matches;
};

const refreshInstallState = async (): Promise<void> => {
  const standalone = isStandalone();
  let relatedAppInstalled = false;
  const relatedAppsNavigator = navigator as NavigatorWithRelatedApps;

  if (!standalone && relatedAppsNavigator.getInstalledRelatedApps) {
    try {
      const relatedApps = await relatedAppsNavigator.getInstalledRelatedApps();
      relatedAppInstalled = relatedApps.some(app => app.platform === 'webapp');
    } catch {
      relatedAppInstalled = false;
    }
  }

  const installed = standalone || isInstalled() || relatedAppInstalled;
  updateInstallState({
    isStandalone: standalone,
    isInstalled: installed,
    isIOS: isIOSBrowser(),
    isChecking: false,
    canInstall: !installed && deferredPrompt !== null,
    isInstallable: !installed && deferredPrompt !== null,
  });
};

const initializeInstallDetection = () => {
  if (installListenersInitialized) return;
  installListenersInitialized = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    if (isStandalone() || isInstalled()) return;

    // A custom Home banner owns the prompt, so retain the event for its button.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    updateInstallState({
      isInstallable: true,
      canInstall: true,
      isInstalled: false,
      isStandalone: false,
      isIOS: isIOSBrowser(),
      isChecking: false,
    });
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    updateInstallState({
      isInstalled: true,
      isStandalone: isStandalone(),
      isInstallable: false,
      canInstall: false,
      isChecking: false,
    });
  });

  window.matchMedia('(display-mode: standalone)').addEventListener('change', () => {
    void refreshInstallState();
  });
};

// Initialize PWA
export const initializePWA = async (): Promise<void> => {
  try {
    initializeInstallDetection();
    await refreshInstallState();

    // Check if service worker is supported
    if ('serviceWorker' in navigator) {
      // Initialize Workbox
      // The versioned URL bypasses the previously deployed self-destroying
      // worker, which may still be held in a long-lived mobile browser cache.
      const wb = new Workbox('/sw.js?push-worker=2');
      
      // Register service worker
      await wb.register();
      
      // Listen for updates
      wb.addEventListener('controlling', () => {
      });
      
      // Listen for waiting
      wb.addEventListener('waiting', () => {
        // Show update notification to user
        showUpdateNotification();
      });
      
      // Listen for activated
      wb.addEventListener('activated', () => {
      });
    }
    
  } catch (error) {
    // 静默处理错误
    updateInstallState({ isChecking: false });
  }
};

// Show install prompt
export const showInstallPrompt = async (): Promise<boolean> => {
  if (!deferredPrompt) {
    return false;
  }
  
  try {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      deferredPrompt = null;
      updateInstallState({
        isInstalled: true,
        isInstallable: false,
        canInstall: false,
        isChecking: false,
      });
      return true;
    }

    deferredPrompt = null;
    updateInstallState({ isInstallable: false, canInstall: false });
    return false;
  } catch (error) {
    return false;
  }
};

// Get install state
export const getInstallState = (): PWAInstallState => {
  return { ...installState };
};

// Show update notification
export const showUpdateNotification = (): void => {
  // This would typically show a toast notification or modal
  // You can integrate this with your UI notification system
  if (confirm('新版本可用！是否立即更新？')) {
    window.location.reload();
  }
};

// Check for updates
export const checkForUpdates = async (): Promise<void> => {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.update();
      }
    } catch (error) {
      // 静默处理错误
    }
  }
};

// Unregister service worker (for development)
export const unregisterServiceWorker = async (): Promise<void> => {
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        if (new URL(registration.scope).pathname === '/push/onesignal/') {
          continue;
        }
        await registration.unregister();
      }
  } catch (error) {
    // 静默处理错误
  }
  }
};

// Get device info for PWA
export const getDeviceInfo = () => {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
    isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent),
    isAndroid: /Android/.test(navigator.userAgent),
    isStandalone: isStandalone(),
    isInstalled: isInstalled()
  };
};

// PWA installation hook for React

export const usePWA = () => {
  const [installState, setInstallState] = useState(getInstallState());
  
  useEffect(() => {
    initializeInstallDetection();
    const updateState: InstallStateListener = state => setInstallState(state);
    installStateListeners.add(updateState);
    void refreshInstallState();

    return () => {
      installStateListeners.delete(updateState);
    };
  }, []);
  
  return {
    ...installState,
    showInstallPrompt,
    checkForUpdates,
    getDeviceInfo
  };
};
