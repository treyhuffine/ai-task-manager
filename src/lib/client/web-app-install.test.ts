import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function browser({ native = false, secure = true, standalone = false } = {}) {
  const target = new EventTarget();
  const register = vi.fn().mockResolvedValue({});
  Object.assign(target, {
    isSecureContext: secure,
    riDesktop: native ? { platform: 'darwin' } : undefined,
    matchMedia: () => ({ matches: standalone, addEventListener: vi.fn() }),
  });
  vi.stubGlobal('window', target);
  vi.stubGlobal('navigator', {
    userAgent: 'Chrome', maxTouchPoints: 0,
    serviceWorker: { register },
  });
  return { target, register };
}

beforeEach(() => { vi.resetModules(); vi.stubEnv('NODE_ENV', 'production'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('web app installation', () => {
  it('uses the existing push worker once without asking for permissions', async () => {
    const { register } = browser();
    const { startWebAppInstall } = await import('./web-app-install');
    startWebAppInstall();
    startWebAppInstall();
    expect(register).toHaveBeenCalledExactlyOnceWith('/notifications-sw.js', { updateViaCache: 'none' });
  });

  it.each([{ native: true }, { secure: false }])('does not register a web worker in an unsuitable context: %j', async (options) => {
    const { register } = browser(options);
    const { startWebAppInstall } = await import('./web-app-install');
    startWebAppInstall();
    expect(register).not.toHaveBeenCalled();
  });

  it('does not add persistent web workers during development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { register } = browser();
    const { startWebAppInstall } = await import('./web-app-install');
    startWebAppInstall();
    expect(register).not.toHaveBeenCalled();
  });

  it('retains an early install event for an explicit click and consumes it once', async () => {
    const { target } = browser();
    const { startWebAppInstall, promptWebAppInstall } = await import('./web-app-install');
    startWebAppInstall();
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt, userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    expect(await promptWebAppInstall()).toBe('accepted');
    expect(await promptWebAppInstall()).toBe('unavailable');
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('discards the prompt after installation', async () => {
    const { target } = browser();
    const { startWebAppInstall, promptWebAppInstall } = await import('./web-app-install');
    startWebAppInstall();
    target.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), { prompt: vi.fn() }));
    target.dispatchEvent(new Event('appinstalled'));
    expect(await promptWebAppInstall()).toBe('unavailable');
  });
});
