import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { HEIC_PHOTO, HEIC_PORTRAIT, HEIC_QUADRANTS } from '@/test/fixtures/heic';
import { heicToJpeg, isHeic, isHeicFile } from './heic';

/** The sRGB color near each corner, as a browser shows it: through the image's profile. */
async function corners(jpeg: Buffer, { ignoreIcc = false } = {}) {
  const { data, info } = await sharp(jpeg, { ignoreIcc }).toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  const inset = 4;
  return {
    topLeft: at(inset, inset),
    topRight: at(info.width - inset, inset),
    bottomLeft: at(inset, info.height - inset),
    bottomRight: at(info.width - inset, info.height - inset),
  };
}

function expectColor(actual: number[], expected: readonly number[], tolerance = 4) {
  actual.forEach((channel, n) => expect(Math.abs(channel - expected[n]!), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance));
}

describe('isHeic', () => {
  it('knows a HEIC photo by its file type box', () => {
    expect(isHeic(HEIC_PHOTO)).toBe(true);
    expect(isHeic(HEIC_PORTRAIT)).toBe(true);
  });

  it('leaves other images and other ISO media to sharp', async () => {
    const create = { width: 8, height: 8, channels: 3 as const, background: '#336699' };
    expect(isHeic(await sharp({ create }).avif().toBuffer())).toBe(false);
    expect(isHeic(await sharp({ create }).png().toBuffer())).toBe(false);
    expect(isHeic(await sharp({ create }).jpeg().toBuffer())).toBe(false);
    // An MP4's file type box, brands isom and mp42.
    expect(isHeic(Buffer.from('000000186674797069736f6d0000020069736f6d6d703432', 'hex'))).toBe(false);
  });

  it('reads short and malformed headers without throwing', () => {
    expect(isHeic(new Uint8Array())).toBe(false);
    expect(isHeic(HEIC_PHOTO.subarray(0, 11))).toBe(false);
    expect(isHeic(Buffer.from('plain text, nothing more'))).toBe(false);
    // A box size past the end only limits how far its brands are read.
    expect(isHeic(Buffer.from('ffffffff667479706d696631000000006865696300', 'hex'))).toBe(true);
  });
});

describe('isHeicFile', () => {
  let folder: string | undefined;
  afterEach(async () => { if (folder) await fs.rm(folder, { recursive: true, force: true }); });

  it('reads only what it needs from the file', async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ri-heic-file-'));
    const photo = path.join(folder, 'photo.jpg');
    const tiny = path.join(folder, 'tiny.bin');
    await fs.writeFile(photo, HEIC_PHOTO);
    await fs.writeFile(tiny, 'ftyp');
    expect(await isHeicFile(photo)).toBe(true);
    expect(await isHeicFile(tiny)).toBe(false);
  });
});

describe('heicToJpeg', () => {
  it('makes a full size JPEG in the photo’s own colors', async () => {
    const jpeg = await heicToJpeg(HEIC_PHOTO);
    const meta = await sharp(jpeg).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: 64, height: 48 });
    expect(meta.orientation).toBeUndefined();
    expect(meta.icc?.length).toBeGreaterThan(0);
    const seen = await corners(jpeg);
    for (const corner of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const) expectColor(seen[corner], HEIC_QUADRANTS[corner]);
  });

  it('carries the profile its pixels need: read as sRGB they are visibly duller', async () => {
    const untagged = await corners(await heicToJpeg(HEIC_PHOTO), { ignoreIcc: true });
    expect(Math.abs(untagged.topLeft[0]! - HEIC_QUADRANTS.topLeft[0])).toBeGreaterThan(8);
  });

  it('turns a portrait photo upright', async () => {
    const jpeg = await heicToJpeg(HEIC_PORTRAIT);
    expect(await sharp(jpeg).metadata()).toMatchObject({ width: 48, height: 64 });
    // A quarter turn clockwise: the left column becomes the top row.
    const seen = await corners(jpeg);
    expectColor(seen.topLeft, HEIC_QUADRANTS.bottomLeft);
    expectColor(seen.topRight, HEIC_QUADRANTS.topLeft);
    expectColor(seen.bottomLeft, HEIC_QUADRANTS.bottomRight);
    expectColor(seen.bottomRight, HEIC_QUADRANTS.topRight);
  });

  it('converts photos sent together, one after another', async () => {
    const jpegs = await Promise.all([HEIC_PHOTO, HEIC_PORTRAIT, HEIC_PHOTO].map((photo) => heicToJpeg(photo)));
    expect(await Promise.all(jpegs.map(async (jpeg) => (await sharp(jpeg).metadata()).width))).toEqual([64, 48, 64]);
  });

  it('refuses a photo larger than it converts before decoding it', async () => {
    await expect(heicToJpeg(HEIC_PHOTO, { maxPixels: 1000 })).rejects.toThrow('64 by 48 pixels');
  });

  it('rejects a damaged photo instead of hanging', async () => {
    await expect(heicToJpeg(HEIC_PHOTO.subarray(0, 600))).rejects.toThrow();
    const junk = Buffer.concat([HEIC_PHOTO.subarray(0, 36), Buffer.alloc(2048, 0x5a)]);
    expect(isHeic(junk)).toBe(true);
    await expect(heicToJpeg(junk)).rejects.toThrow();
    // The lane goes on after a failure.
    expect((await sharp(await heicToJpeg(HEIC_PHOTO)).metadata()).width).toBe(64);
  });
});
