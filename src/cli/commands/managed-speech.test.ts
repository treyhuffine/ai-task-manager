import { EventEmitter } from 'node:events';
import { Command } from 'commander';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ service: vi.fn(), request: vi.fn() }));
vi.mock('@/lib/service/client', () => ({ serviceRequest: mock.service }));
vi.mock('node:https', () => ({ default: { request: mock.request } }));
import { managedSpeechRequest, registerManagedSpeechCommand } from './managed-speech';
let posted: string | undefined;
beforeEach(() => {
  posted = undefined;
  mock.service.mockResolvedValue({ origin: 'https://localhost:4224', certificate: 'private-pinned-certificate', token: 'private-owner-token' });
  mock.request.mockImplementation((_url, _options, callback) => {
    const request = new EventEmitter() as EventEmitter & { setTimeout: ReturnType<typeof vi.fn>; end: (body?: string) => void; destroy: (error: Error) => void };
    request.setTimeout = vi.fn(); request.destroy = error => request.emit('error', error);
    request.end = body => {
      posted = body;
      const response = new EventEmitter() as EventEmitter & { statusCode: number }; response.statusCode = 200;
      callback(response); response.emit('data', Buffer.from(JSON.stringify({ phase: 'installed' }))); response.emit('end');
    };
    return request;
  });
});
afterEach(() => { vi.restoreAllMocks(); });
it('pins service-provided TLS without disabling certificate validation', async () => {
  await expect(managedSpeechRequest()).resolves.toEqual({ phase: 'installed' });
  const [url, options] = mock.request.mock.calls[0];
  expect(url.href).toBe('https://localhost:4224/api/service/speech');
  expect(options).toMatchObject({ ca: 'private-pinned-certificate', allowPartialTrustChain: true, agent: false, headers: { Authorization: 'Bearer private-owner-token' } });
  expect(options.rejectUnauthorized).not.toBe(false);
});
it('refuses remote, plaintext, or credential-bearing origins', async () => {
  for (const origin of ['http://localhost:4224', 'https://remote.example', 'https://user:pass@localhost']) {
    mock.service.mockResolvedValue({ origin });
    await expect(managedSpeechRequest()).rejects.toThrow('invalid speech management origin');
  }
});
it('routes managed CLI commands through the backend rather than a second helper owner', async () => {
  const voice = new Command('voice'); registerManagedSpeechCommand(voice);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await voice.parseAsync(['node', 'voice', 'managed', 'install']);
  expect(JSON.parse(posted!)).toEqual({ action: 'install' });
  expect(log).toHaveBeenCalledWith(expect.stringContaining('installed'));
});
it('exposes explicit cloud opt-in and an independent local-only action', async () => {
  const voice = new Command('voice'); registerManagedSpeechCommand(voice);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await voice.parseAsync(['node', 'voice', 'managed', 'allow-cloud']);
  expect(JSON.parse(posted!)).toEqual({ action: 'configure', cloudFallback: true });
  await voice.parseAsync(['node', 'voice', 'managed', 'local-only']);
  expect(JSON.parse(posted!)).toEqual({ action: 'configure', cloudFallback: false });
});
