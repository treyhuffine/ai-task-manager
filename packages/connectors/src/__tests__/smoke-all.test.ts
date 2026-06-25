/**
 * Contrived smoke test — drives EVERY action of EVERY first-party provider through the real
 * runtime against a mock HTTP backend. Proves internal correctness across the whole library
 * (every input schema is valid, every request builds, every output mapper survives plausible
 * data, the trust spine holds) without a single real credential. It does NOT prove we matched
 * each vendor's real API contract — only a live call does that (that's the test page).
 *
 * Strategy: seed a connection per provider directly in the store (full scopes, the right
 * credential shape, a far-future token expiry so nothing refreshes), auto-generate a minimal
 * valid input from each action's Zod schema, and run it. Anything that doesn't return `ok`
 * (or a benign structured outcome) is collected into a coverage matrix.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { registerAllProviders } from '../providers';
import { uniqueScopes } from '../core/defaults';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';
import type { Connection, Credentials, CredentialType, Provider, Toolkit } from '../core/types';

// ── input generation: a minimal valid value for an action's Zod schema ───────
function sampleString(def: { checks?: Array<{ kind: string }> }): string {
  for (const c of def.checks ?? []) {
    if (c.kind === 'email') return 'test@example.com';
    if (c.kind === 'url') return 'https://example.com';
    if (c.kind === 'uuid') return '00000000-0000-0000-0000-000000000000';
    if (c.kind === 'datetime') return '2026-01-01T00:00:00.000Z';
  }
  return 'x';
}

function sample(schema: z.ZodTypeAny): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def: any = (schema as any)?._def;
  switch (def?.typeName) {
    case 'ZodObject': {
      const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries<z.ZodTypeAny>(shape)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const vt = (v as any)?._def?.typeName;
        if (vt === 'ZodOptional' || vt === 'ZodDefault' || vt === 'ZodNullable') continue; // minimal: skip
        out[k] = sample(v);
      }
      return out;
    }
    case 'ZodString':
      return sampleString(def);
    case 'ZodNumber':
      return 1;
    case 'ZodBoolean':
      return true;
    case 'ZodEnum':
      return def.values[0];
    case 'ZodNativeEnum':
      return Object.values(def.values)[0];
    case 'ZodLiteral':
      return def.value;
    case 'ZodArray':
      return [];
    case 'ZodTuple':
      return (def.items ?? []).map(sample);
    case 'ZodRecord':
      return {};
    case 'ZodUnion':
      return sample(def.options[0]);
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
      return sample(def.innerType);
    case 'ZodEffects':
      return sample(def.schema);
    default:
      return {};
  }
}

/**
 * Per-action input overrides for schemas the generator can't satisfy generically (refined email
 * strings, non-empty recipient arrays) — these are valid-input shapes, not connector fixes.
 */
const INPUT_OVERRIDES: Record<string, Record<string, unknown>> = {
  'gmail.send_email': { to: 'a@b.com', subject: 'x', body: 'x' },
  'gmail.create_draft': { to: 'a@b.com', subject: 'x', body: 'x' },
  'outlook_mail.send_mail': { to: ['a@b.com'], subject: 'x', content: 'x' },
  // upload_media decodes `media` as base64 (a bare 'x' decodes to 0 bytes); give it real bytes.
  'twitter.upload_media': { media: Buffer.from('hello').toString('base64'), media_type: 'image/png' },
};

// ── mock backend: a permissive "kitchen-sink" JSON response (plain object → redaction-safe) ──
function baseSink(): Record<string, unknown> {
  return {
    id: '1',
    name: 'x',
    title: 'x',
    email: 'a@b.com',
    username: 'x',
    first_name: 'x',
    global_name: 'x',
    message_id: 1,
    ts: '1',
    url: 'https://x',
    htmlLink: 'https://x',
    webViewLink: 'https://x',
    spreadsheetUrl: 'https://x',
    documentId: '1',
    spreadsheetId: '1',
    range: 'A1',
    ok: true,
    result: { id: 1, username: 'x', message_id: 1, chat: { id: 1 } },
    items: [],
    records: [],
    record: { id: '1', fields: {} },
    values: [],
    files: [],
    bases: [],
    channels: [],
    members: [],
    matches: [],
    messages: [],
    events: [],
    guilds: [],
    projects: [],
    teams: [],
    issues: [],
    collections: [],
    documents: [],
    highlights: [],
    books: [],
    contacts: [],
    deals: [],
    companies: [],
    fields: {},
    body: { content: [] },
    updates: { updatedRange: 'A1', updatedRows: 1, updatedCells: 1 },
  };
}

/** GraphQL (Linear) needs nested data shapes its mappers walk without optional chaining. */
function linearData(): Record<string, unknown> {
  return {
    data: {
      issues: { nodes: [] },
      teams: { nodes: [] },
      projects: { nodes: [] },
      viewer: { id: '1', name: 'x', email: 'a@b.com' },
      issueCreate: { issue: { id: '1', identifier: 'X-1', url: 'https://x' } },
      issueUpdate: { issue: { id: '1', identifier: 'X-1' } },
      commentCreate: { comment: { id: '1' } },
    },
  };
}

/** Endpoints whose REAL API returns a top-level JSON array (mappers call `.map` on the body). */
function returnsArray(call: FakeHttpCall): boolean {
  const { url, method } = call;
  if (method !== 'GET') return false;
  if (url.includes('api.todoist.com') && (/\/tasks(\?|$)/.test(url) || /\/projects(\?|$)/.test(url))) return true;
  if (url.includes('discord.com') && (url.includes('/guilds') || url.includes('/channels') || url.includes('/messages'))) return true;
  if (url.includes('gitlab.com') && (/\/projects(\?|$)/.test(url) || /\/issues(\?|$)/.test(url) || /\/merge_requests(\?|$)/.test(url))) return true;
  return false;
}

function responseFor(call: FakeHttpCall): unknown {
  const { url } = call;
  // X media upload (initialize/finalize) returns the media id under `data` — upload_media reads it.
  if (url.includes('/2/media/upload')) return { data: { id: 'media-1' } };
  if (url.includes('api.linear.app/graphql')) return linearData();
  if (url.includes('api.atlassian.com/oauth/token/accessible-resources')) {
    return [{ id: 'cloud1', name: 'site', url: 'https://x' }];
  }
  // Asana wraps everything in { data }; its list mappers read raw.data (array-shaped).
  if (url.includes('app.asana.com')) return { data: [] };
  if (returnsArray(call)) return [];
  return baseSink();
}

// ── connection seeding ───────────────────────────────────────────────────────
function credentialFor(kind: CredentialType, clockNow: number): Credentials {
  const farFuture = clockNow + 1_000_000_000_000;
  switch (kind) {
    case 'oauth2':
      return { type: 'oauth2', accessToken: 'fake-token', refreshToken: 'fake-refresh', expiresAt: farFuture };
    case 'api_key':
      return { type: 'api_key', apiKey: 'fake-key' };
    case 'bearer':
      return { type: 'bearer', token: 'fake-token' };
    case 'basic':
      return { type: 'basic', username: 'u', password: 'p' };
    case 'custom':
      return {
        type: 'custom',
        values: {
          token: 't',
          client_id: 'c',
          secret: 's',
          apiKey: 'k',
          api_key: 'k',
          access_token: 'a',
          phone_number_id: '123',
          subdomain: 'acme',
          email: 'a@b.com',
          api_token: 't',
        },
      };
    default:
      return { type: 'custom', values: { token: 't' } };
  }
}

function allProviderScopes(provider: Provider, toolkits: Toolkit[]): string[] {
  const scopes: string[] = [...(provider.identityScopes ?? [])];
  for (const t of toolkits) {
    if (t.providerId !== provider.id) continue;
    for (const a of t.actions) for (const s of a.scopes ?? []) scopes.push(s);
  }
  return uniqueScopes(scopes);
}

describe('smoke — every action of every provider executes against a mock', () => {
  it('runs every action of every provider clean', async () => {
    const http = fakeHttp(async (call) => ({ json: responseFor(call) }));
    const registry = createRegistry();
    registerAllProviders(registry, { fetch: http.fetch });
    const store = inMemoryStore();
    const secretBox = plaintextSecretBox();
    const runtime = createConnectorRuntime({
      registry,
      store,
      authRequests: store,
      secretBox,
      authConfigs: staticAuthConfigs([]),
      redactor: createRedactor(),
      approval: { async check() { return 'allow'; } },
      fetch: http.fetch,
    });

    const providers = runtime.getProviders();
    const toolkits = runtime.getToolkits();
    const now = Date.now();

    // Instance-scoped providers capture per-connection context at connect (cloudId / realmId /
    // instance_url). Smoke seeds connections directly, so we seed that context too — otherwise the
    // actions would route through the provider fallback base and never exercise the real path.
    const SEED_CONTEXT: Record<string, { config?: Record<string, unknown>; baseUrl?: string }> = {
      jira: { config: { cloudId: 'cloud1' } },
      confluence: { config: { cloudId: 'cloud1' } },
      quickbooks: { config: { realmId: 'R1' } },
      salesforce: { baseUrl: 'https://smoke.my.salesforce.com' },
    };

    // Seed one connection per provider with all its scopes + the right credential shape.
    for (const p of providers) {
      const seeded = SEED_CONTEXT[p.id];
      const conn: Connection = {
        id: `conn:${p.id}`,
        ownerId: 'local',
        providerId: p.id,
        accountId: `${p.id}:smoke`,
        email: 'a@b.com',
        scopes: allProviderScopes(p, toolkits),
        status: 'active',
        createdAt: 'now',
        updatedAt: 'now',
        ...(seeded?.config ? { config: seeded.config } : {}),
        ...(seeded?.baseUrl ? { baseUrl: seeded.baseUrl } : {}),
      };
      await store.save(conn, await secretBox.seal(credentialFor(p.auth.kind, now)));
    }

    const failures: Array<{ action: string; code?: string; reason?: string }> = [];
    let total = 0;
    for (const t of toolkits) {
      for (const a of t.actions) {
        total++;
        const input = INPUT_OVERRIDES[a.id] ?? sample(a.input);
        const out = await runtime.runAction(a.id, input, { connectionId: `conn:${t.providerId}` });
        if (!out.ok) {
          const o = out as { reason: string; code?: string };
          failures.push({ action: a.id, reason: o.reason, ...(o.code ? { code: o.code } : {}) });
        }
      }
    }

    const matrix = `${total - failures.length}/${total} actions clean`;
    if (failures.length > 0) {
      console.error('Smoke failures:\n' + failures.map((f) => `  ${f.action} → ${f.reason}${f.code ? ` (${f.code})` : ''}`).join('\n'));
    } else {
      console.log(`Smoke: ${matrix}`);
    }
    expect({ matrix, failures }).toEqual({ matrix: `${total}/${total} actions clean`, failures: [] });
  });
});
