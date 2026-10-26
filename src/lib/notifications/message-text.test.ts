import { describe, expect, it } from 'vitest';
import { fitText, messageText, oneLine, splitText } from './message-text';

describe('messageText', () => {
  it('keeps the reply’s shape and drops its syntax', () => {
    const reply = [
      '## Done',
      '',
      'Fixed **the login bug** in `auth/session.ts` and kept `refresh_token_ttl` as it was.',
      '',
      '- One',
      '- Two, with [the PR](https://github.com/acme/app/pull/12)',
      '  1. nested',
      '',
      '```ts',
      'const a = 1;',
      '```',
      '',
      '> Quoted',
      '',
      '---',
      '',
      'See [the doc](docs/notes.md).',
    ].join('\n');
    expect(messageText(reply)).toBe([
      'Done',
      '',
      'Fixed the login bug in auth/session.ts and kept refresh_token_ttl as it was.',
      '',
      '• One',
      '• Two, with the PR (https://github.com/acme/app/pull/12)',
      '  1. nested',
      '',
      'const a = 1;',
      '',
      '> Quoted',
      '',
      'See the doc.',
    ].join('\n'));
  });

  it('names entity markers the way their chips do, and drops the ones it can’t name', () => {
    const names: Record<string, string> = { 'task:01a0a609-a973': 'Fix *login*', 'execution:01a0cbf0-11b7': 'Auth work' };
    const reply = 'Created:\n\n[[task:01a0a609-a973]]\n\nRunning in [[execution:01a0cbf0-11b7]].\n\n[[note:01a0dead-beef]]\n\n[[file:01a0.png]]';
    expect(messageText(reply, (kind, id) => names[`${kind}:${id}`])).toBe('Created:\n\nFix *login*\n\nRunning in Auth work.');
  });

  it('names an agent by its name', () => {
    expect(messageText('Asked [[agent:01a0f1c2-0000]] to check.', (kind, id) => (kind === 'agent' && id === '01a0f1c2-0000' ? 'Finances' : null)))
      .toBe('Asked Finances to check.');
  });

  it('keeps soft line breaks, so a column of names stays a column', () => {
    expect(messageText('Needs you\n[[task:aaaaaaaa]]\n[[task:bbbbbbbb]]', (_, id) => `Task ${id.slice(0, 1)}`))
      .toBe('Needs you\nTask a\nTask b');
  });

  it('drops control characters and trailing space', () => {
    expect(messageText('a\u0007b  \n\n\n\nc\td')).toBe('ab\n\nc  d');
  });
});

describe('oneLine', () => {
  it('collapses every run of whitespace', () => {
    expect(oneLine('Done\n\n• One\n• Two')).toBe('Done • One • Two');
  });
});

describe('fitText', () => {
  it('returns text that fits unchanged', () => {
    expect(fitText('short', 10)).toBe('short');
  });

  it('cuts at the last paragraph that fits', () => {
    const text = `${'a'.repeat(70)}.\n\n${'b'.repeat(70)}.`;
    expect(fitText(text, 100)).toBe(`${'a'.repeat(70)}. …`);
  });

  it('cuts at a sentence, then a word, when no paragraph ends near the limit', () => {
    const sentences = `${'word '.repeat(14)}end. ${'more '.repeat(20)}`;
    expect(fitText(sentences, 80)).toBe(`${'word '.repeat(14)}end. …`);
    expect(fitText('word '.repeat(40), 50)).toBe(`${'word '.repeat(9)}word…`);
  });

  it('hard-cuts text with no boundary near the limit', () => {
    expect(fitText('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('never splits a surrogate pair', () => {
    const out = fitText('😀'.repeat(20), 9);
    expect(out).toBe('😀😀😀😀…');
    expect(out.length).toBeLessThanOrEqual(9);
  });

  it('fits by any additive measure', () => {
    const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
    const out = fitText('é'.repeat(100), 51, bytes);
    expect(bytes(out)).toBeLessThanOrEqual(51);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('splitText', () => {
  it('returns text that fits as one part', () => {
    expect(splitText('short', 10)).toEqual(['short']);
    expect(splitText('', 10)).toEqual([]);
  });

  it('breaks between paragraphs first, and loses nothing', () => {
    const text = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)].join('\n\n');
    expect(splitText(text, 90)).toEqual([`${'a'.repeat(40)}\n\n${'b'.repeat(40)}`, 'c'.repeat(40)]);
  });

  it('breaks at a sentence, then a word, inside a long paragraph', () => {
    expect(splitText(`${'a'.repeat(70)}. ${'b'.repeat(20)} ${'c'.repeat(20)}`, 100))
      .toEqual([`${'a'.repeat(70)}.`, `${'b'.repeat(20)} ${'c'.repeat(20)}`]);
    const words = `${'word '.repeat(60)}`.trim();
    const parts = splitText(words, 100);
    expect(parts[0]).toBe(`${'word '.repeat(19)}word`);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(100);
    expect(parts.join(' ')).toBe(words);
  });

  it('hard-breaks a run with no boundary, without splitting a surrogate pair', () => {
    expect(splitText('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
    expect(splitText('😀'.repeat(5), 3)).toEqual(['😀', '😀', '😀', '😀', '😀']);
  });

  it('still moves forward when one character is wider than the limit', () => {
    expect(splitText('😀😀', 1)).toEqual(['😀', '😀']);
  });

  it('splits by any additive measure', () => {
    const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
    const parts = splitText('é'.repeat(100), 51, bytes);
    for (const part of parts) expect(bytes(part)).toBeLessThanOrEqual(51);
    expect(parts.join('')).toBe('é'.repeat(100));
  });
});
