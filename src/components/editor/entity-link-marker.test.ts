import { describe, it, expect } from 'vitest';
import { ENTITY_LINK_RE, renderEntityLinkMarkdown } from './entity-link-marker';

describe('entity link marker round-trip', () => {
  it('renders the canonical marker', () => {
    expect(renderEntityLinkMarkdown('note', 'abc')).toBe('[[note:abc]]');
    expect(renderEntityLinkMarkdown('task', '019-x.y_z')).toBe('[[task:019-x.y_z]]');
  });

  it('tokenizes a marker at the start of a string', () => {
    const m = ENTITY_LINK_RE.exec('[[note:019abc]] and more');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('note');
    expect(m![2]).toBe('019abc');
    expect(m![0]).toBe('[[note:019abc]]');
  });

  it('only matches at the start (the tokenizer scans from a hint index)', () => {
    expect(ENTITY_LINK_RE.exec('text [[note:x]]')).toBeNull();
  });

  it('rejects unsupported kinds and empty ids', () => {
    expect(ENTITY_LINK_RE.exec('[[area:x]]')).toBeNull();
    expect(ENTITY_LINK_RE.exec('[[scratchpad]]')).toBeNull();
    expect(ENTITY_LINK_RE.exec('[[note:]]')).toBeNull();
  });

  it('round-trips render → tokenize for uuidv7-shaped ids', () => {
    const id = '0192abcd-1234-7890-abcd-ef0123456789';
    const md = renderEntityLinkMarkdown('task', id);
    const m = ENTITY_LINK_RE.exec(md);
    expect(m![1]).toBe('task');
    expect(m![2]).toBe(id);
  });
});
