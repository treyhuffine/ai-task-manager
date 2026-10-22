import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationChannelRecord } from '@/db/types';

const runAction = vi.hoisted(() => vi.fn());
vi.mock('@/lib/integrations/runtime', () => ({
  getIntegrationRuntime: async () => ({ runAction }),
  getIntegrationOwnerId: () => 'owner',
}));

const { TELEGRAM_MESSAGE_MAX, TELEGRAM_PART_GAP_MS, telegramAdapter, telegramLength, telegramMessages } = await import('./telegram');

const url = 'https://ri.example.com/?session=01a0';
const channel = { id: 'c1', kind: 'integration', providerId: 'telegram', connectionId: 'conn1', config: { chatId: 7 } } as unknown as NotificationChannelRecord;
const longBody = Array.from({ length: 120 }, (_, i) => `Step ${i} done, ${'and more '.repeat(5)}checked.`).join('\n\n');

let nextId = 0;
beforeEach(() => {
  vi.useFakeTimers();
  runAction.mockReset();
  runAction.mockImplementation(async () => ({ ok: true, result: { messageId: ++nextId } }));
});
afterEach(() => {
  vi.useRealTimers();
});

const sentTexts = () => runAction.mock.calls.map((call) => (call[1] as { text: string }).text);

async function deliver(body: string, title = '✅ Fix auth') {
  const delivery = telegramAdapter.deliver(channel, { title, body, url });
  await vi.runAllTimersAsync();
  return delivery;
}

describe('telegramMessages', () => {
  it('sets the title, body and link apart in one message when it fits', () => {
    expect(telegramMessages({ title: '✅ Fix auth', body: 'Done.\n\n• One', url })).toEqual([`✅ Fix auth\n\nDone.\n\n• One\n\n${url}`]);
    expect(telegramMessages({ title: '✅ Fix auth', body: 'Done.', url: '' })).toEqual(['✅ Fix auth\n\nDone.']);
  });

  it('counts cautiously: every UTF-8 byte, and each line break twice', () => {
    expect(telegramLength('abc')).toBe(3);
    expect(telegramLength('é😀')).toBe(6);
    expect(telegramLength('a\nb')).toBe(4);
  });

  it('splits a long reply between paragraphs into messages that each fit, losing nothing', () => {
    const messages = telegramMessages({ title: '✅ Fix auth', body: longBody, url });
    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) expect(telegramLength(message)).toBeLessThanOrEqual(TELEGRAM_MESSAGE_MAX);
    expect(messages[0]!.startsWith('✅ Fix auth\n\nStep 0 done')).toBe(true);
    expect(messages.at(-1)!.endsWith(`Step 119 done, ${'and more '.repeat(5)}checked.\n\n${url}`)).toBe(true);
    for (const message of messages.slice(0, -1)) expect(message.endsWith('checked.')).toBe(true);
    expect(messages.join('\n\n')).toBe(`✅ Fix auth\n\n${longBody}\n\n${url}`);
  });

  it('splits text that isn’t ASCII by its bytes', () => {
    const body = '日本語の文章です。'.repeat(400);
    const messages = telegramMessages({ title: '✅ 修正', body, url });
    for (const message of messages) expect(telegramLength(message)).toBeLessThanOrEqual(TELEGRAM_MESSAGE_MAX);
    expect(messages.length).toBeGreaterThan(1);
    // Breaks only drop the whitespace they fall on.
    expect(messages.join('').replace(/\s/g, '')).toBe(`✅ 修正${body}${url}`.replace(/\s/g, ''));
  });
});

describe('telegramAdapter.deliver', () => {
  it('sends a short notification as one message to the channel’s chat', async () => {
    expect(await deliver('All green.')).toEqual({ providerMessageId: String(nextId) });
    expect(runAction).toHaveBeenCalledTimes(1);
    const [action, input, options] = runAction.mock.calls[0]!;
    expect(action).toBe('telegram.send_message');
    expect(input).toEqual({ chatId: 7, text: `✅ Fix auth\n\nAll green.\n\n${url}` });
    expect(options).toMatchObject({ ownerId: 'owner', connectionId: 'conn1' });
  });

  it('sends a long reply whole, as messages in order a second apart', async () => {
    const times: number[] = [];
    runAction.mockImplementation(async () => {
      times.push(Date.now());
      return { ok: true, result: { messageId: ++nextId } };
    });
    const first = nextId + 1;
    expect(await deliver(longBody)).toEqual({ providerMessageId: String(first) });
    expect(sentTexts()).toEqual(telegramMessages({ title: '✅ Fix auth', body: longBody, url }));
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(TELEGRAM_PART_GAP_MS);
  });

  it('waits and sends a part again when Telegram says it came too fast', async () => {
    runAction
      .mockImplementationOnce(async () => ({ ok: true, result: { messageId: 1 } }))
      .mockImplementationOnce(async () => ({ ok: false, reason: 'error', code: 'provider_rate_limited', message: 'provider error 429' }));
    await deliver(longBody);
    const texts = sentTexts();
    expect(texts[1]).toBe(texts[2]);
    expect(texts.slice(2)).toEqual(telegramMessages({ title: '✅ Fix auth', body: longBody, url }).slice(1));
  });

  it('says how far it got when a part fails', async () => {
    runAction
      .mockImplementationOnce(async () => ({ ok: true, result: { messageId: 1 } }))
      .mockImplementationOnce(async () => ({ ok: false, reason: 'error', code: 'provider_error', message: 'provider error 400' }));
    const delivery = telegramAdapter.deliver(channel, { title: '✅ Fix auth', body: longBody, url });
    const failed = expect(delivery).rejects.toThrow(/telegram delivery failed \(error\): provider error 400 after 1 of \d+ parts/);
    await vi.runAllTimersAsync();
    await failed;
  });

  it('never interleaves two notifications to the same chat', async () => {
    const a = telegramAdapter.deliver(channel, { title: 'A', body: longBody, url });
    const b = telegramAdapter.deliver(channel, { title: 'B', body: 'Short.', url });
    await vi.runAllTimersAsync();
    await Promise.all([a, b]);
    const texts = sentTexts();
    expect(texts.at(-1)).toBe(`B\n\nShort.\n\n${url}`);
    expect(texts.slice(0, -1)).toEqual(telegramMessages({ title: 'A', body: longBody, url }));
  });
});
