import { describe, expect, it } from 'vitest';
import { ATTACHMENT_FILE_NAME, markedFileNames, placeFileMarkers, readsNatively } from './markers';

describe('file markers', () => {
  it('names each marked file once', () => {
    expect([...markedFileNames('a [[file:x.png]] b [[file:y.pdf]] c [[file:x.png]]')]).toEqual(['x.png', 'y.pdf']);
  });

  it('places the files it knows, and leaves the rest as written', () => {
    const placed = placeFileMarkers('see [[file:x.png]] and [[file:y.pdf]]', (name) => (name === 'x.png' ? '/here/x.png' : null));
    expect(placed).toBe('see /here/x.png and [[file:y.pdf]]');
  });

  it('knows which files the agent opens itself', () => {
    for (const mime of ['text/plain', 'text/markdown', 'image/png', 'application/pdf', 'application/json', 'application/xml']) {
      expect(readsNatively(mime)).toBe(true);
    }
    for (const mime of ['audio/webm', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']) {
      expect(readsNatively(mime)).toBe(false);
    }
  });

  it('takes a stored name, never a path', () => {
    expect(ATTACHMENT_FILE_NAME.test('01a0d926-176a-7692-b128-cd01e081f348.txt')).toBe(true);
    for (const name of ['..', '.', '../x.txt', 'a/b.txt', 'x', '.hidden.txt']) {
      expect(ATTACHMENT_FILE_NAME.test(name)).toBe(false);
    }
  });
});
