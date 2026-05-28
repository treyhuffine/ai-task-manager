import { describe, it, expect } from 'vitest';
import type { FileUIPart } from 'ai';
import { fileNameFromUrl, fileUIPartToAttachment } from './file-ui-part';

describe('fileNameFromUrl', () => {
  it('extracts fileName from our standard serve URL', () => {
    expect(fileNameFromUrl('/api/attachments/0193abcd.png')).toBe('0193abcd.png');
    expect(fileNameFromUrl('/api/attachments/abc-def_123.txt')).toBe('abc-def_123.txt');
  });

  it('returns null for data URLs', () => {
    expect(fileNameFromUrl('data:text/plain;base64,SGVsbG8=')).toBeNull();
  });

  it('returns null for external URLs', () => {
    expect(fileNameFromUrl('https://example.com/foo.png')).toBeNull();
  });

  it('returns null for non-attachment internal paths', () => {
    expect(fileNameFromUrl('/api/sessions/abc/events')).toBeNull();
  });
});

describe('fileUIPartToAttachment', () => {
  const mkPart = (overrides: Partial<FileUIPart> = {}): FileUIPart => ({
    type: 'file',
    mediaType: overrides.mediaType ?? 'image/png',
    url: overrides.url ?? '/api/attachments/abc.png',
    filename: overrides.filename,
  });

  it('builds an Attachment from a standard URL', () => {
    const att = fileUIPartToAttachment(mkPart({ filename: 'photo.png' }));
    expect(att).toEqual({
      fileName: 'abc.png',
      originalName: 'photo.png',
      mimeType: 'image/png',
      size: 0,
      uploadedAt: '',
    });
  });

  it('falls back to fileName when no filename is provided', () => {
    const att = fileUIPartToAttachment(mkPart({ filename: undefined }));
    expect(att?.originalName).toBe('abc.png');
  });

  it('returns null for parts without a recognizable URL', () => {
    expect(fileUIPartToAttachment(mkPart({ url: 'data:image/png;base64,xyz' }))).toBeNull();
    expect(fileUIPartToAttachment(mkPart({ url: 'https://elsewhere.com/x.png' }))).toBeNull();
  });
});
