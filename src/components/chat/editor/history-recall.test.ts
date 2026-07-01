import { describe, it, expect } from 'vitest';
import {
  buildRecallHistory,
  cleanRecalledText,
  recallStep,
  textToDocJSON,
  HISTORY_RECALL_LIMIT,
  type RecallHistoryEvent,
} from './history-recall';

// Terse helper so the fixtures below read as a transcript.
function ev(
  role: string,
  source: string,
  content: string | null,
): RecallHistoryEvent {
  return { role, source, content };
}

describe('cleanRecalledText', () => {
  it('drops file markers but keeps the surrounding prose', () => {
    expect(cleanRecalledText('look at [[file:0193.png]] please')).toBe(
      'look at  please',
    );
  });

  it('strips task / note / scratchpad markers too', () => {
    expect(
      cleanRecalledText('follow up on [[task:abc]] and [[note:def]] [[scratchpad]]'),
    ).toBe('follow up on  and');
  });

  it('trims whitespace a leading marker leaves behind', () => {
    expect(cleanRecalledText('[[file:x.txt]]\nreview this')).toBe('review this');
  });

  it('returns empty for a message that was only an attachment', () => {
    expect(cleanRecalledText('[[file:x.txt]]')).toBe('');
  });

  it('passes plain prose through untouched', () => {
    expect(cleanRecalledText('just some text')).toBe('just some text');
  });
});

describe('buildRecallHistory', () => {
  it('keeps only the user\'s own sent messages, oldest → newest', () => {
    const events = [
      ev('user', 'user', 'first'),
      ev('assistant', 'agent', 'a reply'),
      ev('user', 'user', 'second'),
      ev('user', 'thinking', 'not a real send'),
    ];
    expect(buildRecallHistory(events)).toEqual(['first', 'second']);
  });

  it('collapses consecutive duplicates (ignoredups)', () => {
    const events = [
      ev('user', 'user', 'ping'),
      ev('user', 'user', 'ping'),
      ev('user', 'user', 'pong'),
      ev('user', 'user', 'ping'),
    ];
    // Non-adjacent repeats are kept — only back-to-back ones collapse.
    expect(buildRecallHistory(events)).toEqual(['ping', 'pong', 'ping']);
  });

  it('drops messages that clean to empty text', () => {
    const events = [
      ev('user', 'user', '[[file:x.txt]]'),
      ev('user', 'user', 'real message'),
    ];
    expect(buildRecallHistory(events)).toEqual(['real message']);
  });

  it('caps to the most recent N entries', () => {
    const events = Array.from({ length: HISTORY_RECALL_LIMIT + 5 }, (_, i) =>
      ev('user', 'user', `msg ${i}`),
    );
    const history = buildRecallHistory(events);
    expect(history).toHaveLength(HISTORY_RECALL_LIMIT);
    // The newest survive; the oldest 5 are dropped.
    expect(history[0]).toBe('msg 5');
    expect(history.at(-1)).toBe(`msg ${HISTORY_RECALL_LIMIT + 4}`);
  });

  it('is empty when there are no user messages', () => {
    expect(buildRecallHistory([ev('assistant', 'agent', 'hi')])).toEqual([]);
  });
});

describe('recallStep', () => {
  const HISTORY = ['a', 'b', 'c']; // oldest 'a' … newest 'c'
  const len = HISTORY.length;

  it('first Up stashes the draft and jumps to the newest entry', () => {
    expect(recallStep(null, len, 'prev')).toEqual({ nextIndex: 2, captureStash: true });
  });

  it('further Up walks toward the oldest without re-stashing', () => {
    expect(recallStep(2, len, 'prev')).toEqual({ nextIndex: 1, captureStash: false });
    expect(recallStep(1, len, 'prev')).toEqual({ nextIndex: 0, captureStash: false });
  });

  it('Up at the oldest entry is inert so the caret rests on the first line', () => {
    // Returning a step here would reload the oldest message and re-focus to
    // its end, bouncing the caret off the top line ("wrap and keep going").
    expect(recallStep(0, len, 'prev')).toBeNull();
  });

  it('Down walks back toward the newest', () => {
    expect(recallStep(0, len, 'next')).toEqual({ nextIndex: 1, captureStash: false });
    expect(recallStep(1, len, 'next')).toEqual({ nextIndex: 2, captureStash: false });
  });

  it('Down past the newest restores the stashed draft (leaves history)', () => {
    expect(recallStep(2, len, 'next')).toEqual({ nextIndex: null, captureStash: false });
  });

  it('Up with an empty ring falls through to default caret motion', () => {
    expect(recallStep(null, 0, 'prev')).toBeNull();
  });

  it('Down while not navigating falls through to default caret motion', () => {
    expect(recallStep(null, len, 'next')).toBeNull();
  });

  it('Up into a single-entry ring lands on it, then further Up is inert', () => {
    expect(recallStep(null, 1, 'prev')).toEqual({ nextIndex: 0, captureStash: true });
    // Second Up sits at the oldest (== only) entry — no reload.
    expect(recallStep(0, 1, 'prev')).toBeNull();
  });

  it('Down leaves a single-entry ring back to the draft', () => {
    expect(recallStep(0, 1, 'next')).toEqual({ nextIndex: null, captureStash: false });
  });
});

describe('textToDocJSON', () => {
  it('wraps a single line in one paragraph', () => {
    expect(textToDocJSON('hello world')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }],
    });
  });

  it('rebuilds newlines as hardBreak nodes within one paragraph', () => {
    expect(textToDocJSON('line one\nline two')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'line one' },
            { type: 'hardBreak' },
            { type: 'text', text: 'line two' },
          ],
        },
      ],
    });
  });

  it('represents a blank line as a lone hardBreak (no empty text node)', () => {
    expect(textToDocJSON('a\n\nb')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'hardBreak' },
            { type: 'hardBreak' },
            { type: 'text', text: 'b' },
          ],
        },
      ],
    });
  });

  it('produces an empty paragraph for an empty string', () => {
    expect(textToDocJSON('')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
  });
});
