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
   * A home had Claude · Fable · Extra high as its default for new work and
   * Opus · Medium as Claude's own default. Settings showed Claude's own, so it
   * read as Opus while every new chat started on Fable. They're two settings
   * now: new work follows the first, and saving the second never moves it.
   */
  it("starts new work on the default for new work, not the harness's own default", async () => {
    home = await createTestHome();
    const q = await import('@/lib/db/queries');
    q.ensureHarnessSettings('claude');
    q.setHarnessDefaultSelection('claude', { model: 'opus', effort: 'medium' });
    q.setHomeDefaultSelection({ harness: 'claude', model: 'fable', variant: null, effort: 'xhigh' });
    const { startNewMainChat } = await import('@/lib/sessions/main-chat');
    const { resolveStartSelection } = await import('@/lib/harness/start-selection');

    expect(await startNewMainChat(null, {})).toMatchObject({ harness: 'claude', model: 'fable', effort: 'xhigh' });
    // Naming the default's harness without a model is the same as naming nothing.
    expect(await resolveStartSelection({ providerId: 'claude' })).toMatchObject({ model: 'fable', effort: 'xhigh' });
    // Naming a model keeps the default's effort, which the model offers.
    expect(await resolveStartSelection({ providerId: 'claude', model: 'opus' })).toMatchObject({ model: 'opus', effort: 'xhigh' });

    q.setHarnessDefaultSelection('claude', { model: 'sonnet', effort: 'low' });
    expect(q.getUserState()).toMatchObject({ defaultHarness: 'claude', defaultModel: 'fable', defaultEffort: 'xhigh' });
  });

  it("starts another harness on that harness's own default", async () => {
    home = await createTestHome();
    const q = await import('@/lib/db/queries');
    q.setHomeDefaultSelection({ harness: 'claude', model: 'fable', variant: null, effort: 'xhigh' });
    const codex = q.ensureHarnessSettings('codex');
    const { resolveStartSelection } = await import('@/lib/harness/start-selection');

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
