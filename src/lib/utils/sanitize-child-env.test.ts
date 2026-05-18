import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sanitizeChildEnv } from './sanitize-child-env';

describe('sanitizeChildEnv', () => {
  const snapshot: Record<string, string | undefined> = {};
  // Save the env we touch so other tests aren't polluted.
  const KEYS_TOUCHED = [
    'PORT', 'HOST', 'PATH', 'HOME', 'USER',
    'TURBOPACK', 'NEXT_RUNTIME', 'NEXT_PRIVATE_WORKER',
    'NEXT_PRIVATE_TRACE_ID', 'NEXT_DEPLOYMENT_ID',
    '__NEXT_PRIVATE_ORIGIN', '__NEXT_PROCESSED_ENV', '__NEXT_OTHER_FUTURE',
    'PORTLESS_URL', 'PORTLESS_TAILSCALE_URL', 'PORTLESS_APP_PORT',
    'NODE_EXTRA_CA_CERTS',
    'FLOW_ROOT', 'FLOW_BRAIN_PATH', 'FLOW_OTHER',
    'NEXT_PUBLIC_KEEP_ME', 'NEXT_PRIVATE_REMOVE_ME', 'CUSTOM_USER_VAR',
  ];

  beforeEach(() => {
    for (const k of KEYS_TOUCHED) {
      snapshot[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS_TOUCHED) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  });

  it('strips PORT and HOST', () => {
    process.env.PORT = '4224';
    process.env.HOST = '0.0.0.0';
    const env = sanitizeChildEnv();
    expect(env.PORT).toBeUndefined();
    expect(env.HOST).toBeUndefined();
  });

  it('strips Next.js worker-private vars', () => {
    process.env.TURBOPACK = '1';
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.NEXT_PRIVATE_WORKER = '1';
    process.env.NEXT_PRIVATE_TRACE_ID = 'abc';
    process.env.NEXT_DEPLOYMENT_ID = 'xyz';
    process.env.__NEXT_PRIVATE_ORIGIN = 'http://localhost:4224';
    process.env.__NEXT_PROCESSED_ENV = 'true';
    const env = sanitizeChildEnv();
    expect(env.TURBOPACK).toBeUndefined();
    expect(env.NEXT_RUNTIME).toBeUndefined();
    expect(env.NEXT_PRIVATE_WORKER).toBeUndefined();
    expect(env.NEXT_PRIVATE_TRACE_ID).toBeUndefined();
    expect(env.NEXT_DEPLOYMENT_ID).toBeUndefined();
    expect(env.__NEXT_PRIVATE_ORIGIN).toBeUndefined();
    expect(env.__NEXT_PROCESSED_ENV).toBeUndefined();
  });

  it('strips any __NEXT_* future variable by prefix', () => {
    process.env.__NEXT_OTHER_FUTURE = 'should-vanish';
    const env = sanitizeChildEnv();
    expect(env.__NEXT_OTHER_FUTURE).toBeUndefined();
  });

  it('strips any NEXT_PRIVATE_* future variable by prefix', () => {
    process.env.NEXT_PRIVATE_REMOVE_ME = 'should-vanish';
    const env = sanitizeChildEnv();
    expect(env.NEXT_PRIVATE_REMOVE_ME).toBeUndefined();
  });

  it('preserves user-facing NEXT_PUBLIC_* vars', () => {
    process.env.NEXT_PUBLIC_KEEP_ME = 'safe';
    const env = sanitizeChildEnv();
    expect(env.NEXT_PUBLIC_KEEP_ME).toBe('safe');
  });

  it('strips Portless inheritance vars', () => {
    process.env.PORTLESS_URL = 'https://x.localhost';
    process.env.PORTLESS_TAILSCALE_URL = 'https://x.ts.net';
    process.env.PORTLESS_APP_PORT = '4070';
    process.env.NODE_EXTRA_CA_CERTS = '/x/ca.pem';
    const env = sanitizeChildEnv();
    expect(env.PORTLESS_URL).toBeUndefined();
    expect(env.PORTLESS_TAILSCALE_URL).toBeUndefined();
    expect(env.PORTLESS_APP_PORT).toBeUndefined();
    expect(env.NODE_EXTRA_CA_CERTS).toBeUndefined();
  });

  it('strips all FLOW_* vars by prefix', () => {
    process.env.FLOW_ROOT = '/x';
    process.env.FLOW_BRAIN_PATH = '/y';
    process.env.FLOW_OTHER = 'anything';
    const env = sanitizeChildEnv();
    expect(env.FLOW_ROOT).toBeUndefined();
    expect(env.FLOW_BRAIN_PATH).toBeUndefined();
    expect(env.FLOW_OTHER).toBeUndefined();
  });

  it('preserves PATH, HOME, and unrelated user vars', () => {
    process.env.PATH = '/usr/bin:/bin';
    process.env.HOME = '/Users/test';
    process.env.CUSTOM_USER_VAR = 'preserved';
    const env = sanitizeChildEnv();
    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.HOME).toBe('/Users/test');
    expect(env.CUSTOM_USER_VAR).toBe('preserved');
  });

  it('extras override the inherited base', () => {
    process.env.PATH = '/usr/bin';
    const env = sanitizeChildEnv({ PATH: '/opt/special/bin', NEW_VAR: 'x' });
    expect(env.PATH).toBe('/opt/special/bin');
    expect(env.NEW_VAR).toBe('x');
  });

  it('extras can re-set a stripped variable (e.g. set PORT explicitly)', () => {
    process.env.PORT = '4224';
    const env = sanitizeChildEnv({ PORT: '5173' });
    expect(env.PORT).toBe('5173');
  });

  it('does not mutate process.env', () => {
    process.env.PORT = '4224';
    process.env.PATH = '/usr/bin';
    sanitizeChildEnv();
    expect(process.env.PORT).toBe('4224');
    expect(process.env.PATH).toBe('/usr/bin');
  });
});
