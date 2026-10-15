import { afterEach, describe, expect, it, vi } from 'vitest';

const workbox = vi.hoisted(() => ({ listeners: new Map<string, unknown>(), register: vi.fn() }));
vi.mock('workbox-window', () => ({ Workbox: class {
  addEventListener(name: string, handler: unknown) { workbox.listeners.set(name, handler); }
  register = workbox.register;
} }));

describe('PWA installation lifecycle', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
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
});
