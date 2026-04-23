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
      original_name: 'Notes about the migration.txt',
      mime_type: 'text/plain',
    });

    expect(result.file_name).toMatch(/^[a-f0-9-]+\.txt$/);
    expect(result.original_name).toBe('Notes about the migration.txt');
    expect(result.mime_type).toBe('text/plain');
    expect(result.size).toBe(bytes.byteLength);
    expect(result.uploaded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const written = fs.readFileSync(path.join(tmpDir, 'brain', 'attachments', result.file_name));
    expect(written.toString()).toBe('hello, world');
  });

  it('derives extension from mime when the filename has no extension', async () => {
    const { saveAttachment } = await import('./save');
    const result = await saveAttachment({
      data: Buffer.from([1, 2, 3]),
      original_name: 'no-extension',
      mime_type: 'image/png',
    });
    expect(result.file_name).toMatch(/\.png$/);
  });

  it('recovers mime from filename when header is octet-stream', async () => {
    const { saveAttachment } = await import('./save');
    const result = await saveAttachment({
      data: Buffer.from([1, 2]),
      original_name: 'photo.jpg',
      mime_type: 'application/octet-stream',
    });
    expect(result.mime_type).toBe('image/jpeg');
    expect(result.file_name).toMatch(/\.jpg$/);
  });

  it('uses UUIDv7 so lexicographic sort == chronological order', async () => {
    const { saveAttachment } = await import('./save');
    const a = await saveAttachment({
      data: Buffer.from('a'),
      original_name: 'a.png',
      mime_type: 'image/png',
    });
    // Small delay to guarantee timestamp advance between uuidv7 calls.
    await new Promise((r) => setTimeout(r, 2));
    const b = await saveAttachment({
      data: Buffer.from('b'),
      original_name: 'b.png',
      mime_type: 'image/png',
    });
    expect(a.file_name < b.file_name).toBe(true);
  });
});
