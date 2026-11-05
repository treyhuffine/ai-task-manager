import { describe, expect, it } from 'vitest';
import { agentMessagePresentation, chatMessagePreview, decodeChatMessageReceipt, returnedChatOf, CHAT_MESSAGE_SENT, AGENT_REQUEST_REPLY_INSTRUCTIONS, AGENT_RESPONSE_INSTRUCTIONS, AGENT_BLOCKED_INSTRUCTIONS } from './chat-message';

describe('messages between chats', () => {
  it('presents a generated question without its routing wrapper, preserving the actual assignment', () => {
    const body = 'Keep this exact text.\n\nRun the date tests before replying.';
    const text = `[Ri agent question. Request ID: request-1. Requesting chat: sender-1.]\n${body}\n\n${AGENT_REQUEST_REPLY_INSTRUCTIONS}`;
    expect(agentMessagePresentation(text, 'sender-1')).toEqual({ label: 'Request from', body, originalRequest: null });
  });

  it('hides a saved request footer even when the available-tool instructions have changed', () => {
    const savedFooter = 'Answer this request in your final response, or use reply_agent_request with this request ID. Earlier routing guidance for this chat.';
    const text = `[Ri agent question. Request ID: req. Requesting chat: sender.]\nPlease review the dates.\n\n${savedFooter}`;
    expect(agentMessagePresentation(text, 'sender')).toEqual({ label: 'Request from', body: 'Please review the dates.', originalRequest: null });
  });

  it('keeps an informational message distinct from a request and hides its saved control footer', () => {
    const text = '[Ri agent message. Request ID: req. Requesting chat: sender.]\nPlease include the date regression.\n\nThis is an informational message. Respond when useful.';
    expect(agentMessagePresentation(text, 'sender')).toEqual({ label: 'Message from', body: 'Please include the date regression.', originalRequest: null });
  });

  it('separates the returned answer from the original request using the actual sender', () => {
    const text = `[Ri agent request request-1: response.]\nRequest: Check the dates.\nResponding chat: responder-1\nAll date tests pass.\n\n${AGENT_RESPONSE_INSTRUCTIONS}`;
    expect(agentMessagePresentation(text, 'responder-1')).toEqual({ label: 'Reply from', body: 'All date tests pass.', originalRequest: 'Check the dates.' });
    expect(agentMessagePresentation(text, 'different-chat').originalRequest).toBeNull();
  });

  it('keeps ordinary message contents intact, including instruction-like text in the body', () => {
    const text = `A normal message.\n\n${AGENT_REQUEST_REPLY_INSTRUCTIONS}`;
    expect(agentMessagePresentation(text, 'sender-1').body).toBe(text);
  });

  it('bounds the sent preview and never copies the generated request instructions into it', () => {
    const text = `[Ri agent question. Request ID: req. Requesting chat: sender.]\n${'Line\n'.repeat(200)}\n\n${AGENT_REQUEST_REPLY_INSTRUCTIONS}`;
    const preview = chatMessagePreview(text, 'sender');
    expect(preview).toHaveLength(240);
    expect(preview).not.toMatch(/\n|Request ID|final response/);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('only recognizes a valid app-owned receipt envelope', () => {
    const receipt = { version: 1, targetSessionId: 'target', targetEventId: 'event', preview: 'A short message' };
    const event = { source: 'system', content: CHAT_MESSAGE_SENT, raw: { chatMessageSent: receipt } };
    expect(decodeChatMessageReceipt(event)).toEqual(receipt);
    expect(decodeChatMessageReceipt({ ...event, source: 'user' })).toBeNull();
    expect(decodeChatMessageReceipt({ ...event, raw: { chatMessageSent: { ...receipt, targetSessionId: null } } })).toBeNull();
    expect(decodeChatMessageReceipt({ ...event, raw: { chatMessageSent: { ...receipt, version: 2 } } })).toBeNull();
  });
});

describe('the chat a returned outcome came from', () => {
  const coordination = (agentCoordination: Record<string, unknown>, senderSessionId: string | null = 'responder') => ({ content: '[saved routing text]', senderSessionId, raw: { agentCoordination } });

  it('names the responding chat of an answer, with or without a linked task', () => {
    expect(returnedChatOf(coordination({ kind: 'answer', senderKind: 'agent', sourceSessionId: 'responder' }))).toEqual({ sessionId: 'responder', kind: 'answer' });
    // An answer the service returned for a run-less reply still names the chat that gave it.
    expect(returnedChatOf(coordination({ kind: 'answer', senderKind: 'system', sourceSessionId: 'responder' }, null))).toEqual({ sessionId: 'responder', kind: 'answer' });
  });

  it('offers a failed outcome too, but only when a chat produced it', () => {
    expect(returnedChatOf(coordination({ kind: 'failed', senderKind: 'system', sourceSessionId: 'responder' }, null))).toEqual({ sessionId: 'responder', kind: 'failed' });
    // Work that never started has no chat to archive.
    expect(returnedChatOf(coordination({ kind: 'failed', senderKind: 'system', sourceSessionId: null }, null))).toBeNull();
  });

  it.each(['blocked', 'cancelled', 'request', 'message'])('is not a result: %s', kind => {
    expect(returnedChatOf(coordination({ kind, senderKind: 'agent', sourceSessionId: 'responder' }))).toBeNull();
  });

  it('never offers a message the person shared themselves', () => {
    expect(returnedChatOf(coordination({ kind: 'answer', senderKind: 'human', sourceSessionId: 'responder' }))).toBeNull();
  });

  it('reads an older saved response by its authenticated sender', () => {
    const answer = `[Ri agent request request-1: response.]\nRequest: Check the dates.\nResponding chat: responder-1\nAll date tests pass.\n\n${AGENT_RESPONSE_INSTRUCTIONS}`;
    expect(returnedChatOf({ content: answer, senderSessionId: 'responder-1' })).toEqual({ sessionId: 'responder-1', kind: 'answer' });
    expect(returnedChatOf({ content: answer.replace(': response.]', ': failed.]'), senderSessionId: 'responder-1' })).toEqual({ sessionId: 'responder-1', kind: 'failed' });
    const blocked = `[Ri agent request request-1: blocked.]\nRequest: Check the dates.\nResponding chat: responder-1\nWaiting on a permission.\n\n${AGENT_BLOCKED_INSTRUCTIONS}`;
    expect(returnedChatOf({ content: blocked, senderSessionId: 'responder-1' })).toBeNull();
  });

  it('trusts no chat id that only the text claims', () => {
    // The person typed something shaped like a result: no sender, no metadata.
    expect(returnedChatOf({ content: '[Ri agent request x: response.]\nRequest: r\nResponding chat: victim\nDone.', senderSessionId: null })).toBeNull();
  });
});
