import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { makeHarness } from './_harness';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { defineProvider, defineToolkit, action } from '../core/authoring';
import { bearer } from '../auth/direct';
import { inMemoryStore, plaintextSecretBox } from '../testing';
import { staticOAuthApps } from '../oauth-apps';
import type { Connection } from '../core/types';

/**
 * P2-a: confinement is enforced INSIDE runAction, so it can't be forgotten by a
 * projection and an error message can't leak. Both the returned `result` and any
 * returned error `message` pass through the Redactor before leaving the runtime.
 */
describe('runtime-level redaction (P2-a)', () => {
  it('redacts a secret an action surfaced in its RESULT — no projection redactor involved', async () => {
    const h = makeHarness();
    h.env.exchangeToken = { access_token: 'SENTINEL-ACCESS-zzz', refresh_token: 'r-zzz', expires_in: 3600, scope: '' };
    await h.connect();
    // A leaky provider echoes the access token into its response body.
    h.env.action = () => ({ json: { id: 'm1', threadId: 't1', snippet: 'oops SENTINEL-ACCESS-zzz', labelIds: [] } });
    const out = await h.runtime.runAction('gmail.get_message', { messageId: 'm1' });
    expect(out.ok).toBe(true);
    // Called runAction directly (the programmatic projection) — the result is STILL scrubbed.
    expect(JSON.stringify(out)).not.toContain('SENTINEL-ACCESS');
  });

  it('redacts a secret embedded in a thrown error MESSAGE before returning it', async () => {
    const SENTINEL = 'SENTINEL-BEARER-abcdef';
    const registry = createRegistry();
    registry.addProvider(defineProvider({ id: 'svc', displayName: 'Svc', auth: bearer() }));
    registry.addToolkit(
      defineToolkit({
        id: 'svc',
        providerId: 'svc',
        displayName: 'Svc',
        actions: [
          action({
            id: 'svc.boom',
            description: 'throws with the token in the message',
            input: z.object({}),
            async execute(ctx) {
              const t = await ctx.getToken();
              throw new Error(`upstream failed: ${t}`);
            },
          }),
        ],
      }),
    );
    const store = inMemoryStore();
    const secretBox = plaintextSecretBox();
    const runtime = createConnectorRuntime({
      registry,
      store,
      authRequests: store,
      secretBox,
      redactor: createRedactor(),
      oauthApps: staticOAuthApps({}),
      approval: { async check() { return 'allow'; } },
    });
    const conn: Connection = {
      id: 'c1',
      ownerId: 'local',
      providerId: 'svc',
      accountId: 'svc:1',
      scopes: [],
      status: 'active',
      createdAt: 'now',
      updatedAt: 'now',
    };
    await store.save(conn, await secretBox.seal({ type: 'bearer', token: SENTINEL }));

    const out = await runtime.runAction('svc.boom', {});
    expect(out).toMatchObject({ ok: false, reason: 'error', code: 'internal_error' });
    expect(JSON.stringify(out)).not.toContain('SENTINEL-BEARER');
  });
});
