import { describe, expect, it } from 'vitest';
import { routeAgentChat } from './agent-chat-routing';

/** Where a chat opened from an agent's view goes (docs/agents-view-spec.md, "Chats beside the agent"). */
const base = {
  chatId: 'exec-chat',
  mainChatId: 'main-chat',
  place: 'beside' as const,
  narrow: false,
  canKeepBeside: true,
  wantsWorkbench: false,
};

describe('routeAgentChat', () => {
  it('opens a chat beside the main chat by default', () => {
    expect(routeAgentChat(base)).toBe('beside');
  });

  it('leaves the agent’s own main chat where it is', () => {
    expect(routeAgentChat({ ...base, chatId: 'main-chat' })).toBe('here');
    expect(routeAgentChat({ ...base, chatId: 'main-chat', narrow: true })).toBe('here');
  });

  it('opens the full view where two panes do not fit, or when set to', () => {
    expect(routeAgentChat({ ...base, narrow: true })).toBe('full');
    expect(routeAgentChat({ ...base, place: 'full' })).toBe('full');
  });

  it('opens the full view where the view cannot keep a chat beside', () => {
    expect(routeAgentChat({ ...base, canKeepBeside: false })).toBe('full');
  });

  it('opens the full view when the opener asked for one of its tools', () => {
    expect(routeAgentChat({ ...base, wantsWorkbench: true })).toBe('full');
  });

  it('treats an unknown main chat as some other chat', () => {
    expect(routeAgentChat({ ...base, mainChatId: null })).toBe('beside');
  });
});
