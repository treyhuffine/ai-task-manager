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

  /**
   * A home had Claude · Fable · Extra high as its global default model and
   * Opus · Medium as Claude's own default. Settings showed Claude's own, so it
   * read as Opus while every new chat started on Fable. They're two settings
   * now: picking nothing starts on the global default, picking a harness starts
   * on that harness's own default, and saving one never moves the other.
   */
  it('starts what picks nothing on the global default model', async () => {
    home = await createTestHome();
    const q = await import('@/lib/db/queries');
    q.ensureHarnessSettings('claude');
    q.setHarnessDefaultSelection('claude', { model: 'opus', effort: 'medium' });
    q.setHomeDefaultSelection({ harness: 'claude', model: 'fable', variant: null, effort: 'xhigh' });
    const { startNewMainChat } = await import('@/lib/sessions/main-chat');
    const { resolveStartSelection } = await import('@/lib/harness/start-selection');

    expect(await startNewMainChat(null, {})).toMatchObject({ harness: 'claude', model: 'fable', effort: 'xhigh' });
    // A model named without a harness keeps the global default's harness and effort.
    expect(await resolveStartSelection({ model: 'opus' })).toMatchObject({ providerId: 'claude', model: 'opus', effort: 'xhigh' });

    q.setHarnessDefaultSelection('claude', { model: 'sonnet', effort: 'low' });
    expect(q.getUserState()).toMatchObject({ defaultHarness: 'claude', defaultModel: 'fable', defaultEffort: 'xhigh' });
  });

  it("starts a picked harness on that harness's own default, the global default's harness included", async () => {
    home = await createTestHome();
    const q = await import('@/lib/db/queries');
    q.ensureHarnessSettings('claude');
    q.setHarnessDefaultSelection('claude', { model: 'opus', effort: 'medium' });
    q.setHomeDefaultSelection({ harness: 'claude', model: 'fable', variant: null, effort: 'xhigh' });
    const codex = q.ensureHarnessSettings('codex');
    const { resolveStartSelection } = await import('@/lib/harness/start-selection');

    expect(await resolveStartSelection({ providerId: 'claude' })).toMatchObject({ model: 'opus', effort: 'medium' });
    const selection = await resolveStartSelection({ providerId: 'codex' });
    expect(selection.providerId).toBe('codex');
    expect(selection.model).toBe(codex.defaultModel);
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
