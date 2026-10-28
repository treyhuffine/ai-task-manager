import { describe, expect, it } from 'vitest';
import { CHECK_IN_MESSAGE, canScheduleChat, chatScheduleInput } from './chat-schedule';

const chat = {
  id: 'chat-1', label: 'Backfill the search index', type: 'execution' as const, status: 'active' as const,
  surfaceKind: null, externalSessionId: null, workspaceId: 'agent-1', harness: 'codex' as const,
  model: 'gpt-5.5', effort: 'high' as const,
};
const hourly = { schedule: { kind: 'every' as const, cronExpression: null, intervalSeconds: 3600 }, timezone: 'America/Denver' };

describe('chatScheduleInput', () => {
  it('sends each run into the same chat by default, on the chat\'s own engine', () => {
    expect(chatScheduleInput(chat, { ...hourly, prompt: CHECK_IN_MESSAGE, freshChat: false })).toEqual({
      name: 'Check in: Backfill the search index', prompt: CHECK_IN_MESSAGE,
      targetKind: 'session', targetSessionId: 'chat-1',
      kind: 'every', cronExpression: null, intervalSeconds: 3600, runAt: null, timezone: 'America/Denver',
    });
  });

  it('starts a fresh chat in the chat\'s agent each time when asked, on its provider and model', () => {
    expect(chatScheduleInput(chat, { ...hourly, prompt: 'Summarize what changed today.\nKeep it short.', freshChat: true })).toMatchObject({
      name: 'Summarize what changed today.', targetKind: 'workspace', workspaceId: 'agent-1',
      provider: 'codex', model: 'gpt-5.5', effort: 'high',
    });
  });

  it('starts a fresh Ri chat for a chat with no agent', () => {
    const input = chatScheduleInput({ ...chat, type: 'orchestration', workspaceId: null }, { ...hourly, prompt: 'Plan my day', freshChat: true });
    expect(input).toMatchObject({ targetKind: 'orchestrator' });
    expect(input).not.toHaveProperty('workspaceId');
  });

  it('keeps names short', () => {
    const long = chatScheduleInput({ ...chat, label: 'x'.repeat(100) }, { ...hourly, prompt: 'p', freshChat: false });
    expect(long.name.length).toBeLessThanOrEqual(60);
  });
});

describe('canScheduleChat', () => {
  it('takes active chats a schedule can send into', () => {
    expect(canScheduleChat(chat)).toBe(true);
    expect(canScheduleChat({ ...chat, status: 'archived' })).toBe(false);
    expect(canScheduleChat({ ...chat, type: 'content' })).toBe(false);
    expect(canScheduleChat({ ...chat, surfaceKind: 'team_chat' })).toBe(false);
    expect(canScheduleChat({ ...chat, surfaceKind: 'result_review' })).toBe(false);
    expect(canScheduleChat({ ...chat, surfaceKind: 'imported_agent' })).toBe(false);
    expect(canScheduleChat({ ...chat, surfaceKind: 'imported_agent', externalSessionId: 'taken-over' })).toBe(true);
  });
});
