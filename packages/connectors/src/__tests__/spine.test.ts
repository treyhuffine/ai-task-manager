import { describe, it, expect } from 'vitest';
import { makeHarness, ALL_GOOGLE_SCOPES } from './_harness';
import { GOOGLE_SCOPES, registerGoogle } from '../providers/google';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { inMemoryStore, plaintextSecretBox } from '../testing';
import { staticOAuthApps } from '../oauth-apps';
import type { ApprovalCheckInput } from '../core/types';

const CALENDAR_ONLY = ['openid', 'email', GOOGLE_SCOPES.calendarReadonly, GOOGLE_SCOPES.calendarEvents];

describe('connection resolution (§6)', () => {
  it('0 connections → auth_required', async () => {
    const h = makeHarness();
    const out = await h.runtime.runAction('google_calendar.list_calendars', {});
    expect(out).toMatchObject({ ok: false, reason: 'auth_required', providerId: 'google' });
    expect((out as { authorizationUrl: string }).authorizationUrl).toContain('accounts.google.com');
  });

  it('1 connection → uses it', async () => {
    const h = makeHarness();
    await h.connect();
    h.env.action = () => ({ json: { items: [{ id: 'primary', summary: 'Primary', primary: true }] } });
    const out = await h.runtime.runAction('google_calendar.list_calendars', {});
    expect(out.ok).toBe(true);
    expect((out as { result: { calendars: unknown[] } }).result.calendars).toHaveLength(1);
  });

  it('N connections + matching account → uses it; no hint → needs_account', async () => {
    const h = makeHarness();
    await h.connect({ email: 'personal@gmail.com', label: 'personal' });
    await h.connect({ email: 'work@gmail.com', label: 'work' });
    h.env.action = () => ({ json: { items: [] } });

    const ambiguous = await h.runtime.runAction('google_calendar.list_calendars', {});
    expect(ambiguous).toMatchObject({ ok: false, reason: 'needs_account' });
    const choices = (ambiguous as { choices: { email?: string }[] }).choices;
    expect(choices.map((c) => c.email).sort()).toEqual(['personal@gmail.com', 'work@gmail.com']);

    const resolved = await h.runtime.runAction('google_calendar.list_calendars', {}, { account: 'work@gmail.com' });
    expect(resolved.ok).toBe(true);
  });

  it('an account hint that matches MORE THAN ONE connection → needs_account, never first-match', async () => {
    const h = makeHarness();
    // One connection whose email is the hint; another whose *label* collides with it.
    await h.connect({ email: 'dup@gmail.com' }); // email = dup@gmail.com
    await h.connect({ email: 'other@gmail.com', label: 'dup@gmail.com' }); // label collides
    h.env.action = () => ({ json: { items: [] } });
    const out = await h.runtime.runAction('google_calendar.list_calendars', {}, { account: 'dup@gmail.com' });
    expect(out).toMatchObject({ ok: false, reason: 'needs_account' });
  });

  it('explicit connectionId from a different owner → connection_not_found (no leak)', async () => {
    const h = makeHarness();
    const conn = await h.connect({ ownerId: 'alice' });
    const out = await h.runtime.runAction('google_calendar.list_calendars', {}, { ownerId: 'bob', connectionId: conn.id });
    expect(out).toMatchObject({ ok: false, reason: 'error', code: 'connection_not_found' });
  });

  it('invalid input → invalid_input, emitted BEFORE any audit/account state', async () => {
    const h = makeHarness();
    await h.connect();
    const out = await h.runtime.runAction('google_calendar.create_event', { summary: 123 });
    expect(out).toMatchObject({ ok: false, reason: 'error', code: 'invalid_input' });
    expect(h.runs).toHaveLength(0); // no start/finish — nothing learned about connections
  });

  it('0 connections + NO configured auth client → provider_not_configured (a defined model-safe state, not a vague internal_error or a broken auth_required with no URL)', async () => {
    const registry = createRegistry();
    registerGoogle(registry);
    const store = inMemoryStore();
    const runtime = createConnectorRuntime({
      registry,
      store,
      authRequests: store,
      secretBox: plaintextSecretBox(),
      oauthApps: staticOAuthApps({}), // provider registered, but no client configured for it
    });
    const out = await runtime.runAction('google_calendar.list_calendars', {});
    expect(out).toMatchObject({ ok: false, reason: 'error', code: 'provider_not_configured' });
  });
});

describe('action-level scopes + incremental consent (§7)', () => {
  it('a calendar-only connection asked to read Gmail → needs_consent with the missing scope', async () => {
    const h = makeHarness();
    await h.connect({ scopes: CALENDAR_ONLY });
    const out = await h.runtime.runAction('gmail.search_messages', { query: 'is:unread' });
    expect(out).toMatchObject({ ok: false, reason: 'needs_consent', providerId: 'google' });
    expect((out as { missingScopes: string[] }).missingScopes).toEqual([GOOGLE_SCOPES.gmailReadonly]);
    expect((out as { connectionId: string }).connectionId).toBeTruthy();
  });

  it('calendar.events does not satisfy gmail.send', async () => {
    const h = makeHarness();
    await h.connect({ scopes: CALENDAR_ONLY });
    h.setApproval(() => 'allow');
    const out = await h.runtime.runAction('gmail.send_email', { to: 'a@b.com', subject: 's', body: 'b' });
    expect(out).toMatchObject({ ok: false, reason: 'needs_consent' });
    expect((out as { missingScopes: string[] }).missingScopes).toEqual([GOOGLE_SCOPES.gmailSend]);
  });

  it('re-consent (add_scopes) upgrades the SAME connection in place; the action then works', async () => {
    const h = makeHarness();
    const conn = await h.connect({ email: 'me@gmail.com', scopes: CALENDAR_ONLY });
    // Upgrade: add gmail scopes to the existing connection (same account).
    const upgraded = await h.connect({
      email: 'me@gmail.com',
      existingConnectionId: conn.id,
      scopes: [...CALENDAR_ONLY, GOOGLE_SCOPES.gmailReadonly],
    });
    expect(upgraded.id).toBe(conn.id); // same connection, not a new one
    expect(upgraded.scopes).toContain(GOOGLE_SCOPES.gmailReadonly);

    h.env.action = () => ({ json: { messages: [{ id: 'm1', threadId: 't1' }], resultSizeEstimate: 1 } });
    const out = await h.runtime.runAction('gmail.search_messages', { query: 'is:unread' });
    expect(out.ok).toBe(true);
  });

  it('re-consent that resolves to a DIFFERENT account is refused (consent_account_mismatch), mutating nothing', async () => {
    const h = makeHarness();
    const conn = await h.connect({ email: 'me@gmail.com', scopes: CALENDAR_ONLY });
    await expect(
      h.connect({ email: 'someone-else@gmail.com', existingConnectionId: conn.id, scopes: ALL_GOOGLE_SCOPES }),
    ).rejects.toMatchObject({ code: 'consent_account_mismatch' });
    const after = await h.store.get(conn.id);
    expect(after?.connection.scopes).toEqual(CALENDAR_ONLY); // untouched
  });

  it('identity/OIDC scopes are NOT gated per-call — an action runs even when the grant omits them', async () => {
    const h = makeHarness();
    // Providers don't echo identity scopes verbatim: Google aliases email→userinfo.email, and
    // Microsoft omits the OIDC scopes (openid/email/offline_access) from the token scope entirely.
    // Here the granted scope has NO `openid` and NO `email` — only userinfo.email + the calendar
    // resource scope. The action gates on its OWN scope (calendarReadonly), never on identity, so
    // there's no spurious needs_consent loop (the bug, across every OIDC provider).
    h.env.exchangeToken = {
      access_token: 'a',
      refresh_token: 'r',
      expires_in: 3600,
      scope: `https://www.googleapis.com/auth/userinfo.email ${GOOGLE_SCOPES.calendarReadonly}`,
    };
    await h.connect({ scopes: ['openid', 'email', GOOGLE_SCOPES.calendarReadonly] });
    h.env.action = () => ({ json: { items: [] } });
    const out = await h.runtime.runAction('google_calendar.list_calendars', {});
    expect(out.ok).toBe(true); // was needs_consent(['email'])
  });

  it('parses a COMMA-delimited granted scope (Slack-style), not just space-delimited', async () => {
    const h = makeHarness();
    // Slack returns the granted `scope` comma-separated. A whitespace-only split would mash it into
    // one bogus scope → the granted resource scope wouldn't be recognized → needs_consent loop.
    h.env.exchangeToken = {
      access_token: 'a',
      refresh_token: 'r',
      expires_in: 3600,
      scope: `openid,email,${GOOGLE_SCOPES.calendarReadonly}`,
    };
    const conn = await h.connect({ scopes: ['openid', 'email', GOOGLE_SCOPES.calendarReadonly] });
    expect(conn.scopes).toContain(GOOGLE_SCOPES.calendarReadonly); // split into distinct scopes
    h.env.action = () => ({ json: { items: [] } });
    expect((await h.runtime.runAction('google_calendar.list_calendars', {})).ok).toBe(true);
  });
});

describe('the approval gate (§8)', () => {
  it('mutating + agent + ask policy → approval_required (before any side effect)', async () => {
    const h = makeHarness();
    await h.connect();
    let sendCalls = 0;
    h.env.action = () => {
      sendCalls++;
      return { json: { id: 'm1' } };
    };
    const out = await h.runtime.runAction('gmail.send_email', { to: 'a@b.com', subject: 's', body: 'b' });
    expect(out).toMatchObject({ ok: false, reason: 'approval_required', risk: 'high' });
    expect(sendCalls).toBe(0); // gate is before the side effect
  });

  it('deny → denied; allow → executes', async () => {
    const h = makeHarness();
    await h.connect();
    h.env.action = () => ({ json: { id: 'm1', threadId: 't1' } });

    h.setApproval(() => 'deny');
    expect(await h.runtime.runAction('gmail.send_email', { to: 'a@b.com', subject: 's', body: 'b' })).toMatchObject({
      ok: false,
      reason: 'error',
      code: 'denied',
    });

    h.setApproval(() => 'allow');
    const ok = await h.runtime.runAction('gmail.send_email', { to: 'a@b.com', subject: 's', body: 'b' });
    expect(ok.ok).toBe(true);
  });

  it('passes a STABLE inputDigest + actionVersion to the policy regardless of input key order (§8)', async () => {
    const h = makeHarness();
    await h.connect();
    h.env.action = () => ({ json: { id: 'm1', threadId: 't1' } });
    const seen: ApprovalCheckInput[] = [];
    h.setApproval((i) => {
      seen.push(i);
      return 'allow';
    });
    await h.runtime.runAction('gmail.send_email', { to: 'a@b.com', subject: 's', body: 'b' });
    await h.runtime.runAction('gmail.send_email', { body: 'b', subject: 's', to: 'a@b.com' }); // reordered
    expect(seen).toHaveLength(2);
    expect(seen[0]?.inputDigest).toBe(seen[1]?.inputDigest);
    expect(seen[0]?.actionVersion).toBe(seen[1]?.actionVersion);
    // The digest also feeds back as the grant key — confirm it is non-empty.
    expect(seen[0]?.inputDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('audit (§8)', () => {
  it('emits start + finish with the SAME attemptId for a successful run', async () => {
    const h = makeHarness();
    await h.connect();
    h.env.action = () => ({ json: { items: [] } });
    h.runs.length = 0;
    await h.runtime.runAction('google_calendar.list_calendars', {});
    expect(h.runs).toHaveLength(2);
    expect(h.runs[0]?.phase).toBe('start');
    expect(h.runs[1]?.phase).toBe('finish');
    expect(h.runs[1]?.status).toBe('ok');
    expect(h.runs[0]?.attemptId).toBe(h.runs[1]?.attemptId);
  });

  it('emits a finish for a non-ok terminal outcome (approval_required)', async () => {
    const h = makeHarness();
    await h.connect();
    h.runs.length = 0;
    await h.runtime.runAction('gmail.send_email', { to: 'a@b.com', subject: 's', body: 'b' });
    expect(h.runs.map((r) => r.phase)).toEqual(['start', 'finish']);
    expect(h.runs[1]?.status).toBe('approval_required');
  });

  it('gives concurrent calls distinct attemptIds', async () => {
    const h = makeHarness();
    await h.connect();
    h.env.action = () => ({ json: { items: [] } });
    h.runs.length = 0;
    await Promise.all([
      h.runtime.runAction('google_calendar.list_calendars', {}),
      h.runtime.runAction('google_calendar.list_events', { calendarId: 'primary' }),
    ]);
    const startIds = h.runs.filter((r) => r.phase === 'start').map((r) => r.attemptId);
    expect(new Set(startIds).size).toBe(2);
  });
});

describe('disconnect (§9)', () => {
  it('best-effort revokes at the provider, then deletes local state', async () => {
    const h = makeHarness();
    const conn = await h.connect();
    expect(h.env.revokeCount).toBe(0);
    await h.runtime.disconnectConnection(conn.id);
    expect(h.env.revokeCount).toBe(1);
    expect(await h.store.get(conn.id)).toBeNull();
  });

  it('refuses to disconnect another owner’s connection', async () => {
    const h = makeHarness();
    const conn = await h.connect({ ownerId: 'alice' });
    await expect(h.runtime.disconnectConnection(conn.id, { ownerId: 'bob' })).rejects.toMatchObject({
      code: 'connection_not_found',
    });
    expect(await h.store.get(conn.id)).not.toBeNull();
  });
});

describe('confinement (§8, sentinel)', () => {
  it('never lets a token reach an audit preview, even when a provider echoes it', async () => {
    const h = makeHarness();
    h.env.exchangeToken = {
      access_token: 'SENTINEL-ACCESS-TOKEN-zzz',
      refresh_token: 'SENTINEL-REFRESH-TOKEN-zzz',
      expires_in: 3600,
      scope: '',
    };
    await h.connect();
    // A leaky provider that echoes the access token in its body.
    h.env.action = () => ({ json: { id: 'm1', snippet: 'SENTINEL-ACCESS-TOKEN-zzz leaked here', labelIds: [] } });
    h.runs.length = 0;
    const out = await h.runtime.runAction('gmail.get_message', { messageId: 'm1' });
    expect(out.ok).toBe(true);
    // Audit previews + any error string must be scrubbed of the sentinel.
    expect(JSON.stringify(h.runs)).not.toContain('SENTINEL-ACCESS-TOKEN');
    expect(JSON.stringify(h.runs)).not.toContain('SENTINEL-REFRESH-TOKEN');
    // The client secret never appears either.
    expect(JSON.stringify(h.runs)).not.toContain('client-SECRET');
  });
});
