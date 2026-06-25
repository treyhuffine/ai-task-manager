/**
 * Multi-client AuthConfig layer (connectors-authconfig-spec.md §12). Proves the load-bearing
 * binding rules (refresh/revoke/consent use the MINTING client), §4a default resolution, the
 * status×purpose lifecycle, registration invariants, secret discipline, and the projection.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { defineProvider, defineToolkit, httpAction } from '../core/authoring';
import { bearer } from '../auth/direct';
import { staticAuthConfigs, type AuthConfigInput } from '../auth-configs';
import { AuthConfigRequiredError, isConnectorError } from '../core/errors';
import { modelSafeOutcome } from '../core/projection-shared';
import { registerGoogle, GOOGLE_SCOPES } from '../providers/google';
import { inMemoryStore, plaintextSecretBox, fakeClock, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';
import type {
  ActionOutcome,
  ActionRunEvent,
  AuthConfig,
  AuthConfigRegistry,
  Connection,
  Credentials,
} from '../core/types';

const RU = 'http://127.0.0.1:0/cb';
const IDENTITY = ['openid', 'email'];
const CAL = [...IDENTITY, GOOGLE_SCOPES.calendarReadonly, GOOGLE_SCOPES.calendarEvents];

/** An oauth2 google config; client id/secret default to `C-<id>` / `S-<id>`. */
function cfg(id: string, over: Partial<AuthConfigInput> = {}): AuthConfigInput {
  return {
    id,
    providerId: 'google',
    scheme: 'oauth2',
    scope: 'global',
    oauth: { clientId: `C-${id}`, redirectUri: RU },
    clientSecret: `S-${id}`,
    status: 'active',
    ...over,
  };
}

interface Setup {
  runtime: ReturnType<typeof createConnectorRuntime>;
  store: ReturnType<typeof inMemoryStore>;
  clock: ReturnType<typeof fakeClock>;
  secretBox: ReturnType<typeof plaintextSecretBox>;
  redactor: ReturnType<typeof createRedactor>;
  runs: ActionRunEvent[];
  env: { userinfoEmail: string; tokenCalls: { clientId: string; grant: string }[]; revokeCalls: string[]; action: (call: FakeHttpCall) => { status?: number; json?: unknown } };
}

function setup(configs: Parameters<typeof staticAuthConfigs>[0] | AuthConfigRegistry): Setup {
  const clock = fakeClock();
  const env: Setup['env'] = {
    userinfoEmail: 'me@gmail.com',
    tokenCalls: [],
    revokeCalls: [],
    action: () => ({ json: { items: [] } }),
  };
  const http = fakeHttp(async (call) => {
    if (call.url.startsWith('https://oauth2.googleapis.com/token')) {
      const p = new URLSearchParams(call.body ?? '');
      const clientId = p.get('client_id') ?? '';
      const grant = p.get('grant_type') ?? '';
      env.tokenCalls.push({ clientId, grant });
      if (grant === 'authorization_code') {
        return { json: { access_token: `acc-${clientId}`, refresh_token: `rt-${clientId}`, expires_in: 3600, scope: '' } };
      }
      return { json: { access_token: `acc-${clientId}-r`, expires_in: 3600 } };
    }
    if (call.url.startsWith('https://oauth2.googleapis.com/revoke')) {
      const p = new URLSearchParams(call.body ?? '');
      env.revokeCalls.push(p.get('client_id') ?? '');
      return { status: 200, json: {} };
    }
    if (call.url.includes('/oauth2/v2/userinfo')) {
      return { json: { sub: `sub:${env.userinfoEmail}`, email: env.userinfoEmail } };
    }
    return env.action(call);
  });

  const registry = createRegistry();
  registerGoogle(registry, { fetch: http.fetch });
  const store = inMemoryStore();
  const secretBox = plaintextSecretBox();
  const redactor = createRedactor();
  const runs: ActionRunEvent[] = [];
  const authConfigs = isRegistry(configs) ? configs : staticAuthConfigs(configs);

  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox,
    authConfigs,
    approval: { async check() { return 'allow'; } },
    clock,
    redactor,
    fetch: http.fetch,
    onActionRun: (e) => runs.push(e),
  });

  return { runtime, store, clock, secretBox, redactor, runs, env };
}

function isRegistry(x: unknown): x is AuthConfigRegistry {
  return typeof x === 'object' && x !== null && typeof (x as AuthConfigRegistry).listForConnect === 'function';
}

async function connect(
  s: Setup,
  opts: { authConfigId?: string; ownerId?: string; tenantId?: string; email?: string; scopes?: string[]; existingConnectionId?: string } = {},
): Promise<Connection> {
  if (opts.email) s.env.userinfoEmail = opts.email;
  const begin = await s.runtime.beginAuth('google', {
    ...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
    ...(opts.authConfigId ? { authConfigId: opts.authConfigId } : {}),
    scopes: opts.scopes ?? CAL,
    ...(opts.existingConnectionId ? { existingConnectionId: opts.existingConnectionId } : {}),
  });
  return s.runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId });
}

function urlScopes(u: string): string[] {
  return (new URL(u).searchParams.get('scope') ?? '').split(' ').filter(Boolean).sort();
}
function urlClientId(u: string): string {
  return new URL(u).searchParams.get('client_id') ?? '';
}

const TWO = [cfg('google-A', { label: 'Work', isDefault: true }), cfg('google-B', { label: 'Personal' })];

// ───────────────────────── minting-client binding (load-bearing) ────────────

describe('minting-client binding (§2/§6)', () => {
  it('refreshes each connection with the client that MINTED it', async () => {
    const s = setup(TWO);
    const c1 = await connect(s, { authConfigId: 'google-A', email: 'a1@gmail.com', scopes: CAL });
    const c2 = await connect(s, { authConfigId: 'google-B', email: 'a2@gmail.com', scopes: CAL });
    expect(c1.authConfigId).toBe('google-A');
    expect(c2.authConfigId).toBe('google-B');

    s.clock.advance(2 * 3600_000); // both expire
    s.env.tokenCalls.length = 0;
    await s.runtime.runAction('google_calendar.list_calendars', {}, { account: 'a1@gmail.com' });
    expect(s.env.tokenCalls.map((t) => t.clientId)).toEqual(['C-google-A']); // refreshed with A

    s.env.tokenCalls.length = 0;
    await s.runtime.runAction('google_calendar.list_calendars', {}, { account: 'a2@gmail.com' });
    expect(s.env.tokenCalls.map((t) => t.clientId)).toEqual(['C-google-B']); // refreshed with B
  });

  it('the same account via two clients is TWO connections (dedup by accountId + authConfigId)', async () => {
    const s = setup(TWO);
    const a = await connect(s, { authConfigId: 'google-A', email: 'same@gmail.com', scopes: CAL });
    const b = await connect(s, { authConfigId: 'google-B', email: 'same@gmail.com', scopes: CAL });
    expect(a.id).not.toBe(b.id);
    expect((await s.store.list({ providerId: 'google' })).length).toBe(2);
  });

  it('a legacy `authConfigId: undefined` connection refreshes via the provider default', async () => {
    const s = setup({ google: { clientId: 'LEGACY', clientSecret: 'LS', redirectUri: RU } });
    const expired: Credentials = { type: 'oauth2', accessToken: 'old', refreshToken: 'rt-legacy', expiresAt: s.clock.now() - 1000 };
    await s.store.save(
      { id: 'legacy1', ownerId: 'local', providerId: 'google', accountId: 'sub:me', email: 'me@gmail.com', scopes: CAL, status: 'active', createdAt: 'now', updatedAt: 'now' },
      await s.secretBox.seal(expired),
    );
    s.env.tokenCalls.length = 0;
    const out = await s.runtime.runAction('google_calendar.list_calendars', {}, { connectionId: 'legacy1' });
    expect(out.ok).toBe(true);
    expect(s.env.tokenCalls).toEqual([{ clientId: 'LEGACY', grant: 'refresh_token' }]);
  });

  it('disconnect revokes with the minting client', async () => {
    const s = setup(TWO);
    const c = await connect(s, { authConfigId: 'google-B', email: 'b@gmail.com', scopes: CAL });
    await s.runtime.disconnectConnection(c.id);
    expect(s.env.revokeCalls).toEqual(['C-google-B']);
  });

  it('re-consent that resolves to a DIFFERENT client than the connection is refused', async () => {
    const s = setup(TWO);
    const c = await connect(s, { authConfigId: 'google-A', email: 'me@gmail.com', scopes: CAL });
    // Forge an add_scopes request whose stamped authConfigId is B while the connection is A.
    const begin = await s.runtime.beginAuth('google', { existingConnectionId: c.id, scopes: CAL });
    const taken = await s.store.take(begin.requestId); // pull, mutate, re-put
    await s.store.put({ ...taken!, authConfigId: 'google-B' });
    await expect(
      s.runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId }),
    ).rejects.toMatchObject({ code: 'consent_account_mismatch' });
  });
});

// ───────────────────────────── §4a default resolution ───────────────────────

describe('§4a default resolution', () => {
  it('a single global config resolves invisibly (no picker, no default flag needed)', async () => {
    const s = setup([cfg('solo')]); // one config, NOT marked isDefault, no label
    const c = await connect(s, { scopes: CAL });
    expect(c.authConfigId).toBe('solo');
  });

  it('an explicit authConfigId wins over the marked default', async () => {
    const s = setup(TWO);
    const c = await connect(s, { authConfigId: 'google-B', scopes: CAL });
    expect(c.authConfigId).toBe('google-B'); // B, even though A is the default
  });

  it('precedence: owner default beats tenant beats global', async () => {
    const configs = [
      cfg('g-global', { label: 'Global', isDefault: true }),
      cfg('g-tenant', { label: 'Tenant', isDefault: true, scope: 'tenant', tenantId: 'T1' }),
      cfg('g-owner', { label: 'Owner', isDefault: true, scope: 'owner', ownerId: 'U1' }),
    ];
    const s = setup(configs);
    expect((await connect(s, { ownerId: 'U1', tenantId: 'T1', scopes: CAL })).authConfigId).toBe('g-owner');
    expect((await connect(s, { ownerId: 'U2', tenantId: 'T1', scopes: CAL })).authConfigId).toBe('g-tenant');
    expect((await connect(s, { ownerId: 'U2', scopes: CAL })).authConfigId).toBe('g-global');
  });

  it('>1 candidate and no default → beginAuth THROWS, runAction RETURNS auth_config_required', async () => {
    const configs = [cfg('g-1', { label: 'One' }), cfg('g-2', { label: 'Two' })]; // neither default
    const s = setup(configs);
    await expect(s.runtime.beginAuth('google', { scopes: CAL })).rejects.toBeInstanceOf(AuthConfigRequiredError);

    const out = await s.runtime.runAction('google_calendar.list_calendars', {});
    expect(out).toMatchObject({ ok: false, reason: 'auth_config_required', providerId: 'google' });
    const choices = (out as Extract<ActionOutcome, { reason: 'auth_config_required' }>).choices;
    expect(choices.map((c) => c.label).sort()).toEqual(['One', 'Two']);
    expect(choices.every((c) => typeof c.authConfigId === 'string')).toBe(true);
  });

  it('two defaults at the SAME visibility level → auth_config_ambiguous_default (runtime resolution)', async () => {
    // A custom registry that returns two global defaults (the static builder would reject this).
    const dupes: AuthConfig[] = [
      { id: 'd1', providerId: 'google', scheme: 'oauth2', label: 'D1', isDefault: true, scope: 'global', oauth: { clientId: 'C1', redirectUri: RU }, status: 'active' },
      { id: 'd2', providerId: 'google', scheme: 'oauth2', label: 'D2', isDefault: true, scope: 'global', oauth: { clientId: 'C2', redirectUri: RU }, status: 'active' },
    ];
    const reg: AuthConfigRegistry = {
      async listForConnect() { return dupes; },
      async getConfigForConnection(_p, id) { return dupes.find((c) => c.id === id) ?? null; },
      async openConfigForConnection(_p, id) { const c = dupes.find((x) => x.id === id); return c ? { config: c } : null; },
      async listForProvider() { return dupes.map((c) => ({ id: c.id, providerId: c.providerId, scheme: c.scheme, label: c.label, isDefault: true, status: c.status })); },
    };
    const s = setup(reg);
    const out = await s.runtime.runAction('google_calendar.list_calendars', {});
    expect(out).toMatchObject({ ok: false, reason: 'error', code: 'auth_config_ambiguous_default' });
    await expect(s.runtime.beginAuth('google', { scopes: CAL })).rejects.toMatchObject({ code: 'auth_config_ambiguous_default' });
  });

  it('scope-aware implicit selection picks a satisfying sibling before precedence dead-ends', async () => {
    const gmailAllowed = [...IDENTITY, GOOGLE_SCOPES.gmailReadonly, GOOGLE_SCOPES.gmailSend, GOOGLE_SCOPES.gmailModify];
    const calAllowed = [...IDENTITY, GOOGLE_SCOPES.calendarReadonly, GOOGLE_SCOPES.calendarEvents];
    const s = setup([
      cfg('g-owner-cal', { label: 'Owner Cal', isDefault: true, scope: 'owner', ownerId: 'U1', allowedScopes: calAllowed }),
      cfg('g-global-mail', { label: 'Global Mail', isDefault: true, allowedScopes: gmailAllowed }),
    ]);
    // gmail action for U1: the owner default can't grant gmail; the global one can → it's picked.
    const out = await s.runtime.runAction('gmail.search_messages', { query: 'x' }, { ownerId: 'U1' });
    expect(out).toMatchObject({ ok: false, reason: 'auth_required' });
    expect(urlClientId((out as { authorizationUrl: string }).authorizationUrl)).toBe('C-g-global-mail');
  });

  it('when NO visible config can grant the request → scope_not_allowed (not a useless picker)', async () => {
    const calAllowed = [...IDENTITY, GOOGLE_SCOPES.calendarReadonly, GOOGLE_SCOPES.calendarEvents];
    const s = setup([
      cfg('g-cal-1', { label: 'Cal 1', allowedScopes: calAllowed }),
      cfg('g-cal-2', { label: 'Cal 2', allowedScopes: calAllowed }),
    ]);
    const out = await s.runtime.runAction('gmail.search_messages', { query: 'x' });
    expect(out).toMatchObject({ ok: false, reason: 'error', code: 'scope_not_allowed' });
  });

  it('auto-auth requests identity ∪ action.scopes (not the config defaultScopes)', async () => {
    const s = setup([cfg('solo', { defaultScopes: [GOOGLE_SCOPES.gmailModify] })]);
    const out = await s.runtime.runAction('google_calendar.list_calendars', {});
    expect(out).toMatchObject({ ok: false, reason: 'auth_required' });
    expect(urlScopes((out as { authorizationUrl: string }).authorizationUrl)).toEqual(
      [...IDENTITY, GOOGLE_SCOPES.calendarReadonly].sort(),
    );
  });
});

// ─────────────────── explicit-stage distinctions (§4a) ──────────────────────

describe('explicit-id staged resolution stays distinct (§4a)', () => {
  it('not visible → provider_not_configured; visible+disabled → auth_config_unavailable; over-ask → scope_not_allowed', async () => {
    const s = setup([
      cfg('g-active', { label: 'Active' }),
      cfg('g-disabled', { label: 'Disabled', status: 'disabled' }),
      cfg('g-capped', { label: 'Capped', allowedScopes: [...IDENTITY, GOOGLE_SCOPES.calendarReadonly, GOOGLE_SCOPES.calendarEvents] }),
    ]);
    // not visible (unknown id)
    await expect(s.runtime.beginAuth('google', { authConfigId: 'nope', scopes: CAL })).rejects.toMatchObject({ code: 'provider_not_configured' });
    // visible but disabled for connect
    await expect(s.runtime.beginAuth('google', { authConfigId: 'g-disabled', scopes: CAL })).rejects.toMatchObject({ code: 'auth_config_unavailable' });
    // visible + active, but requesting beyond allowedScopes
    await expect(s.runtime.beginAuth('google', { authConfigId: 'g-capped', scopes: [...CAL, GOOGLE_SCOPES.gmailSend] })).rejects.toMatchObject({ code: 'scope_not_allowed' });
  });

  it('implicit all-inactive → auth_config_unavailable; none visible → provider_not_configured', async () => {
    const allInactive = setup([cfg('g-x', { label: 'X', status: 'disabled' }), cfg('g-y', { label: 'Y', status: 'archived' })]);
    expect(await allInactive.runtime.runAction('google_calendar.list_calendars', {})).toMatchObject({ ok: false, code: 'auth_config_unavailable' });

    const none = setup([]);
    expect(await none.runtime.runAction('google_calendar.list_calendars', {})).toMatchObject({ ok: false, code: 'provider_not_configured' });
  });
});

// ───────────────────────── registration invariants (§3/§3a) ─────────────────

describe('registration invariants', () => {
  it('duplicate AuthConfig id → throws', () => {
    expect(() => staticAuthConfigs([cfg('dup', { label: 'A' }), cfg('dup', { label: 'B' })])).toThrow(/duplicate/i);
  });

  it('>1 config for a provider where one lacks a label → throws', () => {
    expect(() => staticAuthConfigs([cfg('g-1', { label: 'One' }), cfg('g-2')])).toThrow(/label/i);
  });

  it('two defaults at one visibility level → throws at construction', () => {
    expect(() => staticAuthConfigs([cfg('g-1', { label: 'One', isDefault: true }), cfg('g-2', { label: 'Two', isDefault: true })])).toThrow(/default/i);
  });

  it('scheme not matching the provider strategy → error at first resolution', async () => {
    const s = setup([cfg('g-bad', { scheme: 'api_key' })]);
    await expect(s.runtime.beginAuth('google', { scopes: CAL })).rejects.toMatchObject({ code: 'internal_error' });
  });

  it('defaultScopes/identity exceeding allowedScopes → error at first resolution', async () => {
    // allowedScopes omits identity (openid/email), which is always requested → violation.
    const s = setup([cfg('g-bad', { allowedScopes: [GOOGLE_SCOPES.calendarReadonly] })]);
    await expect(s.runtime.beginAuth('google', { scopes: CAL })).rejects.toMatchObject({ code: 'internal_error' });
  });
});

// ─────────────────── trust-path split + secret discipline (§4/§9/§11) ───────

describe('trust paths & secret discipline', () => {
  it('listForConnect enforces visibility; getConfigForConnection resolves the same id with no ctx', async () => {
    const reg = staticAuthConfigs([
      cfg('g-global', { label: 'Global' }),
      cfg('g-owner', { label: 'Owner', scope: 'owner', ownerId: 'U1' }),
    ]);
    // Owner U2 cannot see U1's owner config at connect time…
    expect((await reg.listForConnect('google', { ownerId: 'U2' })).map((c) => c.id)).toEqual(['g-global']);
    // …but it resolves by stamped id with no ctx (the connection is the capability).
    expect((await reg.getConfigForConnection('google', 'g-owner'))?.id).toBe('g-owner');
  });

  it('only openConfigForConnection carries the secret; the URL-building resolvers never do', async () => {
    const reg = staticAuthConfigs([cfg('solo')]);
    const viaConnect = await reg.listForConnect('google', {});
    const viaConn = await reg.getConfigForConnection('google', 'solo');
    const summaries = await reg.listForProvider('google', {});
    expect(JSON.stringify(viaConnect)).not.toContain('S-solo');
    expect(JSON.stringify(viaConn)).not.toContain('S-solo');
    expect(JSON.stringify(summaries)).not.toContain('S-solo');
    const opened = await reg.openConfigForConnection('google', 'solo');
    expect(opened?.clientSecret).toBe('S-solo');
  });

  it('building a consent/reconnect URL does NOT open the secret', async () => {
    let opens = 0;
    const base = staticAuthConfigs([cfg('solo')]);
    const counting: AuthConfigRegistry = {
      ...base,
      async openConfigForConnection(p, id) {
        opens++;
        return base.openConfigForConnection(p, id);
      },
    };
    const s = setup(counting);
    await s.runtime.beginAuth('google', { scopes: CAL }); // connect URL — secret-free
    expect(opens).toBe(0);
    const c = await connect(s, { scopes: [...IDENTITY, GOOGLE_SCOPES.calendarReadonly] }); // exchange opens once
    expect(opens).toBe(1);
    await s.runtime.beginAuth('google', { existingConnectionId: c.id, scopes: CAL }); // add_scopes URL — secret-free
    expect(opens).toBe(1);
  });

  it('a sentinel client secret never escapes to the audit trail', async () => {
    const s = setup([cfg('solo', { clientSecret: 'SENTINEL-CLIENT-SECRET-zzz' })]);
    await connect(s, { scopes: CAL });
    s.clock.advance(2 * 3600_000);
    s.runs.length = 0;
    await s.runtime.runAction('google_calendar.list_calendars', {});
    expect(JSON.stringify(s.runs)).not.toContain('SENTINEL-CLIENT-SECRET');
  });
});

// ───────────────────────── consent scope formula (§6/§7) ────────────────────

describe('incremental consent honors the minting client', () => {
  it('a client that cannot grant the scope → scope_not_allowed (no doomed URL)', async () => {
    const calAllowed = [...IDENTITY, GOOGLE_SCOPES.calendarReadonly, GOOGLE_SCOPES.calendarEvents];
    const s = setup([cfg('g-cal', { allowedScopes: calAllowed })]);
    await connect(s, { scopes: [...IDENTITY, GOOGLE_SCOPES.calendarReadonly] });
    const out = await s.runtime.runAction('gmail.search_messages', { query: 'x' });
    expect(out).toMatchObject({ ok: false, reason: 'error', code: 'scope_not_allowed' });
  });

  it('a capable client mints a consent URL = connection.scopes ∪ missing (never defaultScopes)', async () => {
    const allowed = [...IDENTITY, GOOGLE_SCOPES.calendarReadonly, GOOGLE_SCOPES.calendarEvents, GOOGLE_SCOPES.gmailReadonly, GOOGLE_SCOPES.gmailModify];
    // defaultScopes is within allowedScopes but must NOT leak into a consent URL (consent uses
    // connection.scopes ∪ missing, never defaultScopes).
    const s = setup([cfg('g-full', { allowedScopes: allowed, defaultScopes: [GOOGLE_SCOPES.gmailModify] })]);
    const connScopes = [...IDENTITY, GOOGLE_SCOPES.calendarReadonly];
    await connect(s, { scopes: connScopes });
    const out = await s.runtime.runAction('gmail.search_messages', { query: 'x' });
    expect(out).toMatchObject({ ok: false, reason: 'needs_consent', missingScopes: [GOOGLE_SCOPES.gmailReadonly] });
    const got = urlScopes((out as { authorizationUrl: string }).authorizationUrl);
    expect(got).toEqual([...connScopes, GOOGLE_SCOPES.gmailReadonly].sort());
    expect(got).not.toContain(GOOGLE_SCOPES.gmailModify); // defaultScopes NOT silently added
  });

  it('allowedScopes coverage via scope implication (calendar ⊇ calendar.events)', async () => {
    const s = setup([cfg('g-broad', { allowedScopes: [...IDENTITY, GOOGLE_SCOPES.calendarFull] })]);
    // calendar.events is covered through Provider.scopeSatisfies → connect succeeds, no scope_not_allowed.
    const c = await connect(s, { authConfigId: 'g-broad', scopes: [...IDENTITY, GOOGLE_SCOPES.calendarEvents] });
    expect(c.authConfigId).toBe('g-broad');
    // a scope neither in nor implied by allowedScopes is rejected.
    await expect(
      s.runtime.beginAuth('google', { authConfigId: 'g-broad', scopes: [...IDENTITY, GOOGLE_SCOPES.gmailReadonly] }),
    ).rejects.toMatchObject({ code: 'scope_not_allowed' });
  });
});

// ───────────────────────── status × purpose lifecycle (§8) ──────────────────

describe('status × purpose lifecycle', () => {
  it('refresh and revoke keep working on an ARCHIVED config; connect does not', async () => {
    const s = setup([cfg('solo', { label: 'Solo' })]);
    const c = await connect(s, { scopes: CAL });
    // Archive the config out from under the live connection (swap the registry).
    const archived = staticAuthConfigs([cfg('solo', { label: 'Solo', status: 'archived' })]);
    const s2 = setup(archived);
    // reuse s2's runtime over a fresh store won't see c; instead assert via the same registry on s by
    // exercising refresh/revoke against the archived registry directly through a rebuilt runtime.
    await s2.store.save(c, await s2.secretBox.seal({ type: 'oauth2', accessToken: 'a', refreshToken: 'rt', expiresAt: s2.clock.now() - 1 } satisfies Credentials));
    s2.env.tokenCalls.length = 0;
    const refreshed = await s2.runtime.runAction('google_calendar.list_calendars', {}, { connectionId: c.id });
    expect(refreshed.ok).toBe(true); // refresh allowed on archived
    await s2.runtime.disconnectConnection(c.id); // revoke allowed on archived
    expect(s2.env.revokeCalls).toEqual(['C-solo']);
    // a NEW connect through the archived config is not eligible
    await expect(s2.runtime.beginAuth('google', { authConfigId: 'solo', scopes: CAL })).rejects.toMatchObject({ code: 'auth_config_unavailable' });
  });

  it('consent/reconnect allowed on a DISABLED config, refused on ARCHIVED', async () => {
    const disabled = setup([cfg('solo', { label: 'Solo', status: 'disabled' })]);
    // Seed a connection minted by the (now-disabled) config so add_scopes is bound to it.
    await disabled.store.save(
      { id: 'c1', ownerId: 'local', providerId: 'google', accountId: 'sub:me@gmail.com', email: 'me@gmail.com', scopes: [...IDENTITY, GOOGLE_SCOPES.calendarReadonly], status: 'active', authConfigId: 'solo', createdAt: 'now', updatedAt: 'now' },
      await disabled.secretBox.seal({ type: 'oauth2', accessToken: 'a', refreshToken: 'rt', expiresAt: disabled.clock.now() + 3600_000 } satisfies Credentials),
    );
    const begin = await disabled.runtime.beginAuth('google', { existingConnectionId: 'c1', scopes: [...IDENTITY, GOOGLE_SCOPES.calendarReadonly, GOOGLE_SCOPES.gmailReadonly] });
    expect(begin.authorizationUrl).toContain('accounts.google.com'); // consent allowed on disabled

    const archived = setup([cfg('solo', { label: 'Solo', status: 'archived' })]);
    await archived.store.save(
      { id: 'c1', ownerId: 'local', providerId: 'google', accountId: 'sub:me@gmail.com', email: 'me@gmail.com', scopes: [...IDENTITY, GOOGLE_SCOPES.calendarReadonly], status: 'active', authConfigId: 'solo', createdAt: 'now', updatedAt: 'now' },
      await archived.secretBox.seal({ type: 'oauth2', accessToken: 'a', refreshToken: 'rt', expiresAt: archived.clock.now() + 3600_000 } satisfies Credentials),
    );
    await expect(
      archived.runtime.beginAuth('google', { existingConnectionId: 'c1', scopes: [...IDENTITY, GOOGLE_SCOPES.calendarReadonly, GOOGLE_SCOPES.gmailReadonly] }),
    ).rejects.toMatchObject({ code: 'auth_config_unavailable' });
  });

  it('rotating the client secret keeps refresh working', async () => {
    const s = setup([cfg('solo', { label: 'Solo', clientSecret: 'OLD' })]);
    const c = await connect(s, { scopes: CAL });
    // Swap in a registry with the same client id but a new secret.
    const rotated = setup([cfg('solo', { label: 'Solo', clientSecret: 'NEW' })]);
    await rotated.store.save(c, await rotated.secretBox.seal({ type: 'oauth2', accessToken: 'a', refreshToken: 'rt', expiresAt: rotated.clock.now() - 1 } satisfies Credentials));
    const out = await rotated.runtime.runAction('google_calendar.list_calendars', {}, { connectionId: c.id });
    expect(out.ok).toBe(true);
    expect(rotated.env.tokenCalls.at(-1)).toEqual({ clientId: 'C-solo', grant: 'refresh_token' });
  });
});

// ───────────────────────── base URL + account label (§6/§7) ─────────────────

describe('per-instance base URL + account tiebreaker', () => {
  it('a non-OAuth connection whose config carries only a baseUrl hits that base', async () => {
    const calls: string[] = [];
    const http = fakeHttp(async (call) => {
      calls.push(call.url);
      return { json: { ok: true } };
    });
    const provider = defineProvider({ id: 'svc', displayName: 'Svc', auth: bearer(), baseUrl: 'https://default.example' });
    const toolkit = defineToolkit({
      id: 'svc',
      providerId: 'svc',
      displayName: 'Svc',
      actions: [
        httpAction({ id: 'svc.ping', description: 'ping', input: z.object({}), request: () => ({ method: 'GET', path: '/ping' }) }),
      ],
    });
    const registry = createRegistry();
    registry.addBundle({ provider, toolkits: [toolkit] });
    const store = inMemoryStore();
    const secretBox = plaintextSecretBox();
    const runtime = createConnectorRuntime({
      registry,
      store,
      authRequests: store,
      secretBox,
      authConfigs: staticAuthConfigs([
        { id: 'svc-self', providerId: 'svc', scheme: 'bearer', scope: 'global', baseUrl: 'https://self.example', status: 'active' },
      ]),
      approval: { async check() { return 'allow'; } },
      fetch: http.fetch,
    });
    await store.save(
      { id: 'c1', ownerId: 'local', providerId: 'svc', accountId: 'svc:1', scopes: [], status: 'active', authConfigId: 'svc-self', createdAt: 'now', updatedAt: 'now' },
      await secretBox.seal({ type: 'bearer', token: 'tok' } satisfies Credentials),
    );
    const out = await runtime.runAction('svc.ping', {}, { connectionId: 'c1' });
    expect(out.ok).toBe(true);
    expect(calls).toEqual(['https://self.example/ping']); // config baseUrl beat the provider default
  });

  it('an ambiguous account surfaces the config label as the tiebreaker', async () => {
    const s = setup(TWO);
    await connect(s, { authConfigId: 'google-A', email: 'same@gmail.com', scopes: CAL });
    await connect(s, { authConfigId: 'google-B', email: 'same@gmail.com', scopes: CAL });
    const out = await s.runtime.runAction('google_calendar.list_calendars', {});
    expect(out).toMatchObject({ ok: false, reason: 'needs_account' });
    const labels = (out as Extract<ActionOutcome, { reason: 'needs_account' }>).choices.map((c) => c.authConfigLabel).sort();
    expect(labels).toEqual(['Personal', 'Work']);
  });
});

// ───────────────────────────── projection (§6a/§11) ─────────────────────────

describe('model-safe projection', () => {
  it('auth_config_required shows the model labels only — never the opaque authConfigId', () => {
    const safe = modelSafeOutcome({
      ok: false,
      reason: 'auth_config_required',
      providerId: 'google',
      choices: [
        { authConfigId: 'secret-id-A', label: 'Work' },
        { authConfigId: 'secret-id-B', label: 'Personal' },
      ],
    });
    expect(JSON.stringify(safe)).not.toContain('secret-id');
    expect((safe as { options: string[] }).options.sort()).toEqual(['Personal', 'Work']);
  });
});

// Keep a reference to isConnectorError so error-shape assertions stay honest if refactored.
void isConnectorError;
