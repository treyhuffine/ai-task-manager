import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { DesktopSessionError, signInDesktopSession } from './session-auth';

const token = 'private-device-credential';
const origin = 'https://home.example';
afterEach(() => vi.restoreAllMocks());

it('establishes the session using a bounded request without following credential-bearing redirects', async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }), { status: 200 });
  const fetch = vi.fn(async () => response);
  await signInDesktopSession({ origin, token, local: false, fetch });
  expect(fetch).toHaveBeenCalledWith(`${origin}/api/session`, {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: expect.any(AbortSignal),
  });
  expect(cancel).toHaveBeenCalledOnce();
});

it.each([
  [401, false, 'credential', /Connect this device again/],
  [401, true, 'credential', /Restart the local service, then retry/],
  [403, false, 'forbidden', /access settings/],
  [403, true, 'forbidden', /local service log/],
  [500, false, 'server', /Home service log/],
  [503, true, 'server', /local service log/],
  [429, false, 'response', /Wait before retrying/],
  [404, true, 'response', /unexpected sign-in response/],
])('classifies HTTP %s for local=%s without exposing server text', async (status, local, code, message) => {
  const response = new Response(`Bearer ${token}\nunsafe upstream diagnostic`, { status });
  const failure = await signInDesktopSession({ origin, token, local, fetch: async () => response }).catch(error => error);
  expect(failure).toBeInstanceOf(DesktopSessionError);
  expect(failure).toMatchObject({ code, status });
  expect(failure.message).toMatch(message);
  expect(failure.message).toContain(`HTTP ${status}`);
  expect(failure.message).not.toContain(token);
  expect(failure.message).not.toContain('unsafe upstream');
  if (status !== 401) expect(failure.message).not.toMatch(/Connect this device again|credential/);
});

it('does not wait for an unbounded body or a stalled cancellation', async () => {
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const response = new Response(new ReadableStream({ cancel }), { status: 500 });
  await expect(signInDesktopSession({ origin, token, local: true, fetch: async () => response }))
    .rejects.toMatchObject({ code: 'server', status: 500 });
  expect(cancel).toHaveBeenCalledOnce();
});

it('preserves the HTTP status when cancelling an error body fails', async () => {
  const response = new Response(new ReadableStream({ cancel() { return Promise.reject(new Error(token)); } }), { status: 403 });
  await expect(signInDesktopSession({ origin, token, local: false, fetch: async () => response }))
    .rejects.toMatchObject({ code: 'forbidden', status: 403 });
});

it('distinguishes request timeout from failed credentials or server errors', async () => {
  const controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const result = signInDesktopSession({ origin, token, local: false, fetch: async (_url, init) => {
    controller.abort(new DOMException(token, 'TimeoutError'));
    throw init.signal!.reason;
  } });
  await expect(result).rejects.toMatchObject({ code: 'timeout', status: undefined, message: expect.stringContaining('15 seconds') });
  expect(AbortSignal.timeout).toHaveBeenCalledWith(15_000);
});

it.each([true, false])('sanitizes network and TLS failures for local=%s', async local => {
  const failure = await signInDesktopSession({ origin, token, local, fetch: async () => { throw new TypeError(`Failed ${origin}?token=${token}`); } }).catch(error => error);
  expect(failure).toMatchObject({ code: 'network', status: undefined });
  expect(failure.message).toContain(local ? 'local Ri service' : 'HTTPS certificate');
  expect(failure.message).not.toContain(token);
  expect(failure.message).not.toContain('Connect this device again');
});

it('does not send a real redirected sign-in request to another endpoint', async () => {
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url!);
    response.writeHead(302, { location: '/unexpected' });
    response.end(token);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    await expect(signInDesktopSession({ origin: `http://127.0.0.1:${address.port}`, token, local: true, fetch }))
      .rejects.toMatchObject({ code: 'network' });
    expect(requests).toEqual(['/api/session']);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
