import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { ensureGeneratedTls } from '@/lib/config/tls';
const mock = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('@/lib/service/client', () => ({ serviceRequest: mock.session }));
import { managedSpeechRequest } from './managed-speech';
let root: string;
let server: https.Server;
let session: { origin: string; certificate: string; token: string };
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-speech-tls-'));
  vi.stubEnv('RI_ROOT', root);
  const tls = await ensureGeneratedTls();
  server = https.createServer({ key: tls.key, cert: tls.cert }, (request, response) => {
    if (request.headers.authorization !== 'Bearer test-owner') { response.writeHead(403); response.end('{}'); return; }
    response.end(JSON.stringify({ phase: 'installed' }));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  session = { origin: `https://127.0.0.1:${(server.address() as AddressInfo).port}`, certificate: tls.cert, token: 'test-owner' };
  mock.session.mockResolvedValue(session);
});
afterAll(async () => { if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
it('accepts only the certificate pinned by the local service session', async () => {
  await expect(managedSpeechRequest()).resolves.toMatchObject({ phase: 'installed' });
  vi.stubEnv('RI_ROOT', path.join(root, 'other'));
  const other = await ensureGeneratedTls();
  mock.session.mockResolvedValue({ ...session, certificate: other.cert });
  await expect(managedSpeechRequest()).rejects.toThrow();
});
