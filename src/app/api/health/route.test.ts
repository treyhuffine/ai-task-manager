import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET, OPTIONS } from './route';

beforeEach(() => {
  vi.stubEnv('RI_TRPC_WS_HOST', '1');
  vi.stubEnv('RI_TRPC_WS_DISABLED', '0');
  vi.stubGlobal('__riTRPCWebSocket', undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('refuses a healthy launch when instrumentation did not install WebSockets', async () => {
  const response = GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual(expect.objectContaining({ ok: false, error: 'websocket_unavailable' }));
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});

it('confirms the initialized shared terminal host', async () => {
  vi.stubGlobal('__riTRPCWebSocket', { upgrade: vi.fn(), close: vi.fn() });
  const response = GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, app: expect.any(String), port: expect.any(Number) });
});

it.each(['native Next', 'explicit WebSocket disable'])('keeps %s HTTP-only launches available', async mode => {
  vi.stubEnv(mode === 'native Next' ? 'RI_TRPC_WS_HOST' : 'RI_TRPC_WS_DISABLED', mode === 'native Next' ? '0' : '1');
  const response = GET();
  expect(response.status).toBe(200);
  expect((await response.json()).ok).toBe(true);
});

it('keeps the public reachability preflight available', () => {
  const response = OPTIONS();
  expect(response.status).toBe(204);
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
});
