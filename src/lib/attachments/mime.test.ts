import { describe, it, expect } from 'vitest';
import {
  normalizeMime,
  extFromName,
  extForFile,
  resolveMime,
  isAllowedMime,
} from './mime';

describe('normalizeMime', () => {
  it('lowercases + trims', () => {
    expect(normalizeMime(' IMAGE/PNG ')).toBe('image/png');
  });

  it('strips parameters after the semicolon', () => {
    expect(normalizeMime('text/plain; charset=utf-8')).toBe('text/plain');
    expect(normalizeMime('audio/webm;codecs=opus')).toBe('audio/webm');
  });

  it('returns empty for null/undefined/empty', () => {
    expect(normalizeMime(null)).toBe('');
    expect(normalizeMime(undefined)).toBe('');
    expect(normalizeMime('')).toBe('');
  });
});

describe('extFromName', () => {
  it('returns lowercase extension', () => {
    expect(extFromName('Screenshot.PNG')).toBe('png');
    expect(extFromName('archive.tar.gz')).toBe('gz');
  });

  it('returns null for nameless or dot-prefix files', () => {
    expect(extFromName('file')).toBeNull();
    expect(extFromName('.hidden')).toBeNull();
  });

  it('returns null for trailing dot', () => {
    expect(extFromName('weird.')).toBeNull();
  });

  it('rejects non-alphanumeric extensions', () => {
    // Defends against `foo.png/../../evil`
    expect(extFromName('foo.png/bar')).toBeNull();
    expect(extFromName('foo.p n g')).toBeNull();
  });

  it('returns null for null/empty input', () => {
    expect(extFromName(null)).toBeNull();
    expect(extFromName('')).toBeNull();
  });
});

describe('extForFile', () => {
  it('prefers mime-derived extension', () => {
    expect(extForFile('image/png', 'whatever.bin')).toBe('png');
    expect(extForFile('audio/webm', 'memo')).toBe('webm');
  });

  it('falls back to filename extension for unknown mimes', () => {
    expect(extForFile('application/x-fake', 'thing.xyz')).toBe('xyz');
  });

  it('falls back to `bin` when nothing else works', () => {
    expect(extForFile('application/x-fake', 'thing')).toBe('bin');
  });
});

describe('resolveMime', () => {
  it('uses the normalized header when provided', () => {
    expect(resolveMime('image/png', 'ignored.jpg')).toBe('image/png');
  });

  it('falls back to extension-based mime when header is octet-stream', () => {
    expect(resolveMime('application/octet-stream', 'photo.png')).toBe('image/png');
  });

  it('falls back to extension when header is empty', () => {
    expect(resolveMime('', 'photo.png')).toBe('image/png');
  });

  it('passes through unknown mimes when extension matching fails', () => {
    expect(resolveMime('application/x-odd', 'file.xyz')).toBe('application/x-odd');
  });

  it('ends with octet-stream when everything is unknown', () => {
    expect(resolveMime(null, 'file')).toBe('application/octet-stream');
  });
});

describe('isAllowedMime', () => {
  it('accepts common images, audio, documents', () => {
    expect(isAllowedMime('image/png')).toBe(true);
    expect(isAllowedMime('audio/webm')).toBe(true);
    expect(isAllowedMime('application/pdf')).toBe(true);
  });

  it('rejects unknown / disallowed types', () => {
    expect(isAllowedMime('application/x-executable')).toBe(false);
    expect(isAllowedMime('text/html')).toBe(false);
  });
});
