import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_CHAT_PLACE, parseAgentChatPlace } from './agent-chat-place';

/** Where a chat opened from an agent goes (docs/agents-view-spec.md, "Chats beside the agent"). */
describe('parseAgentChatPlace', () => {
  it('defaults to beside, and narrows anything unknown to the default', () => {
    expect(DEFAULT_AGENT_CHAT_PLACE).toBe('beside');
    expect(parseAgentChatPlace('full')).toBe('full');
    expect(parseAgentChatPlace('beside')).toBe('beside');
    for (const raw of [null, undefined, '', 'large', 42]) expect(parseAgentChatPlace(raw)).toBe('beside');
  });
});
