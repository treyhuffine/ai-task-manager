import { describe, it, expect } from 'vitest';
import {
  parseConflicts,
  serializeResolution,
  hasConflictMarkers,
  type ConflictResolution,
} from './parse';

/** Build a standard (merge-style) conflict block string. */
function conflict(
  ours: string,
  theirs: string,
  { oursLabel = 'HEAD', theirsLabel = 'feature' } = {},
): string {
  return `<<<<<<< ${oursLabel}\n${ours}\n=======\n${theirs}\n>>>>>>> ${theirsLabel}`;
}

describe('hasConflictMarkers', () => {
  it('is false for ordinary text', () => {
    expect(hasConflictMarkers('const a = 1;\nconst b = 2;\n')).toBe(false);
  });
  it('is false for inline mentions of markers', () => {
    // Prose describing markers mid-line must not trip detection.
    expect(hasConflictMarkers('remove the `<<<<<<<` marker from the file')).toBe(false);
  });
  it('is true when a marker opens a line', () => {
    expect(hasConflictMarkers('a\n<<<<<<< HEAD\nb')).toBe(true);
  });
  it('is true when a marker opens the file', () => {
    expect(hasConflictMarkers('<<<<<<< HEAD\nb')).toBe(true);
  });
});

describe('parseConflicts', () => {
  it('treats marker-free content as a single context segment', () => {
    const parsed = parseConflicts('line one\nline two\n');
    expect(parsed.count).toBe(0);
    expect(parsed.segments).toEqual([{ type: 'context', lines: ['line one', 'line two'] }]);
    expect(parsed.trailingNewline).toBe(true);
  });

  it('parses a single conflict with surrounding context', () => {
    const content = `before\n${conflict('ours line', 'theirs line')}\nafter\n`;
    const parsed = parseConflicts(content);
    expect(parsed.count).toBe(1);
    expect(parsed.segments).toHaveLength(3);
    expect(parsed.segments[0]).toEqual({ type: 'context', lines: ['before'] });
    const seg = parsed.segments[1];
    expect(seg.type).toBe('conflict');
    if (seg.type !== 'conflict') throw new Error('expected conflict');
    expect(seg.block.current).toEqual(['ours line']);
    expect(seg.block.incoming).toEqual(['theirs line']);
    expect(seg.block.currentLabel).toBe('HEAD');
    expect(seg.block.incomingLabel).toBe('feature');
    expect(seg.block.base).toBeUndefined();
    expect(parsed.segments[2]).toEqual({ type: 'context', lines: ['after'] });
  });

  it('parses multiple conflicts', () => {
    const content = `${conflict('a1', 'b1')}\nmid\n${conflict('a2', 'b2')}`;
    const parsed = parseConflicts(content);
    expect(parsed.count).toBe(2);
    const blocks = parsed.segments.filter((s) => s.type === 'conflict');
    expect(blocks).toHaveLength(2);
  });

  it('captures the base section for diff3-style conflicts', () => {
    const content =
      '<<<<<<< HEAD\nours\n||||||| base\ncommon\n=======\ntheirs\n>>>>>>> other\n';
    const parsed = parseConflicts(content);
    expect(parsed.count).toBe(1);
    const seg = parsed.segments[0];
    if (seg.type !== 'conflict') throw new Error('expected conflict');
    expect(seg.block.current).toEqual(['ours']);
    expect(seg.block.base).toEqual(['common']);
    expect(seg.block.incoming).toEqual(['theirs']);
  });

  it('handles empty sides', () => {
    const content = '<<<<<<< HEAD\n=======\nadded by them\n>>>>>>> other';
    const parsed = parseConflicts(content);
    expect(parsed.count).toBe(1);
    const seg = parsed.segments[0];
    if (seg.type !== 'conflict') throw new Error('expected conflict');
    expect(seg.block.current).toEqual([]);
    expect(seg.block.incoming).toEqual(['added by them']);
  });

  it('falls back to context on a malformed (unterminated) block', () => {
    const content = '<<<<<<< HEAD\nours\n=======\ntheirs never closed';
    const parsed = parseConflicts(content);
    expect(parsed.count).toBe(0);
    expect(parsed.segments).toHaveLength(1);
    expect(parsed.segments[0].type).toBe('context');
  });

  it('normalizes CRLF for matching', () => {
    const content = 'a\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> other\r\n';
    const parsed = parseConflicts(content);
    expect(parsed.count).toBe(1);
  });
});

describe('serializeResolution', () => {
  const content = `head\n${conflict('OURS', 'THEIRS')}\ntail\n`;
  const parsed = parseConflicts(content);

  const roundTrip = (choice: ConflictResolution | null) =>
    serializeResolution(parsed, [choice]);

  it('keeps the original markers verbatim when unresolved', () => {
    expect(roundTrip(null)).toBe(content);
  });

  it('accepts the current change', () => {
    expect(roundTrip('current')).toBe('head\nOURS\ntail\n');
  });

  it('accepts the incoming change', () => {
    expect(roundTrip('incoming')).toBe('head\nTHEIRS\ntail\n');
  });

  it('accepts both changes (current then incoming)', () => {
    expect(roundTrip('both')).toBe('head\nOURS\nTHEIRS\ntail\n');
  });

  it('preserves absence of a trailing newline', () => {
    const noNl = parseConflicts(`x\n${conflict('A', 'B')}`);
    expect(noNl.trailingNewline).toBe(false);
    expect(serializeResolution(noNl, ['current'])).toBe('x\nA');
  });

  it('resolves each block independently in a multi-conflict file', () => {
    const multi = parseConflicts(`${conflict('a1', 'b1')}\nmid\n${conflict('a2', 'b2')}`);
    expect(serializeResolution(multi, ['current', 'incoming'])).toBe('a1\nmid\nb2');
  });
});
