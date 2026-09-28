import { describe, expect, it, vi } from 'vitest';
import { ALLOWED_MIMES } from '@/lib/attachments/mime';
import {
  CAPTURE_MAX_IMAGE_BYTES,
  CAPTURE_MAX_IMAGES,
  CAPTURE_MAX_TEXT_LENGTH,
  chooseCaptureImages,
  transferFiles,
} from './capture-images';

function image(name = 'screenshot.png', size = 1, type = 'image/png'): File {
  return new File([new Uint8Array(size)], name, { type, lastModified: 123 });
}

function item(file: File | null) {
  return { kind: 'file', getAsFile: () => file };
}

describe('chooseCaptureImages', () => {
  it('adds all server-allowed image formats and preserves existing files', () => {
    const prior = image();
    for (const type of ALLOWED_MIMES) {
      if (!type.startsWith('image/')) continue;
      const incoming = image('image', 1, type);
      expect(chooseCaptureImages([prior], [incoming])).toEqual({
        files: [prior, incoming], errors: [],
      });
    }
  });

  it('normalizes types and extension fallbacks without losing bytes or names', async () => {
    const incoming = [
      image('Screenshot.PNG', 3, ''),
      image('picture.webp', 4, 'application/octet-stream'),
      image('picture.png', 5, ' image/png; charset=utf-8'),
    ];
    const result = chooseCaptureImages([], incoming);
    expect(result.errors).toEqual([]);
    expect(result.files.map(file => file.type)).toEqual(['image/png', 'image/webp', 'image/png']);
    for (const [index, file] of result.files.entries()) {
      expect(file.name).toBe(incoming[index].name);
      expect(file.lastModified).toBe(123);
      expect(await file.arrayBuffer()).toEqual(await incoming[index].arrayBuffer());
    }
  });

  it('rejects documents, unknown image types, and empty images without clearing the draft', () => {
    const prior = image();
    const result = chooseCaptureImages([prior], [
      image('doc.pdf', 1, 'application/pdf'),
      image('disguised.png', 1, 'text/plain'),
      image('unknown.tiff', 1, 'image/tiff'),
      image('empty.png', 0),
    ]);
    expect(result.files).toEqual([prior]);
    expect(result.errors).toEqual([
      'Only supported image files can be added.',
      'Empty image files cannot be added.',
    ]);
  });

  it('enforces the image count across multiple intake actions', () => {
    const existing = Array.from({ length: CAPTURE_MAX_IMAGES - 1 }, (_, n) => image(`${n}.png`));
    const accepted = image('last.png');
    const result = chooseCaptureImages(existing, [accepted, image('extra.png')]);
    expect(result.files).toEqual([...existing, accepted]);
    expect(result.errors).toEqual(['A capture can include up to 10 images.']);
    expect(existing).toHaveLength(CAPTURE_MAX_IMAGES - 1);
  });

  it('accepts exactly the byte limit, rejecting overflow across the entire draft', () => {
    const prior = image('large.png', CAPTURE_MAX_IMAGE_BYTES - 1);
    const accepted = image('last.png');
    const result = chooseCaptureImages([prior], [accepted, image('extra.png')]);
    expect(result.files).toEqual([prior, accepted]);
    expect(result.errors).toEqual(['Images in a capture must total 20 MiB or less.']);
  });

  it('continues accepting smaller files after one exceeds the remaining budget', () => {
    const prior = image('large.png', CAPTURE_MAX_IMAGE_BYTES - 1);
    const small = image();
    const result = chooseCaptureImages([prior], [image('too-large.png', 2), small]);
    expect(result.files).toEqual([prior, small]);
    expect(result.errors).toHaveLength(1);
  });

  it('deduplicates the same reference within one action but permits later reselection', () => {
    const incoming = image();
    const first = chooseCaptureImages([], [incoming, incoming]);
    expect(first.files).toEqual([incoming]);
    expect(chooseCaptureImages(first.files, [incoming]).files).toEqual([incoming, incoming]);
    expect(chooseCaptureImages([], [incoming, image()]).files).toHaveLength(2);
  });

  it('deduplicates before MIME normalization creates a replacement File', () => {
    const incoming = image('screenshot.png', 1, '');
    const result = chooseCaptureImages([], [incoming, incoming]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].type).toBe('image/png');
  });

  it('exposes the shared text limit for storage and UI', () => {
    expect(CAPTURE_MAX_TEXT_LENGTH).toBe(100_000);
  });
});

describe('transferFiles', () => {
  it('reads screenshot items and does not inspect clipboard strings or URLs', () => {
    const file = image();
    const getAsFile = vi.fn(() => image('remote-image.png'));
    expect(transferFiles({ items: [
      { kind: 'string', getAsFile },
      item(file),
    ] })).toEqual([file]);
    expect(getAsFile).not.toHaveBeenCalled();
  });

  it('falls back to FileList when items are absent, null, or inaccessible', () => {
    const file = image();
    expect(transferFiles({ files: [file] })).toEqual([file]);
    expect(transferFiles({ items: [item(null)], files: [file] })).toEqual([file]);
    expect(transferFiles({ items: [{
      kind: 'file', getAsFile: () => { throw new Error('Unavailable'); },
    }], files: [file] })).toEqual([file]);
  });

  it('combines partially available items and files without duplicate representations', () => {
    const fromItem = image();
    const sameFromFiles = image();
    const other = image('other.png');
    expect(transferFiles({
      items: [item(fromItem), item(null)],
      files: [sameFromFiles, other],
    })).toEqual([fromItem, other]);
  });

  it('removes duplicate references within either source', () => {
    const file = image();
    expect(transferFiles({ items: [item(file), item(file)], files: [file, file] })).toEqual([file]);
    expect(transferFiles({ files: [file, file] })).toEqual([file]);
    const fileListWrapper = image();
    expect(transferFiles({ items: [item(file)], files: [fileListWrapper, fileListWrapper] })).toEqual([file]);
  });

  it('preserves distinct files with identical metadata within one source', () => {
    const first = image();
    const second = image();
    expect(transferFiles({ items: [item(first), item(second)], files: [image(), image()] }))
      .toEqual([first, second]);
    expect(transferFiles({ files: [first, second] })).toEqual([first, second]);
  });

  it('ignores directory entries even when represented as pseudo-files', () => {
    const folder = image('screenshots.png', 0, '');
    const file = image();
    expect(transferFiles({
      items: [{ ...item(folder), webkitGetAsEntry: () => ({ isDirectory: true, name: folder.name }) }, item(file)],
      files: [folder, file],
    })).toEqual([file]);
    expect(transferFiles({
      items: [{ ...item(null), webkitGetAsEntry: () => ({ isDirectory: true, name: folder.name }) }],
      files: [folder],
    })).toEqual([]);
  });

  it('does not require webkit entries for ordinary file items', () => {
    const file = image();
    expect(transferFiles({ items: [{ ...item(file), webkitGetAsEntry: () => null }] })).toEqual([file]);
  });

  it('accepts native array-like lists and absent transfer data', () => {
    const file = image();
    expect(transferFiles({ items: { 0: item(file), length: 1 } })).toEqual([file]);
    expect(transferFiles(null)).toEqual([]);
    expect(transferFiles(undefined)).toEqual([]);
    expect(transferFiles({})).toEqual([]);
  });
});
