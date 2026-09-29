import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { downloadModelFile, verifyModelFile } from './download';
let directory: string;
const bytes = Buffer.from('verified model contents');
const spec = { name: 'model.onnx', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-speech-download-')); });
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });
function download(fetcher: typeof fetch, signal = new AbortController().signal) { return downloadModelFile({ directory, spec, url: 'https://models.example/pinned/model.onnx', signal, progress: () => {}, fetcher }); }
it('only activates a size and hash verified model', async () => {
  await download(vi.fn().mockResolvedValue(new Response(bytes)));
  expect(await verifyModelFile(path.join(directory, spec.name), spec)).toBe(true);
  expect(fs.existsSync(path.join(directory, `${spec.name}.partial`))).toBe(false);
});
it('resumes a partial model with an exact bounded content range', async () => {
  fs.writeFileSync(path.join(directory, `${spec.name}.partial`), bytes.subarray(0, 4));
  const fetcher = vi.fn().mockResolvedValue(new Response(bytes.subarray(4), { status: 206, headers: { 'Content-Range': `bytes 4-${bytes.length - 1}/${bytes.length}` } }));
  await download(fetcher);
  expect(fetcher.mock.calls[0][1].headers).toEqual({ Range: 'bytes=4-' });
  expect(fs.readFileSync(path.join(directory, spec.name))).toEqual(bytes);
});
it('restarts safely when a server ignores Range', async () => {
  fs.writeFileSync(path.join(directory, `${spec.name}.partial`), bytes.subarray(0, 4));
  await download(vi.fn().mockResolvedValue(new Response(bytes)));
  expect(fs.readFileSync(path.join(directory, spec.name))).toEqual(bytes);
});
it('rejects altered content and removes the poisoned partial file', async () => {
  await expect(download(vi.fn().mockResolvedValue(new Response('x'.repeat(bytes.length))))).rejects.toThrow('checksum');
  expect(fs.existsSync(path.join(directory, spec.name))).toBe(false);
  expect(fs.existsSync(path.join(directory, `${spec.name}.partial`))).toBe(false);
});
it('rejects an oversized body before activation', async () => {
  await expect(download(vi.fn().mockResolvedValue(new Response(Buffer.concat([bytes, bytes]))))).rejects.toThrow('pinned size');
  expect(fs.existsSync(path.join(directory, spec.name))).toBe(false);
});
it('rejects redirects to plaintext and credentials', async () => {
  for (const location of ['http://models.example/file', 'https://user:secret@models.example/file']) {
    await expect(download(vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location } })))).rejects.toThrow('HTTPS');
  }
});
it('does not accept a server range for different model bytes', async () => {
  await expect(download(vi.fn().mockResolvedValue(new Response(bytes, { status: 206, headers: { 'Content-Range': 'bytes 0-5/6' } })))).rejects.toThrow('range');
});
it('refuses symlink partial files', async () => {
  const outside = path.join(directory, 'unrelated'); fs.writeFileSync(outside, 'keep');
  fs.symlinkSync(outside, path.join(directory, `${spec.name}.partial`));
  await expect(download(vi.fn())).rejects.toThrow('Invalid partial');
  expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
});
it('reuses a complete verified file without network access', async () => {
  fs.writeFileSync(path.join(directory, spec.name), bytes);
  const fetcher = vi.fn(); await download(fetcher); expect(fetcher).not.toHaveBeenCalled();
});
it('accepts cancellation without activating incomplete downloads', async () => {
  const controller = new AbortController();
  const fetcher = vi.fn().mockImplementation(async () => { controller.abort(); return new Response(bytes); });
  await expect(download(fetcher, controller.signal)).rejects.toThrow();
  expect(fs.existsSync(path.join(directory, spec.name))).toBe(false);
});
