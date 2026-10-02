import { describe, expect, it } from 'vitest';
import { FILL_OVER_CHARS, keyDelay, resolveTyping, stepTiming, type ActInput } from './act';
import { SETTLE_DEFAULT, SETTLE_STEP, SETTLE_TYPING } from './settle';

describe('resolveTyping', () => {
  it('types key by key by default, fills long text', () => {
    expect(resolveTyping('ada')).toBe('keys');
    expect(resolveTyping('x'.repeat(FILL_OVER_CHARS))).toBe('keys');
    expect(resolveTyping('x'.repeat(FILL_OVER_CHARS + 1))).toBe('fill');
  });

  it('honors an explicit choice', () => {
    expect(resolveTyping('ada', 'fill')).toBe('fill');
    expect(resolveTyping('x'.repeat(5_000), 'keys')).toBe('keys');
  });
});

describe('keyDelay', () => {
  it('paces short text like a person and speeds up for longer text', () => {
    expect(keyDelay(10)).toBe(30);
    expect(keyDelay(200)).toBe(8);
    expect(keyDelay(800)).toBe(0);
  });
});

describe('stepTiming', () => {
  const t = (kind: ActInput['kind']): ActInput => ({ kind });

  it('waits fully after typing when a press or click may need what it loaded', () => {
    expect(stepTiming([t('type'), t('press')], 0)).toBe(SETTLE_TYPING);
    expect(stepTiming([t('type'), t('click')], 0)).toBe(SETTLE_TYPING);
    expect(stepTiming([t('type')], 0)).toBe(SETTLE_TYPING);
  });

  it('moves quickly through a run of form fields', () => {
    expect(stepTiming([t('type'), t('type'), t('click')], 0)).toBe(SETTLE_STEP);
  });

  it('settles briefly between other steps and normally after the last', () => {
    expect(stepTiming([t('click'), t('type')], 0)).toBe(SETTLE_STEP);
    expect(stepTiming([t('type'), t('click')], 1)).toBe(SETTLE_DEFAULT);
  });
});
