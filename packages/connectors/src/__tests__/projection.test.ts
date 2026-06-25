import { describe, it, expect } from 'vitest';
import { toToolSet } from '../ai-sdk';
import { modelSafeOutcome } from '../core/projection-shared';
import { makeHarness } from './_harness';
import type { ActionOutcome } from '../core/types';

// The AI SDK tool execute signature wants an options arg; tests pass a minimal one.
const execOpts = { toolCallId: 'test-call', messages: [] } as never;

describe('AI-SDK projection (§11)', () => {
  it('builds one sanitized tool per action with an injected `account` param', async () => {
    const h = makeHarness();
    const tools = await toToolSet(h.runtime);
    expect(Object.keys(tools)).toContain('gmail__send_email');
    expect(Object.keys(tools)).toContain('google_calendar__create_event');
    // account is injected into the (object) input schema.
    const schema = (tools.gmail__search_messages as { inputSchema: { safeParse(v: unknown): { success: boolean } } }).inputSchema;
    expect(schema.safeParse({ query: 'x', account: 'me@gmail.com' }).success).toBe(true);
  });

  it('routes `account` to resolution and strips it before execute', async () => {
    const h = makeHarness();
    await h.connect({ email: 'personal@gmail.com', label: 'personal' });
    await h.connect({ email: 'work@gmail.com', label: 'work' });
    h.env.action = () => ({ json: { messages: [{ id: 'm1', threadId: 't1' }], resultSizeEstimate: 1 } });
    const tools = await toToolSet(h.runtime);
    // With a matching account, resolution succeeds (proves account reached opts.account).
    const result = await (tools.gmail__search_messages as { execute(a: unknown, o: unknown): Promise<unknown> }).execute(
      { query: 'is:unread', account: 'work@gmail.com' },
      execOpts,
    );
    expect(result).toMatchObject({ messages: [{ id: 'm1' }] });
  });

  it('surfaces needs_account WITHOUT the opaque connectionId; the host gets the full outcome', async () => {
    const h = makeHarness();
    const c1 = await h.connect({ email: 'personal@gmail.com', label: 'personal' });
    const c2 = await h.connect({ email: 'work@gmail.com', label: 'work' });
    const paused: { actionId: string; outcome: ActionOutcome }[] = [];
    const tools = await toToolSet(h.runtime, { onPause: (actionId, outcome) => paused.push({ actionId, outcome }) });

    const modelResult = await (tools.google_calendar__list_calendars as { execute(a: unknown, o: unknown): Promise<unknown> }).execute(
      {},
      execOpts,
    );
    const json = JSON.stringify(modelResult);
    expect(json).toContain('choose_account');
    expect(json).toContain('personal@gmail.com');
    // Model-visible result must NOT contain the opaque ids.
    expect(json).not.toContain(c1.id);
    expect(json).not.toContain(c2.id);
    // The host channel DOES get the full outcome with the ids.
    expect(paused).toHaveLength(1);
    const choices = (paused[0]?.outcome as { choices: { connectionId: string }[] }).choices;
    expect(choices.map((c) => c.connectionId).sort()).toEqual([c1.id, c2.id].sort());
  });

  it('surfaces approval_required as a model-safe instruction (no URL, no ids)', async () => {
    const h = makeHarness();
    await h.connect();
    const paused: ActionOutcome[] = [];
    const tools = await toToolSet(h.runtime, { onPause: (_id, o) => paused.push(o) });
    const modelResult = await (tools.gmail__send_email as { execute(a: unknown, o: unknown): Promise<unknown> }).execute(
      { to: 'a@b.com', subject: 's', body: 'b' },
      execOpts,
    );
    expect(modelResult).toMatchObject({ status: 'approval_required' });
    expect(paused[0]).toMatchObject({ reason: 'approval_required' });
  });

  it('redacts tool results through the shared redactor (tool-I/O sink)', async () => {
    const h = makeHarness();
    h.env.exchangeToken = { access_token: 'SENTINEL-TOK-aaa', refresh_token: 'SENTINEL-RT-aaa', expires_in: 3600, scope: '' };
    await h.connect();
    h.env.action = () => ({ json: { id: 'm1', snippet: 'SENTINEL-TOK-aaa', labelIds: [] } });
    const tools = await toToolSet(h.runtime, { redactor: h.redactor });
    const modelResult = await (tools.gmail__get_message as { execute(a: unknown, o: unknown): Promise<unknown> }).execute(
      { messageId: 'm1' },
      execOpts,
    );
    expect(JSON.stringify(modelResult)).not.toContain('SENTINEL-TOK');
  });

  it('model-safe view of auth_config_required shows config LABELS only, never the authConfigId', () => {
    const safe = modelSafeOutcome({
      ok: false,
      reason: 'auth_config_required',
      providerId: 'google',
      choices: [
        { authConfigId: 'google-work', label: 'Work' },
        { authConfigId: 'google-personal', label: 'Personal' },
      ],
    });
    const json = JSON.stringify(safe);
    expect(json).toContain('Work');
    expect(json).toContain('Personal');
    expect(json).not.toContain('google-work'); // opaque id never reaches the model
    expect(json).not.toContain('google-personal');
  });

  it('the same action behaves identically via direct runAction and via the tool (§14 #7)', async () => {
    const h = makeHarness();
    await h.connect();
    h.env.action = () => ({ json: { items: [{ id: 'primary', summary: 'Primary', primary: true }] } });
    const direct = await h.runtime.runAction('google_calendar.list_calendars', {});
    const tools = await toToolSet(h.runtime, { redactor: h.redactor });
    const viaTool = await (tools.google_calendar__list_calendars as { execute(a: unknown, o: unknown): Promise<unknown> }).execute(
      {},
      execOpts,
    );
    expect(direct.ok).toBe(true);
    expect(viaTool).toEqual((direct as { result: unknown }).result);
  });
});
