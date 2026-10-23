import { DOMParser } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { artifactSequence, previewCopySource, previewDownload, sameArtifact } from './artifact-previews';

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
    expect(ids(artifactSequence(doc.getElementById('a2')!, every, card => card.id !== 'a1'))).toEqual(['a2']);
    expect(ids(artifactSequence(doc.getElementById('a2')!, card => card.id !== 'a1', every))).toEqual(['a2']);
  });

  it('steps through a transcript hidden as a whole, as an expanded tools panel hides the chat', () => {
    const doc = page();
    const hidden = () => false;
    expect(ids(artifactSequence(doc.getElementById('a2')!, every, hidden))).toEqual(['a1', 'a2', 'a3']);
    expect(ids(artifactSequence(doc.getElementById('b1')!, every, hidden))).toEqual(['b1']);
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
    const text = { kind: 'text', sessionId: 's', path: '/tmp/notes.md' } as const;
    expect(sameArtifact(text, { ...text })).toBe(true);
    expect(sameArtifact(text, { ...text, sessionId: 'other' })).toBe(false);
    expect(sameArtifact(text, { ...text, path: '/tmp/other.md' })).toBe(false);
    expect(sameArtifact(text, { ...text, kind: 'html' })).toBe(false);
  });
});

describe('previewDownload', () => {
  it('downloads every file Ri holds under its own name, and leaves a web image to the web', () => {
    expect(previewDownload({ kind: 'pdf', src: '/api/attachments/x.pdf?name=Plan.pdf', name: 'Plan.pdf', source: 'Plan.pdf' }))
      .toEqual({ href: '/api/attachments/x.pdf?name=Plan.pdf&download=1', name: 'Plan.pdf' });
    expect(previewDownload({ kind: 'html', sessionId: 's1', path: '/tmp/out/summary.html' }))
      .toEqual({ href: '/api/sessions/s1/html?path=%2Ftmp%2Fout%2Fsummary.html&download=1', name: 'summary.html' });
    expect(previewDownload({ kind: 'image', src: '/api/attachments/01a.png', name: 'Screenshot.png', alt: '' }))
      .toEqual({ href: '/api/attachments/01a.png', name: 'Screenshot.png' });
    expect(previewDownload({ kind: 'image', src: '/api/sessions/s1/reply-image?path=%2Ftmp%2Fshot.png', name: 'shot.png', alt: '' }))
      .toEqual({ href: '/api/sessions/s1/reply-image?path=%2Ftmp%2Fshot.png', name: 'shot.png' });
    expect(previewDownload({ kind: 'image', src: 'data:image/png;base64,AAAA', name: 'image.png', alt: '' })?.href).toBe('data:image/png;base64,AAAA');
    expect(previewDownload({ kind: 'image', src: 'blob:http://ri.local/image', name: 'image.png', alt: '' })?.href).toBe('blob:http://ri.local/image');
    expect(previewDownload({ kind: 'image', src: 'https://github.com/x/y/raw/shot.png', name: 'shot.png', alt: '' })).toBeNull();
    expect(previewDownload({ kind: 'text', sessionId: 'chat 1', path: '/tmp/My Notes.md' }))
      .toEqual({ href: '/api/sessions/chat%201/download?path=%2Ftmp%2FMy%20Notes.md', name: 'My Notes.md' });
  });
});

it('copies original local paths and uses file links for uploads and web images', () => {
  expect(previewCopySource({ kind: 'text', sessionId: 's', path: '../notes.md' })).toEqual({ label: 'Copy path', value: '../notes.md' });
  expect(previewCopySource({ kind: 'html', sessionId: 's', path: '/tmp/report.html' })).toEqual({ label: 'Copy path', value: '/tmp/report.html' });
  expect(previewCopySource({ kind: 'image', src: '/api/sessions/s/reply-image?path=%2Ftmp%2Fa%20b.png', name: 'a b.png', alt: '' })).toEqual({ label: 'Copy path', value: '/tmp/a b.png' });
  expect(previewCopySource({ kind: 'pdf', src: '/api/sessions/s/pdf?path=%2Ftmp%2Fa.pdf', name: 'a.pdf', source: '/tmp/a.pdf' })).toEqual({ label: 'Copy path', value: '/tmp/a.pdf' });
  expect(previewCopySource({ kind: 'pdf', src: '/api/attachments/a.pdf', name: 'A.pdf', source: 'A.pdf' })).toEqual({ label: 'Copy link', value: '/api/attachments/a.pdf' });
  expect(previewCopySource({ kind: 'pdf', src: 'https://example.com/a.pdf?path=report', name: 'A.pdf', source: 'A.pdf' })).toEqual({ label: 'Copy link', value: 'https://example.com/a.pdf?path=report' });
  expect(previewCopySource({ kind: 'image', src: 'https://example.com/a.png', name: 'a.png', alt: '' })).toEqual({ label: 'Copy link', value: 'https://example.com/a.png' });
  expect(previewCopySource({ kind: 'image', src: 'data:image/png;base64,AAAA', name: 'a.png', alt: '' })).toBeNull();
});
