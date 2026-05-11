import { describe, it, expect } from 'vitest';
import { parseFileMarkers } from './parse-file-markers';
import type { Attachment } from '@/db/types';

const ATT = (file_name: string, overrides: Partial<Attachment> = {}): Attachment => ({
  file_name,
  original_name: overrides.original_name ?? file_name,
  mime_type: overrides.mime_type ?? 'text/plain',
  size: overrides.size ?? 0,
  uploaded_at: overrides.uploaded_at ?? '',
});

describe('parseFileMarkers', () => {
  it('returns a single text segment when there are no markers', () => {
    const segs = parseFileMarkers('just text', [ATT('a.txt')]);
    expect(segs).toEqual([{ kind: 'text', text: 'just text' }]);
  });

  it('returns empty for empty input', () => {
    expect(parseFileMarkers('', [])).toEqual([]);
  });

  it('splits text around a single marker', () => {
    const att = ATT('019-abc.png', { mime_type: 'image/png' });
    const segs = parseFileMarkers('look at [[file:019-abc.png]] please', [att]);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ kind: 'text', text: 'look at ' });
    expect(segs[1]).toEqual({ kind: 'chip', attachment: att });
    expect(segs[2]).toEqual({ kind: 'text', text: ' please' });
  });

  it('handles consecutive markers with no whitespace between', () => {
    const a = ATT('a.txt');
    const b = ATT('b.txt');
    const segs = parseFileMarkers('[[file:a.txt]][[file:b.txt]]', [a, b]);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ kind: 'chip', attachment: a });
    expect(segs[1]).toEqual({ kind: 'chip', attachment: b });
  });

  it('falls back to literal text when marker has no matching attachment', () => {
    const segs = parseFileMarkers('orphan [[file:nope.txt]]', []);
    // Both runs (the leading text and the unmatched marker as literal)
    // are text segments — chip is never emitted without a real attachment.
    expect(segs.find((s) => s.kind === 'chip')).toBeUndefined();
    expect(segs.map((s) => s.kind === 'text' ? s.text : '').join('')).toBe('orphan [[file:nope.txt]]');
  });

  it('matches file_names containing dots and dashes (uuidv7.ext form)', () => {
    const att = ATT('0193abcd-ef01-2345-6789-abcdef012345.tsx', { mime_type: 'text/plain' });
    const segs = parseFileMarkers(`see [[file:${att.file_name}]]`, [att]);
    expect(segs[1]?.kind).toBe('chip');
  });

  it('preserves text after the last marker', () => {
    const att = ATT('a.png', { mime_type: 'image/png' });
    const segs = parseFileMarkers('[[file:a.png]] caption', [att]);
    expect(segs[segs.length - 1]).toEqual({ kind: 'text', text: ' caption' });
  });
});
