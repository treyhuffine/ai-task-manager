import { DOMParser } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { artifactSequence, sameArtifact } from './artifact-previews';

// Two chats on one page, a slideout, and loose cards: Previous and Next stay
// in the clicked card's own group, in document order.
const page = () => new DOMParser().parseFromString(`<html><body>
  <section role="log" aria-label="Chat"><p><button data-artifact-card id="a1"></button></p><div><div><button data-artifact-card id="a2"></button><button id="not-a-card"></button></div></div><button data-artifact-card id="a3"></button></section>
  <section role="log" aria-label="Other chat"><button data-artifact-card id="b1"></button></section>
  <div role="dialog"><button data-artifact-card id="d1"></button><section role="log"><button data-artifact-card id="d-log"></button></section><button data-artifact-card id="d2"></button></div>
  <button data-artifact-card id="loose1"></button><button data-artifact-card id="loose2"></button>
</body></html>`, 'text/html');

const ids = (cards: Element[]) => cards.map(card => card.id);
const every = () => true;

describe('artifactSequence', () => {
  it('keeps to the trigger\'s chat, in transcript order', () => {
    const doc = page();
    expect(ids(artifactSequence(doc.getElementById('a2')!, every, every))).toEqual(['a1', 'a2', 'a3']);
    expect(ids(artifactSequence(doc.getElementById('b1')!, every, every))).toEqual(['b1']);
  });

  it('treats a dialog as a group without taking in a chat inside it, and groups loose cards by page', () => {
    const doc = page();
    expect(ids(artifactSequence(doc.getElementById('d2')!, every, every))).toEqual(['d1', 'd2']);
    expect(ids(artifactSequence(doc.getElementById('d-log')!, every, every))).toEqual(['d-log']);
    expect(ids(artifactSequence(doc.getElementById('loose2')!, every, every))).toEqual(['loose1', 'loose2']);
  });

  it('skips hidden copies, unregistered and removed cards, but keeps the trigger', () => {
    const doc = page();
    doc.getElementById('a3')!.remove();
    expect(ids(artifactSequence(doc.getElementById('a1')!, every, every))).toEqual(['a1', 'a2']);
    expect(ids(artifactSequence(doc.getElementById('a2')!, every, card => card.id !== 'a1' && card.id !== 'a2'))).toEqual(['a2']);
    expect(ids(artifactSequence(doc.getElementById('a2')!, card => card.id !== 'a1', every))).toEqual(['a2']);
  });
});

describe('sameArtifact', () => {
  it('matches an image by source and an HTML file by chat and path', () => {
    expect(sameArtifact({ kind: 'image', src: '/a.png', name: 'a.png', alt: '' }, { kind: 'image', src: '/a.png', name: 'Renamed', alt: 'x' })).toBe(true);
    expect(sameArtifact({ kind: 'image', src: '/a.png', name: 'a', alt: '' }, { kind: 'image', src: '/b.png', name: 'a', alt: '' })).toBe(false);
    expect(sameArtifact({ kind: 'html', sessionId: 's', path: '/x.html' }, { kind: 'html', sessionId: 's', path: '/x.html' })).toBe(true);
    expect(sameArtifact({ kind: 'html', sessionId: 's', path: '/x.html' }, { kind: 'html', sessionId: 't', path: '/x.html' })).toBe(false);
    expect(sameArtifact({ kind: 'html', sessionId: 's', path: '/x.html' }, { kind: 'image', src: '/x.html', name: 'x', alt: '' })).toBe(false);
    const pdf = { kind: 'pdf', src: '/api/sessions/s/pdf?path=%2Ftmp%2Fr.pdf', name: 'r.pdf', source: '/tmp/r.pdf' } as const;
    expect(sameArtifact(pdf, { ...pdf, name: 'Renamed' })).toBe(true);
    expect(sameArtifact(pdf, { ...pdf, src: '/api/attachments/x.pdf' })).toBe(false);
    expect(sameArtifact(pdf, { kind: 'image', src: pdf.src, name: 'r.pdf', alt: '' })).toBe(false);
  });
});
