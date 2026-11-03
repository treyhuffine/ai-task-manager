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

  it('makes the reply a note to the main agent, with Now for what cannot wait and Later for the rest', () => {
    expect(HEARTBEAT_GROUND_RULES).toContain("The user is not watching and won't read this chat.");
    expect(HEARTBEAT_GROUND_RULES).toContain("private note to the user's main agent");
    expect(HEARTBEAT_GROUND_RULES).toContain('**Now**');
    expect(HEARTBEAT_GROUND_RULES).toContain('**Later**');
    expect(HEARTBEAT_GROUND_RULES).toContain("Don't use message_agent to reach the user");
  });

  it('puts what was already raised between the rules and the instructions, only when there is some', () => {
    const prompt = composeHeartbeatPrompt('Look at email.', 'Nov 3, 2:48 PM, told right away:\nGmail permission is missing.');
    expect(prompt.indexOf('## Already raised')).toBeGreaterThan(prompt.indexOf('Copy every id exactly'));
    expect(prompt.indexOf('## Already raised')).toBeLessThan(prompt.indexOf('## Your instructions'));
    expect(prompt).toContain("Don't raise them again unless something changed.");
    expect(prompt).toContain('Gmail permission is missing.');
    expect(composeHeartbeatPrompt('Look at email.', null)).not.toContain('## Already raised');
    expect(composeHeartbeatPrompt('Look at email.', '  ')).not.toContain('## Already raised');
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
      now: 'The contract expires today.\n[[task:abc]]',
      later: 'This task looks stale.\n[[task:def]]',
    });
  });

  it('takes either section alone', () => {
    expect(parseCheckInNote('**Now**\nCall them back.')).toEqual({ now: 'Call them back.', later: null });
    expect(parseCheckInNote('**Later**\nPick a name.')).toEqual({ now: null, later: 'Pick a name.' });
  });

  it('accepts the heading shapes models reach for', () => {
    for (const heading of ['**Now**', 'Now', 'now:', '## Now', '**Now:**', '  __NOW__  ']) {
      expect(parseCheckInNote(`${heading}\nCall them back.`).now).toBe('Call them back.');
    }
  });

  it('never treats a sentence as a heading', () => {
    expect(parseCheckInNote('**Later**\nNow is a good time to archive this.\nLater today is fine.')).toEqual({
      now: null,
      later: 'Now is a good time to archive this.\nLater today is fine.',
    });
  });

  it('drops an opening line before the first heading', () => {
    expect(parseCheckInNote('Checked email and tasks.\n\n**Now**\nCall them back.').now).toBe('Call them back.');
    expect(parseCheckInNote('Checked email and tasks.\n\n**Now**\nCall them back.').later).toBeNull();
  });

  it('counts a note with no headings as Later, so the wrong shape never buzzes a phone', () => {
    expect(parseCheckInNote('Something about a task.')).toEqual({ now: null, later: 'Something about a task.' });
  });

  it('treats empty sections as nothing', () => {
    expect(parseCheckInNote('**Now**\n\n**Later**\n')).toEqual({ now: null, later: null });
  });
});
