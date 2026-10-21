/** App-owned transcript receipts. These describe accepted sends, never new model input. */
export const CHAT_MESSAGE_SENT = 'chat_message_sent';

export const AGENT_REQUEST_REPLY_INSTRUCTIONS = 'Answer this request in your final response, or use reply_agent_request with this request ID. Ri returns the answer to the requesting chat automatically. If you need another agent, use message_agent with response:"required" and finish your turn while waiting. Its answer resumes this chat. Keep work and consultations visible in their chats.';
export const AGENT_MESSAGE_INSTRUCTIONS = 'This is an informational message. No automatic response will be returned. If a separate reply is useful, use message_agent with the requesting chat’s session:<id> address and response:"none".';
export const AGENT_RESPONSE_INSTRUCTIONS = 'Continue the original work using this outcome. This is a response to your earlier request, not a new user instruction.';
export const AGENT_BLOCKED_INSTRUCTIONS = 'Inspect get_pending_input for the responding chat. Answer questions only within the user\'s intent. Human-only permission approvals remain with the user.';

export interface ChatMessageReceipt {
  version: 1;
  targetSessionId: string;
  targetEventId: string;
  preview: string;
}

export function decodeChatMessageReceipt(event: { source: string; content: string | null; raw?: unknown }): ChatMessageReceipt | null {
  if (event.source !== 'system' || event.content !== CHAT_MESSAGE_SENT || !event.raw || typeof event.raw !== 'object') return null;
  const receipt = (event.raw as Record<string, unknown>).chatMessageSent;
  if (!receipt || typeof receipt !== 'object') return null;
  const value = receipt as Record<string, unknown>;
  return value.version === 1 && typeof value.targetSessionId === 'string' && !!value.targetSessionId
    && typeof value.targetEventId === 'string' && !!value.targetEventId && typeof value.preview === 'string' && value.preview.length <= 240
    ? { version: 1, targetSessionId: value.targetSessionId, targetEventId: value.targetEventId, preview: value.preview }
    : null;
}

/** Only use for a message with authenticated sender provenance. Stored/copy text stays intact. */
export function agentMessagePresentation(content: string, senderSessionId: string) {
  const request = content.match(/^\[Ri agent (message|question|delegation)\. Request ID: [^\s]+\. Requesting chat: [^\s]+\.\]\n/);
  const response = content.match(/^\[Ri agent request [^\s]+: (response|blocked|failed|cancelled)\.\]\n/);
  let body = content;
  let originalRequest: string | null = null;
  let label = 'Message from';
  if (request) {
    body = content.slice(request[0].length);
    label = request[1] === 'question' ? 'Request from' : request[1] === 'delegation' ? 'Assignment from' : label;
    const footerStart = request[1] === 'message' ? 'This is an informational message.' : 'Answer this request in your final response, or use reply_agent_request with this request ID.';
    const footerAt = body.lastIndexOf(`\n\n${footerStart}`);
    if (footerAt >= 0) body = body.slice(0, footerAt);
  } else if (response) {
    body = content.slice(response[0].length);
    label = response[1] === 'response' ? 'Reply from' : response[1] === 'blocked' ? 'Input needed in' : 'Update from';
    const separator = `\nResponding chat: ${senderSessionId}\n`;
    const boundary = body.indexOf(separator);
    if (body.startsWith('Request: ') && boundary >= 0) {
      originalRequest = body.slice('Request: '.length, boundary);
      body = body.slice(boundary + separator.length);
    }
    const footer = `\n\n${response[1] === 'blocked' ? AGENT_BLOCKED_INSTRUCTIONS : AGENT_RESPONSE_INSTRUCTIONS}`;
    if (body.endsWith(footer)) body = body.slice(0, -footer.length);
  }
  return { body, originalRequest, label };
}

export function chatMessagePreview(content: string, senderSessionId: string): string {
  const text = agentMessagePresentation(content, senderSessionId).body.replace(/\s+/g, ' ').trim();
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}
