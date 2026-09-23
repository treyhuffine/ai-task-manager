import { describe, expect, it } from 'vitest';
import { composeHeartbeatPrompt, HEARTBEAT_GROUND_RULES, isQuietReply } from './prompt';
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
