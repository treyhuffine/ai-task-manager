import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { uploadLocalAttachment } from './attachment';

const upload = vi.hoisted(() => vi.fn());
const remote = vi.hoisted(() => ({ connected: false, fetch: vi.fn() }));
vi.mock('@/lib/orchestrator/server-client', () => ({ serverFetch: upload }));
vi.mock('@/lib/config/role', () => ({ getInstallationRole: () => remote.connected ? 'connected' : 'home' }));
vi.mock('@/lib/connection/config', () => ({ readConnection: () => ({ homeUrl: 'https://home.example', credential: 'test-viewer' }) }));
vi.mock('@/lib/connection/home-client', () => ({ homeFetch: remote.fetch }));
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'ri-upload-')); upload.mockReset(); remote.connected = false; remote.fetch.mockReset(); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it('uploads selected bytes as multipart without forwarding a local path', async () => {
  const file = path.join(root, 'capture.png');
  const bytes = Buffer.from([137, 80, 78, 71]);
  await fs.writeFile(file, bytes);
  upload.mockResolvedValue({ fileName: 'durable.png' });
  expect(await uploadLocalAttachment(file)).toEqual({ fileName: 'durable.png' });
  const [route, options] = upload.mock.calls[0];
  expect(route).toBe('/attachments');
  expect(options.method).toBe('POST');
  const submitted = options.body.get('file') as File;
  expect(submitted.name).toBe('capture.png');
  expect(submitted.type).toBe('image/png');
  expect(Buffer.from(await submitted.arrayBuffer())).toEqual(bytes);
  expect([...options.body.keys()]).toEqual(['file']);
});

it('uploads connected-device bytes to its home and never falls back to a local server', async () => {
  const file = path.join(root, 'remote.png');
  await fs.writeFile(file, 'selected bytes');
  remote.connected = true;
  remote.fetch.mockResolvedValue(Response.json({ file_name: 'durable-remote.png' }));
  expect(await uploadLocalAttachment(file)).toEqual({ file_name: 'durable-remote.png' });
  const [, route, options] = remote.fetch.mock.calls[0];
  expect(route).toBe('/api/attachments');
  expect(options.body).toBeInstanceOf(FormData);
  expect([...options.body.keys()]).toEqual(['file']);
  remote.fetch.mockRejectedValue(new Error('Home unavailable'));
  await expect(uploadLocalAttachment(file)).rejects.toThrow('Home unavailable');
  expect(upload).not.toHaveBeenCalled();
});

it('uploads a file of a type Ri has no name for, for the server to store', async () => {
  const file = path.join(root, 'scene.glb');
  await fs.writeFile(file, 'glTF');
  upload.mockResolvedValue({ fileName: 'durable.glb' });
  expect(await uploadLocalAttachment(file)).toEqual({ fileName: 'durable.glb' });
  const submitted = upload.mock.calls[0][1].body.get('file') as File;
  expect(submitted.name).toBe('scene.glb');
  expect(submitted.type).toBe('application/octet-stream');
});

it('rejects empty, oversized and nonregular inputs before upload', async () => {
  const file = path.join(root, 'empty.png');
  await fs.writeFile(file, '');
  await expect(uploadLocalAttachment(file)).rejects.toThrow(/nonempty/);
  const large = path.join(root, 'large.png');
  await fs.writeFile(large, 'x');
  await fs.truncate(large, 50 * 1024 * 1024 + 1);
  await expect(uploadLocalAttachment(large)).rejects.toThrow(/50 MiB/);
  await expect(uploadLocalAttachment(root)).rejects.toThrow(/regular/);
  const link = path.join(root, 'linked.png');
  await fs.symlink(file, link);
  await expect(uploadLocalAttachment(link)).rejects.toThrow(/regular/);
  expect(upload).not.toHaveBeenCalled();
});
