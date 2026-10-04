import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

it.each([null, 'websocket', 'invalid'])('defaults browser requests to WebSocket without an HTTP choice (%s)', async saved => {
  vi.stubGlobal('window', { localStorage: { getItem: () => saved } });
  const { getTransportMode } = await import('./transport-state');
  expect(getTransportMode()).toBe('websocket');
});

it('preserves a saved HTTP rollback choice', async () => {
  vi.stubGlobal('window', { localStorage: { getItem: () => 'http' } });
  const { getTransportMode } = await import('./transport-state');
  expect(getTransportMode()).toBe('http');
});

it('defaults to WebSocket with unavailable storage and still permits session-only rollback', async () => {
  vi.stubGlobal('window', { get localStorage() { throw new Error('Storage unavailable'); } });
  const { getTransportMode, setTransportMode } = await import('./transport-state');
  expect(getTransportMode()).toBe('websocket');
  setTransportMode('http');
  expect(getTransportMode()).toBe('http');
  setTransportMode('websocket');
  expect(getTransportMode()).toBe('websocket');
});

it('keeps non-browser requests on HTTP', async () => {
  vi.stubGlobal('window', undefined);
  const { getTransportMode } = await import('./transport-state');
  expect(getTransportMode()).toBe('http');
});
