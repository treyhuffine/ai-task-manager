import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

const syncSessionTitle = vi.fn(async () => {});
vi.mock('@/lib/sessions/derive-label', () => ({ syncSessionTitle }));

let home: TestHome;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-title-signals-' });
  syncSessionTitle.mockClear();
});
afterEach(async () => {
  (await import('./remote-live'))._resetRemoteLive();
  await home.cleanup();
});

async function setup() {
  const q = await import('@/lib/db/queries');
  const chat = q.createChatSession({ harness: 'codex', type: 'content' });
  const { applyRunnerSignal } = await import('./apply');
  const { inTransaction } = await import('@/lib/effects/after-commit');
  const { replaceDeviceMirror } = await import('./remote-live');
  replaceDeviceMirror('title-device', { running: [], pending: [], backgroundTasks: {} }, 10);
  const apply = (signal: import('@/lib/runner/types').RunnerSignal, eventPosition = 5) => {
    inTransaction((after) => applyRunnerSignal(chat.id, signal, after, { deviceId: 'title-device', eventPosition }));
  };
  return { q, chat, apply };
}

describe('journaled title metadata', () => {
  it('adopts a native name even when a newer heartbeat has already arrived', async () => {
    const { q, chat, apply } = await setup();
    const { subscribe, sessionChannel } = await import('@/lib/realtime/bus');
    const events: string[] = [];
    const stop = subscribe(sessionChannel(chat.id), (message) => events.push(message.kind));
    try {
      apply({ type: 'native_title', title: 'Native client name' });
      expect(q.getChatSession(chat.id)).toMatchObject({ label: 'Native client name', labelSource: 'native', labelRevision: 1 });
      expect(events).toEqual(['title_changed']);
      expect(q.listChatEvents(chat.id)).toEqual([]);
      await vi.waitFor(() => expect(syncSessionTitle).toHaveBeenCalledWith(chat.id, { syncNative: false }));
    } finally { stop(); }
  });

  it('accepts a suggestion once by title revision rather than heartbeat position', async () => {
    const { q, chat, apply } = await setup();
    const signal = { type: 'title_suggestion' as const, title: 'Ri fallback', source: 'fallback' as const, expectedRevision: 0 };
    apply(signal);
    apply(signal);
    expect(q.getChatSession(chat.id)).toMatchObject({ label: 'Ri fallback', labelRevision: 1 });
    await vi.waitFor(() => expect(syncSessionTitle).toHaveBeenCalledOnce());
  });

  it.each(['User title', null])('retains a manual choice over late native names and suggestions: %s', async (label) => {
    const { q, chat, apply } = await setup();
    q.updateChatSession(chat.id, { label });
    apply({ type: 'native_title', title: 'Late native name' });
    apply({ type: 'title_suggestion', title: 'Late suggestion', source: 'fallback', expectedRevision: 0 });
    expect(q.getChatSession(chat.id)).toMatchObject({ label, labelSource: 'manual', labelRevision: 1 });
    expect(syncSessionTitle).not.toHaveBeenCalled();
  });
});
