import { describe, it, expect } from 'vitest';
import { extractEntityMarkers, rewriteEntityMarkers } from './extract-links';

const key = (m: { kind: string; id?: string }) =>
  m.kind === 'scratchpad' ? 'scratchpad' : `${m.kind}:${(m as { id: string }).id}`;

describe('extractEntityMarkers', () => {
  it('extracts task/note/scratchpad markers outside code', () => {
    const markers = extractEntityMarkers('a [[note:n1]] b [[task:t1]] c [[scratchpad]]');
    expect(markers.map(key)).toEqual(['note:n1', 'task:t1', 'scratchpad']);
  });

  it('ignores markers inside fenced and inline code', () => {
    const text = ['keep [[note:a]]', '```', '[[note:b]]', '```', 'and `[[note:c]]` inline'].join(
      '\n',
    );
    expect(extractEntityMarkers(text).map(key)).toEqual(['note:a']);
  });

  it('masks an unclosed fence through end of text', () => {
    expect(extractEntityMarkers('```\n[[note:x]]')).toEqual([]);
  });

  it('a shorter fence does not close a longer one', () => {
    // The ``` line is inside the ```` fence, so the marker stays masked.
    const text = ['````', '```', '[[note:x]]', '````'].join('\n');
    expect(extractEntityMarkers(text)).toEqual([]);
  });

  it('extracts a marker after a properly closed fence', () => {
    const text = ['```', 'code [[note:z]]', '```', '[[note:y]]'].join('\n');
    expect(extractEntityMarkers(text).map(key)).toEqual(['note:y']);
  });
});

describe('rewriteEntityMarkers', () => {
  it('rewrites outside code, preserves inside code, leaves unresolved verbatim', () => {
    const text = 'see [[note:a]] and `[[note:b]]` and [[note:c]]';
    const out = rewriteEntityMarkers(text, ({ id }) => (id === 'a' ? '[[notes/foo--a]]' : null));
    expect(out).toBe('see [[notes/foo--a]] and `[[note:b]]` and [[note:c]]');
  });

  it('keeps surrounding text aligned when the replacement changes length', () => {
    const text = 'x [[task:t1]] y';
    const out = rewriteEntityMarkers(text, ({ kind, id }) => `[[${kind}s/title--${id}]]`);
    expect(out).toBe('x [[tasks/title--t1]] y');
  });

  it('never rewrites file/scratchpad markers', () => {
    const text = '[[scratchpad]] and [[file:abc.png]]';
    const out = rewriteEntityMarkers(text, () => 'SHOULD_NOT_APPEAR');
    expect(out).toBe(text);
  });
});
