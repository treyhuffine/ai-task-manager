import { describe, expect, it } from 'vitest';
import { agentMessagePresentation, chatMessagePreview, decodeChatMessageReceipt, CHAT_MESSAGE_SENT, AGENT_REQUEST_REPLY_INSTRUCTIONS, AGENT_RESPONSE_INSTRUCTIONS } from './chat-message';

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
