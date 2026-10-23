import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, it, vi } from 'vitest';
import { HEIC_PORTRAIT, HEIC_QUADRANTS } from '@/test/fixtures/heic';
import { imageThumbnail, imageVersion } from './image-thumbnail';

let temporary: string | undefined;
afterEach(async () => { vi.unstubAllEnvs(); if (temporary) await fs.rm(temporary, { recursive: true, force: true }); });

it('makes bounded thumbnails, shares concurrent work and reuses disk bytes', async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ri-image-thumbnails-'));
  vi.stubEnv('RI_WORK_DIR', temporary);
  const file = path.join(temporary, 'wide.png');
  await sharp({ create: { width: 2400, height: 1600, channels: 4, background: '#bbaaff' } }).png().toFile(file);
  const version = await imageVersion(file, true);
  const [first, second] = await Promise.all([imageThumbnail(file, version), imageThumbnail(file, version)]);
  expect(first.equals(second)).toBe(true);
  expect(await sharp(first).metadata()).toMatchObject({ width: 480, height: 320, format: 'webp' });
  expect(first.length).toBeLessThan((await fs.stat(file)).size);
  // A cached thumbnail needs no source decoding.
  await fs.unlink(file);
  expect((await imageThumbnail(file, version)).equals(first)).toBe(true);
});

it('changes the version when a screenshot is replaced, and keeps originals distinct', async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ri-image-version-'));
  const file = path.join(temporary, 'shot.png');
  await fs.writeFile(file, 'first');
  const first = await imageVersion(file, true);
  expect(await imageVersion(file, false)).not.toBe(first);
  await fs.writeFile(file, 'replacement with different bytes');
  expect(await imageVersion(file, true)).not.toBe(first);
});

it('draws a HEIC photo sharp cannot decode: upright and in its own colors', async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ri-image-thumbnails-heic-'));
  vi.stubEnv('RI_WORK_DIR', temporary);
  // An older attachment, or a photo an agent showed by its path.
  const file = path.join(temporary, 'IMG_0001.HEIC');
  await fs.writeFile(file, HEIC_PORTRAIT);
  const thumbnail = await imageThumbnail(file, await imageVersion(file, true));
  expect(await sharp(thumbnail).metadata()).toMatchObject({ width: 48, height: 64, format: 'webp' });
  const { data, info } = await sharp(thumbnail).raw().toBuffer({ resolveWithObject: true });
  const topRight = [...data.subarray((4 * info.width + info.width - 4) * info.channels, (4 * info.width + info.width - 4) * info.channels + 3)];
  topRight.forEach((channel, n) => expect(Math.abs(channel - HEIC_QUADRANTS.topLeft[n]!)).toBeLessThanOrEqual(6));
});
