import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from './queries';
import { getRawDb } from '@/lib/db';
import { subscribe, sessionChannel } from '@/lib/realtime/bus';
import { toChatEventDTO } from '@/lib/api/dto/chat-event';
import { CHAT_MESSAGE_SENT, decodeChatMessageReceipt } from '@/lib/sessions/chat-message';

let home: TestHome;
let sender: ReturnType<typeof q.createChatSession>;
let target: ReturnType<typeof q.createChatSession>;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-chat-receipts-' });
  sender = q.createChatSession({ type: 'orchestration', harness: 'codex' });
  target = q.createChatSession({ type: 'orchestration', harness: 'claude' });
});
afterEach(async () => { await home.cleanup(); });

const send = () => q.insertChatEvent({ id: 'accepted-message', sessionId: target.id, senderSessionId: sender.id, source: 'user', role: 'user', content: 'Check the date boundary.' });
const receipts = () => q.listChatEvents(sender.id).filter(row => decodeChatMessageReceipt(row));

describe('automatic sent-message receipts', () => {
  it('saves the opposite chat and message with the accepted send, and retains it on the wire', () => {
    const received = send()!;
    const [sent] = receipts();
    expect(decodeChatMessageReceipt(toChatEventDTO(sent))).toEqual({ version: 1, targetSessionId: target.id, targetEventId: received.id, preview: 'Check the date boundary.' });
    expect(sent.createdAt).toBe(received.createdAt);
    expect(q.getChatSession(sender.id)?.lastOutcomeEventAt).toBeNull();
    expect(q.getChatEventById(received.id)?.content).toBe('Check the date boundary.');
  });

  it('deduplicates retries and never sends the receipt back as another user message', () => {
    send();
    expect(send()).toBeNull();
    expect(receipts()).toHaveLength(1);
    expect(q.listChatEvents(target.id)).toHaveLength(1);
    expect(receipts()[0]).toMatchObject({ source: 'system', role: 'system', senderSessionId: null });
  });

  it('commits both events before broadcasting either, and rolls back both if a receipt fails', () => {
    const transactions: boolean[] = [];
    const stop = subscribe(sessionChannel(target.id), () => transactions.push(getRawDb().inTransaction));
    try { send(); } finally { stop(); }
    expect(transactions).toEqual([false]);
    getRawDb().exec(`CREATE TEMP TRIGGER reject_receipt BEFORE INSERT ON chat_events WHEN NEW.content = '${CHAT_MESSAGE_SENT}' BEGIN SELECT RAISE(ABORT, 'receipt refused'); END`);
    expect(() => q.insertChatEvent({ id: 'rollback-message', sessionId: target.id, senderSessionId: sender.id, source: 'user', role: 'user', content: 'This must roll back.' })).toThrow('receipt refused');
    expect(q.getChatEventById('rollback-message')).toBeNull();
    expect(receipts()).toHaveLength(1);
  });

  it('keeps human sends and missing senders free of synthetic receipts', () => {
    q.insertChatEvent({ sessionId: target.id, role: 'user', source: 'user', content: 'A person wrote this.' });
    q.insertChatEvent({ sessionId: target.id, senderSessionId: 'deleted-chat', role: 'user', source: 'user', content: 'Historical sender.' });
    expect(receipts()).toHaveLength(0);
  });
});
