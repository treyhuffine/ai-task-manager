import { describe, it, expect } from 'vitest';
import {
  deriveAttachments,
  extractReferencedFileNames,
  rewriteAttachmentsForMirror,
} from './derive';
import type { Attachment } from '@/db/types';

const ATT = (file_name: string, overrides: Partial<Attachment> = {}): Attachment => ({
  file_name,
  original_name: overrides.original_name ?? file_name,
  mime_type: overrides.mime_type ?? 'image/png',
  size: overrides.size ?? 1024,
  uploaded_at: overrides.uploaded_at ?? '2026-04-21T00:00:00.000Z',
});

describe('extractReferencedFileNames', () => {
  it('returns empty for null/empty body', () => {
    expect(extractReferencedFileNames(null)).toEqual([]);
    expect(extractReferencedFileNames('')).toEqual([]);
    expect(extractReferencedFileNames(undefined)).toEqual([]);
  });

  it('extracts file_names from image markdown', () => {
    const body = 'intro\n![x](/api/attachments/01abc.png)\ntrailing';
    expect(extractReferencedFileNames(body)).toEqual(['01abc.png']);
  });

  it('extracts multiple attachments in document order, deduped', () => {
    const body = `
      First ![a](/api/attachments/first.png) middle
      second ![b](/api/attachments/second.webp)
      and first again ![c](/api/attachments/first.png)
    `;
    expect(extractReferencedFileNames(body)).toEqual(['first.png', 'second.webp']);
  });

  it('extracts non-image references (link syntax to audio)', () => {
    const body = 'listen: [voice-memo.webm](/api/attachments/abc.webm)';
    expect(extractReferencedFileNames(body)).toEqual(['abc.webm']);
  });

  it('ignores unrelated URLs that happen to contain the prefix text', () => {
    const body = 'check https://example.com/api/attachments-elsewhere?id=foo';
    // prefix is `/api/attachments/<name>.<ext>` — the dash + query breaks the
    // capture, so nothing matches.
    expect(extractReferencedFileNames(body)).toEqual([]);
  });

  it('rejects traversal-looking names', () => {
    // The regex requires `<segment>.<ext>` where segment is [A-Za-z0-9_-]+,
    // which does not include `/`. So `../foo.png` doesn't match the capture.
    const body = 'sneaky ![x](/api/attachments/../foo.png)';
    expect(extractReferencedFileNames(body)).toEqual([]);
  });
});

describe('deriveAttachments', () => {
  it('returns empty for empty body', () => {
    expect(deriveAttachments({ body: '', prior: [], newUploads: [] })).toEqual([]);
  });

  it('preserves prior metadata for file_names still referenced', () => {
    const prior = [ATT('a.png', { original_name: 'Cat photo.png', size: 2048 })];
    const result = deriveAttachments({
      body: 'Here ![](/api/attachments/a.png)',
      prior,
      newUploads: [],
    });
    expect(result).toEqual([prior[0]]);
  });

  it('drops prior rows no longer referenced in the body', () => {
    const prior = [ATT('kept.png'), ATT('removed.png')];
    const result = deriveAttachments({
      body: '![](/api/attachments/kept.png)',
      prior,
      newUploads: [],
    });
    expect(result.map((a) => a.file_name)).toEqual(['kept.png']);
  });

  it('incorporates newUploads metadata for newly-referenced file_names', () => {
    const uploads = [ATT('new.png', { original_name: 'Fresh upload.png', size: 4096 })];
    const result = deriveAttachments({
      body: '![](/api/attachments/new.png)',
      prior: [],
      newUploads: uploads,
    });
    expect(result).toEqual([uploads[0]]);
  });

  it('creates a stub for references unknown in prior + uploads', () => {
    const result = deriveAttachments({
      body: '![](/api/attachments/mystery.png)',
      prior: [],
      newUploads: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].file_name).toBe('mystery.png');
    expect(result[0].mime_type).toBe('application/octet-stream');
    expect(result[0].size).toBe(0);
    expect(result[0].original_name).toBe('mystery.png');
  });

  it('orders output by reading order in the body', () => {
    const prior = [ATT('c.png'), ATT('a.png'), ATT('b.png')];
    const result = deriveAttachments({
      body: '![](/api/attachments/a.png) ![](/api/attachments/b.png) ![](/api/attachments/c.png)',
      prior,
      newUploads: [],
    });
    expect(result.map((a) => a.file_name)).toEqual(['a.png', 'b.png', 'c.png']);
  });

  it('prefers prior metadata over newUploads when both contain the same file_name', () => {
    // Prior wins because it's the server's source of truth — newUploads is a
    // hint from the client that may contain an out-of-date transient copy.
    const prior = [ATT('x.png', { original_name: 'Original name.png' })];
    const uploads = [ATT('x.png', { original_name: 'Stale dup.png' })];
    const result = deriveAttachments({
      body: '![](/api/attachments/x.png)',
      prior,
      newUploads: uploads,
    });
    expect(result[0].original_name).toBe('Original name.png');
  });
});

describe('rewriteAttachmentsForMirror', () => {
  it('rewrites every api prefix to the mirror-relative path', () => {
    const body = '![](/api/attachments/a.png) text ![](/api/attachments/b.webp)';
    expect(rewriteAttachmentsForMirror(body)).toBe(
      '![](../attachments/a.png) text ![](../attachments/b.webp)',
    );
  });

  it('is a no-op when there are no refs', () => {
    expect(rewriteAttachmentsForMirror('plain text')).toBe('plain text');
  });

  it('handles empty input', () => {
    expect(rewriteAttachmentsForMirror('')).toBe('');
    expect(rewriteAttachmentsForMirror(null)).toBe('');
    expect(rewriteAttachmentsForMirror(undefined)).toBe('');
  });
});
