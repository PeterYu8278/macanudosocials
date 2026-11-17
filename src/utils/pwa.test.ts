import { afterEach, describe, expect, it, vi } from 'vitest';

const workbox = vi.hoisted(() => ({ listeners: new Map<string, unknown>(), register: vi.fn() }));
vi.mock('workbox-window', () => ({ Workbox: class {
  addEventListener(name: string, handler: unknown) { workbox.listeners.set(name, handler); }
  register = workbox.register;
} }));

describe('PWA installation lifecycle', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const setup = async () => {
    vi.resetModules();
    workbox.listeners.clear();
    const handlers = new Map<string, EventListener>();
    vi.spyOn(window, 'addEventListener').mockImplementation((name, handler) => { handlers.set(name, handler as EventListener); });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn() }));
    vi.stubGlobal('navigator', { userAgent: 'test', platform: 'test', serviceWorker: {} });
    workbox.register.mockImplementation(async () => { expect(workbox.listeners.has('waiting')).toBe(true); });
    const pwa = await import('./pwa');
    await pwa.initializePWA();
    return { pwa, handlers };
  };
  it('retains installation until a user action and consumes each prompt only once', async () => {
    const { pwa, handlers } = await setup();
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt, userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    handlers.get('beforeinstallprompt')!(event);
    expect(event.defaultPrevented).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    expect(pwa.getInstallState().canInstall).toBe(true);
    await Promise.all([pwa.showInstallPrompt(), pwa.showInstallPrompt()]);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(pwa.getInstallState().canInstall).toBe(false);
  });
  it('does not retain an unusable prompt after a browser failure', async () => {
    const { pwa, handlers } = await setup();
    const prompt = vi.fn().mockRejectedValue(new Error('browser rejected'));
    handlers.get('beforeinstallprompt')!(Object.assign(new Event('beforeinstallprompt'), {
      prompt, userChoice: Promise.resolve({ outcome: 'dismissed' }),
    }));
    expect(await pwa.showInstallPrompt()).toBe(false);
    expect(await pwa.showInstallPrompt()).toBe(false);
    expect(prompt).toHaveBeenCalledTimes(1);
  });
  it('publishes waiting updates without native confirmation or automatic activation', async () => {
    const { pwa } = await setup();
    const listener = vi.fn();
    const stop = pwa.subscribeToUpdates(listener);
    expect(pwa.getUpdateAvailable()).toBe(false);
    (workbox.listeners.get('waiting') as () => void)();
    expect(pwa.getUpdateAvailable()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    pwa.showUpdateNotification();
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it('checks periodically and waits for activation after the user accepts', async () => {
    vi.useFakeTimers();
    const worker = Object.assign(new EventTarget(), { state: 'installed', postMessage: vi.fn() });
    const registration = { waiting: worker, update: vi.fn().mockResolvedValue(undefined) };
    const { pwa, handlers } = await setup();
    workbox.register.mockResolvedValue(registration);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await pwa.initializePWA();
    expect(pwa.getUpdateAvailable()).toBe(true);
    expect(worker.postMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect(registration.update).toHaveBeenCalledTimes(1);
    handlers.get('focus')!(new Event('focus'));
    expect(registration.update).toHaveBeenCalledTimes(1);
    const result = pwa.applySystemUpdate();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    worker.state = 'activated';
    worker.dispatchEvent(new Event('statechange'));
    expect(await result).toBe(true);
  });
});
