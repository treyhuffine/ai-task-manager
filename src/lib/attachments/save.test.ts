import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_SHORT_ID } from '@/constants/app';

describe('saveAttachment', () => {
  let tmpDir: string;
  const envKey = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-attachments-save-'));
    originalEnv = process.env[envKey];
    process.env[envKey] = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[envKey];
    else process.env[envKey] = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes the file under <brain>/attachments and returns full metadata', async () => {
    const { saveAttachment } = await import('./save');
    const bytes = Buffer.from('hello, world');
    const result = await saveAttachment({
      data: bytes,
      originalName: 'Notes about the migration.txt',
      mimeType: 'text/plain',
    });

    expect(result.fileName).toMatch(/^[a-f0-9-]+\.txt$/);
    expect(result.originalName).toBe('Notes about the migration.txt');
    expect(result.mimeType).toBe('text/plain');
    expect(result.size).toBe(bytes.byteLength);
    expect(result.uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const written = fs.readFileSync(path.join(tmpDir, 'brain', 'attachments', result.fileName));
    expect(written.toString()).toBe('hello, world');
  });

  it('derives extension from mime when the filename has no extension', async () => {
    const { saveAttachment } = await import('./save');
    const result = await saveAttachment({
      data: Buffer.from([1, 2, 3]),
      originalName: 'no-extension',
      mimeType: 'image/png',
    });
    expect(result.fileName).toMatch(/\.png$/);
  });

  it('recovers mime from filename when header is octet-stream', async () => {
    const { saveAttachment } = await import('./save');
    const result = await saveAttachment({
      data: Buffer.from([1, 2]),
      originalName: 'photo.jpg',
      mimeType: 'application/octet-stream',
    });
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.fileName).toMatch(/\.jpg$/);
  });

  it('uses UUIDv7 so lexicographic sort == chronological order', async () => {
    const { saveAttachment } = await import('./save');
    const a = await saveAttachment({
      data: Buffer.from('a'),
      originalName: 'a.png',
      mimeType: 'image/png',
    });
    // Small delay to guarantee timestamp advance between uuidv7 calls.
    await new Promise((r) => setTimeout(r, 2));
    const b = await saveAttachment({
      data: Buffer.from('b'),
      originalName: 'b.png',
      mimeType: 'image/png',
    });
    expect(a.fileName < b.fileName).toBe(true);
  });
});
