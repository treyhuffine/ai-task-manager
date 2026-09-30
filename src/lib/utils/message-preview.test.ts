import { describe, expect, it } from 'vitest';
import { messagePreview } from './message-preview';

describe('messagePreview', () => {
  it('flattens the message like a chat list, keeping a lead-in with what follows', () => {
    expect(messagePreview("I don't have that tool, so I'm asking here instead:\n\n**Email links or passwords?**")).toBe(
      "I don't have that tool, so I'm asking here instead: Email links or passwords?",
    );
    expect(messagePreview('## Done\n\nThe login page is in.')).toBe('Done · The login page is in.');
    expect(messagePreview('Two things.\n- Tests pass\n- Deployed')).toBe('Two things. Tests pass · Deployed');
  });

  it('strips markdown a reader would not see', () => {
    expect(messagePreview('- **Login** is [ready](http://x) with `npm test` green')).toBe('Login is ready with npm test green');
    expect(messagePreview('> *Heads up*: the build is slow')).toBe('Heads up: the build is slow');
    expect(messagePreview('1. First step')).toBe('First step');
  });

  it('skips code blocks, rules and tables', () => {
    expect(messagePreview('```ts\nconst a = 1;\n```\nPushed the fix.')).toBe('Pushed the fix.');
    expect(messagePreview('---\n| a | b |\n|---|---|\nSummary below')).toBe('Summary below');
    expect(messagePreview('```\nunterminated')).toBeNull();
  });

  it('keeps identifiers intact and names file markers', () => {
    expect(messagePreview('Renamed file_name to display_name')).toBe('Renamed file_name to display_name');
    expect(messagePreview('Here it is: [[file:01a0-x.png]]')).toBe('Here it is: a file');
  });

  it('truncates long messages and returns null for nothing to show', () => {
    const out = messagePreview('word '.repeat(60), 40)!;
    expect(out.length).toBe(40);
    expect(out.endsWith('…')).toBe(true);
    expect(messagePreview(`${'a'.repeat(30)}\n${'b'.repeat(30)}`, 40)!.length).toBe(40);
    for (const empty of [null, undefined, '', '   \n\n']) expect(messagePreview(empty)).toBeNull();
  });
});
