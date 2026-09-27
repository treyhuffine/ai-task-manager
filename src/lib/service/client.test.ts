import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { servicePaths } from './paths';
import { serviceRequest, serviceStatus } from './client';

let directory: string;
let server: http.Server | undefined;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-control-client-'));
  vi.stubEnv('RI_ROOT', directory);
  for (const key of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR']) vi.stubEnv(key, '');
});
afterEach(async () => {
  if (server?.listening) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  server = undefined; vi.unstubAllEnvs(); fs.rmSync(directory, { recursive: true, force: true });
});
async function listen(handler: http.RequestListener) {
  server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(servicePaths().socket, resolve); });
}
it('retries a controller socket reset once using a fresh verified connection', async () => {
  let attempts = 0;
  await listen((request, response) => {
    if (++attempts === 1) { request.socket.destroy(); return; }
    response.end(JSON.stringify({ protocol: 1, identity: servicePaths().identity, phase: 'running' }));
  });
  expect((await serviceStatus())?.phase).toBe('running');
  expect(attempts).toBe(2);
});
it('never pools a control connection across service replacement', async () => {
  const sockets = new Set();
  await listen((request, response) => { sockets.add(request.socket); response.end(JSON.stringify({ protocol: 1, identity: servicePaths().identity, phase: 'running' })); });
  await serviceRequest('/status'); await serviceRequest('/status');
  expect(sockets.size).toBe(2);
});
it('does not mask an identity mismatch as a stopped or replaceable service', async () => {
  let requests = 0;
  await listen((_request, response) => { requests++; response.end(JSON.stringify({ protocol: 1, identity: { ...servicePaths().identity, root: '/other' } })); });
  await expect(serviceStatus()).rejects.toThrow('identity'); expect(requests).toBe(1);
});
it('reports an absent endpoint as stopped', async () => { expect(await serviceStatus()).toBeNull(); });
