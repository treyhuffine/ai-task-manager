import { afterEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';

/**
 * The home's default harness, model and effort is a choice (docs/default-selection.md).
 * It used to follow whatever chat was typed in last: replying in an older chat
 * on another model quietly moved what every new chat, execution and
 * background call started on. Now only Settings, Models, first-run setup and
 * a model menu's "Make default" change it.
 */
describe('the default selection', () => {
  let home: TestHome | null = null;
  let fake: FakeHarness | null = null;

  afterEach(async () => {
    const { _resetExecutorState } = await import('@/lib/executor/adapter');
    _resetExecutorState();
    fake?.restore();
    fake = null;
    await home?.cleanup();
    home = null;
  });

  it('stays put when a message is sent in a chat on another model', async () => {
    home = await createTestHome();
    fake = installFakeHarness('claude');
    const q = await import('@/lib/db/queries');
    q.updateUserState({ defaultHarness: 'claude', defaultModel: 'opus', defaultEffort: 'high' });
    const chat = q.createChatSession({
      type: 'orchestration',
      harness: 'claude',
      model: 'haiku',
      effort: 'low',
      status: 'active',
      permissionMode: 'auto_all',
    });

    const { dispatch } = await import('@/lib/executor/adapter');
    await dispatch(chat.id, 'hello');

    expect(q.listChatEvents(chat.id).some((e) => e.source === 'agent')).toBe(true);
    expect(q.getUserState()).toMatchObject({ defaultHarness: 'claude', defaultModel: 'opus', defaultEffort: 'high' });
  });

  it('stays put when a new main chat starts on another harness', async () => {
    home = await createTestHome();
    const q = await import('@/lib/db/queries');
    q.updateUserState({ defaultHarness: 'claude', defaultModel: 'opus', defaultEffort: 'high' });
    const { startNewMainChat } = await import('@/lib/sessions/main-chat');
    const chat = await startNewMainChat(null, { providerId: 'codex' });

    expect(chat.harness).toBe('codex');
    expect(q.getUserState()).toMatchObject({ defaultHarness: 'claude', defaultModel: 'opus', defaultEffort: 'high' });
  });
});
