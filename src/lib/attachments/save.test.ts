import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { APP_SHORT_ID } from '@/constants/app';
import { HEIC_PHOTO } from '@/test/fixtures/heic';

describe('saveAttachment', () => {
  let tmpDir: string;
  const envKey = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-attachments-save-'));
    originalEnv = process.env[envKey];
    process.env[envKey] = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[envKey];
    else process.env[envKey] = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes the file under attachments/ and returns full metadata', async () => {
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

    const written = fs.readFileSync(path.join(tmpDir, 'attachments', result.fileName));
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
  it('reserves one UUID across concurrent retries, changed payloads and a crash before bytes are written', async () => {
    const { saveAttachment } = await import('./save');
    const input = { data: Buffer.from('chosen bytes'), originalName: 'chosen.txt', idempotencyKey: `publication:${tmpDir}` };
    const first = await saveAttachment(input);
    fs.unlinkSync(path.join(tmpDir, 'attachments', first.fileName));
    const retries = await Promise.all([saveAttachment(input), saveAttachment(input), saveAttachment(input)]);
    expect(retries).toEqual([first, first, first]);
    expect(fs.readdirSync(path.join(tmpDir, 'attachments'))).toEqual([first.fileName]);
    await expect(saveAttachment({ ...input, data: Buffer.from('different') })).rejects.toMatchObject({ status: 409 });
  });

  describe('HEIC photos', () => {
    const stored = (fileName: string) => fs.readFileSync(path.join(tmpDir, 'attachments', fileName));
    const failingDecoder = async (actual: () => Promise<typeof import('./heic')>) => ({ ...(await actual()), heicToJpeg: () => Promise.reject(new Error('decoder unavailable')) });
    afterEach(() => { vi.doUnmock('./heic'); vi.restoreAllMocks(); });

    it('stores one as a JPEG, named and labeled as one', async () => {
      const { saveAttachment } = await import('./save');
      const result = await saveAttachment({ data: HEIC_PHOTO, originalName: 'IMG_4021.HEIC', mimeType: 'image/heic' });
      expect(result).toMatchObject({ originalName: 'IMG_4021.jpg', mimeType: 'image/jpeg' });
      expect(result.fileName).toMatch(/^[a-f0-9-]+\.jpg$/);
      expect(result.size).toBe(stored(result.fileName).byteLength);
      expect(await sharp(stored(result.fileName)).metadata()).toMatchObject({ format: 'jpeg', width: 64, height: 48 });
    });

    it('knows one by its bytes, whatever the browser called or labeled it', async () => {
      const { saveAttachment } = await import('./save');
      const unlabeled = await saveAttachment({ data: HEIC_PHOTO, originalName: 'upload', mimeType: 'application/octet-stream' });
      expect(unlabeled).toMatchObject({ originalName: 'upload', mimeType: 'image/jpeg' });
      expect(unlabeled.fileName).toMatch(/\.jpg$/);
      // The capture route labels an untyped photo image/jpeg: now it is one.
      const mislabeled = await saveAttachment({ data: HEIC_PHOTO, originalName: 'photo.jpeg', mimeType: 'image/jpeg' });
      expect((await sharp(stored(mislabeled.fileName)).metadata()).format).toBe('jpeg');
    });

    it('keeps one it cannot convert as it came, labeled HEIC', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { saveAttachment } = await import('./save');
      const damaged = Buffer.concat([HEIC_PHOTO.subarray(0, 36), Buffer.alloc(512, 0x5a)]);
      const result = await saveAttachment({ data: damaged, originalName: 'photo.jpeg', mimeType: 'image/jpeg' });
      expect(result).toMatchObject({ originalName: 'photo.jpeg', mimeType: 'image/heic', size: damaged.byteLength });
      expect(result.fileName).toMatch(/\.heic$/);
      expect(stored(result.fileName).equals(damaged)).toBe(true);
      expect(warn).toHaveBeenCalledOnce();
    });

    it('retries a converted upload into the same JPEG', async () => {
      const { saveAttachment } = await import('./save');
      const input = { data: HEIC_PHOTO, originalName: 'IMG_1.HEIC', mimeType: 'image/heic', idempotencyKey: `heic:${tmpDir}` };
      const first = await saveAttachment(input);
      fs.unlinkSync(path.join(tmpDir, 'attachments', first.fileName));
      expect(await saveAttachment(input)).toEqual(first);
      expect(stored(first.fileName).byteLength).toBe(first.size);
      expect((await sharp(stored(first.fileName)).metadata()).format).toBe('jpeg');
    });

    it('writes on retry what the reserved record describes, whichever attempt could convert', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const input = { data: HEIC_PHOTO, originalName: 'IMG_2.HEIC', mimeType: 'image/heic', idempotencyKey: `heic-kept:${tmpDir}` };
      // The first attempt couldn't convert, so its record is the photo as sent.
      vi.doMock('./heic', failingDecoder);
      const kept = await (await import('./save')).saveAttachment(input);
      expect(kept.mimeType).toBe('image/heic');
      vi.doUnmock('./heic');
      vi.resetModules();
      const { saveAttachment } = await import('./save');
      expect(await saveAttachment(input)).toEqual(kept);
      expect(stored(kept.fileName).equals(HEIC_PHOTO)).toBe(true);

      // A record of a JPEG never gets the photo's HEIC bytes: that retry fails, to be tried again.
      const other = { ...input, idempotencyKey: `heic-converted:${tmpDir}` };
      const converted = await saveAttachment(other);
      fs.unlinkSync(path.join(tmpDir, 'attachments', converted.fileName));
      vi.doMock('./heic', failingDecoder);
      vi.resetModules();
      await expect((await import('./save')).saveAttachment(other)).rejects.toMatchObject({ status: 503 });
      expect(fs.existsSync(path.join(tmpDir, 'attachments', converted.fileName))).toBe(false);
    });
  });
});
