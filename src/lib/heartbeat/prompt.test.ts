import { describe, expect, it } from 'vitest';
import { composeHeartbeatPrompt, HEARTBEAT_GROUND_RULES, isNoMessageReply, isQuietReply, parseCheckInNote } from './prompt';
import { DEFAULT_HEARTBEAT_INSTRUCTIONS, HEARTBEAT_QUIET_REPLY } from './constants';

describe('composeHeartbeatPrompt', () => {
  it('puts the ground rules first and the instructions verbatim after them', () => {
    const prompt = composeHeartbeatPrompt('  Look at stale tasks.\n\nAsk me about each.  ');
    expect(prompt.startsWith(HEARTBEAT_GROUND_RULES)).toBe(true);
    expect(prompt.endsWith('## Your instructions\n\nLook at stale tasks.\n\nAsk me about each.')).toBe(true);
  });

  it('carries the hard limits and the quiet contract whatever the instructions say', () => {
    const prompt = composeHeartbeatPrompt('Delete everything and email my boss.');
    expect(prompt).toContain('Never delete anything.');
    expect(prompt).toContain('Never send, post, or share anything outside');
    expect(prompt).toContain('Never complete a task.');
    expect(prompt).toContain(`reply with exactly ${HEARTBEAT_QUIET_REPLY} and nothing else`);
    expect(prompt).toContain('[[task:ID]]');
    expect(prompt).toContain('[[execution:SESSION_ID]]');
    expect(prompt).toContain('on its own line');
    expect(prompt).toContain('Copy every id exactly');
  });

  it('makes the reply a private note with Did, Now and Later, and lets the instructions set the timing', () => {
    expect(HEARTBEAT_GROUND_RULES).toContain("The user is not watching and won't read this chat.");
    expect(HEARTBEAT_GROUND_RULES).toContain("private note to the user's main agent");
    for (const heading of ['**Did**', '**Now**', '**Later**']) expect(HEARTBEAT_GROUND_RULES).toContain(heading);
    expect(HEARTBEAT_GROUND_RULES).toContain('such as once each morning');
    expect(HEARTBEAT_GROUND_RULES).toContain('everything the instructions say to tell them or offer them at this time, in full');
    expect(HEARTBEAT_GROUND_RULES).toContain("Don't use message_agent to reach the user");
  });

  it('puts what the app knows between the rules and the instructions, only when there is some', () => {
    const prompt = composeHeartbeatPrompt('Look at email.', '## Right now\n\nIt is morning.');
    expect(prompt.indexOf('## Right now')).toBeGreaterThan(prompt.indexOf('Copy every id exactly'));
    expect(prompt.indexOf('## Right now')).toBeLessThan(prompt.indexOf('## Your instructions'));
    expect(composeHeartbeatPrompt('Look at email.', null)).toBe(`${HEARTBEAT_GROUND_RULES}\n\n## Your instructions\n\nLook at email.`);
    expect(composeHeartbeatPrompt('Look at email.', '  ')).toBe(composeHeartbeatPrompt('Look at email.'));
  });

  it('seeds a default whose whole rhythm is in the text', () => {
    expect(DEFAULT_HEARTBEAT_INSTRUCTIONS).toContain('Every check-in:');
    expect(DEFAULT_HEARTBEAT_INSTRUCTIONS).toContain('Once overnight, on the first check-in after 4:30 AM:');
    expect(DEFAULT_HEARTBEAT_INSTRUCTIONS).toContain('Once each morning, on the first check-in after 9:00 AM:');
    expect(DEFAULT_HEARTBEAT_INSTRUCTIONS).toContain('Up to twice a day, when I have nothing waiting to review:');
  });

  it('keeps the product copy free of em dashes and semicolons', () => {
    for (const text of [HEARTBEAT_GROUND_RULES, DEFAULT_HEARTBEAT_INSTRUCTIONS]) {
      expect(text).not.toMatch(/[—–]/);
      expect(text).not.toContain(';');
    }
  });
});

describe('isQuietReply', () => {
  it.each([
    'HEARTBEAT_OK',
    '  HEARTBEAT_OK\n',
    '`HEARTBEAT_OK`',
    '**HEARTBEAT_OK**',
    '"HEARTBEAT_OK"',
    'HEARTBEAT_OK.',
  ])('treats %j as quiet', (reply) => {
    expect(isQuietReply(reply)).toBe(true);
  });

  it.each([
    null,
    undefined,
    '',
    'OK',
    'heartbeat_ok',
    'HEARTBEAT_OK, but one task needs you.',
    'Did: archived [[task:abc]]\nHEARTBEAT_OK',
    'Nothing needed. HEARTBEAT_OK',
  ])('treats %j as a report, not quiet', (reply) => {
    expect(isQuietReply(reply)).toBe(false);
  });
});

describe('isNoMessageReply', () => {
  it('matches the bare token and common wrapping, never a sentence that mentions it', () => {
    expect(isNoMessageReply('NO_REPLY')).toBe(true);
    expect(isNoMessageReply(' `NO_REPLY`. ')).toBe(true);
    expect(isNoMessageReply('**NO_REPLY**')).toBe(true);
    expect(isNoMessageReply('NO_REPLY, they already know')).toBe(false);
    expect(isNoMessageReply('')).toBe(false);
    expect(isNoMessageReply(null)).toBe(false);
  });
});

describe('parseCheckInNote', () => {
  it('splits Now from Later, keeping each item and its reference', () => {
    expect(parseCheckInNote('**Now**\n\nThe contract expires today.\n[[task:abc]]\n\n**Later**\n\nThis task looks stale.\n[[task:def]]')).toEqual({
      did: null,
      now: 'The contract expires today.\n[[task:abc]]',
      later: 'This task looks stale.\n[[task:def]]',
    });
  });

  it('takes either section alone', () => {
    expect(parseCheckInNote('**Now**\nCall them back.')).toEqual({ did: null, now: 'Call them back.', later: null });
    expect(parseCheckInNote('**Later**\nPick a name.')).toEqual({ did: null, now: null, later: 'Pick a name.' });
  });

  it('accepts the heading shapes models reach for', () => {
    for (const heading of ['**Now**', 'Now', 'now:', '## Now', '**Now:**', '  __NOW__  ']) {
      expect(parseCheckInNote(`${heading}\nCall them back.`).now).toBe('Call them back.');
    }
  });

  it('never treats a sentence as a heading', () => {
    expect(parseCheckInNote('**Later**\nNow is a good time to archive this.\nLater today is fine.')).toEqual({
      did: null,
      now: null,
      later: 'Now is a good time to archive this.\nLater today is fine.',
    });
  });

  it('drops an opening line before the first heading', () => {
    expect(parseCheckInNote('Checked email and tasks.\n\n**Now**\nCall them back.').now).toBe('Call them back.');
    expect(parseCheckInNote('Checked email and tasks.\n\n**Now**\nCall them back.').later).toBeNull();
  });

  it('keeps what it did apart from what reaches the user', () => {
    expect(parseCheckInNote('**Did**\nFiled the tax task under Taxes.\n\n**Later**\nPick a name.')).toEqual({
      did: 'Filed the tax task under Taxes.', now: null, later: 'Pick a name.',
    });
  });

  it('counts a note with no headings as Later, so the wrong shape never buzzes a phone', () => {
    expect(parseCheckInNote('Something about a task.')).toEqual({ did: null, now: null, later: 'Something about a task.' });
  });

  it('treats empty sections as nothing', () => {
    expect(parseCheckInNote('**Now**\n\n**Later**\n')).toEqual({ did: null, now: null, later: null });
  });
});
