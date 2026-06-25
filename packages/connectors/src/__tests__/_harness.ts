/**
 * Shared test harness: a Google-wired runtime over fakes, with a programmable
 * fake Google backend (token endpoint, userinfo, revoke, action endpoints). Not a
 * `.test.ts` file, so vitest does not treat it as a suite.
 */
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { staticOAuthApps } from '../oauth-apps';
import { registerGoogle, GOOGLE_SCOPES } from '../providers/google';
import { inMemoryStore, plaintextSecretBox, fakeClock, fakeHttp } from '../testing';
import type { FakeHttpCall, FakeHttpResponse } from '../testing';
import type { ActionRunEvent, ApprovalCheckInput, ApprovalDecision, ApprovalPolicy, Connection } from '../core/types';

export const ALL_GOOGLE_SCOPES = [
  'openid',
  'email',
  GOOGLE_SCOPES.calendarReadonly,
  GOOGLE_SCOPES.calendarEvents,
  GOOGLE_SCOPES.gmailReadonly,
  GOOGLE_SCOPES.gmailCompose,
  GOOGLE_SCOPES.gmailSend,
  GOOGLE_SCOPES.gmailModify,
  GOOGLE_SCOPES.driveReadonly,
  GOOGLE_SCOPES.driveFile,
  GOOGLE_SCOPES.documents,
  GOOGLE_SCOPES.spreadsheets,
];

export interface GoogleEnv {
  /** Identity the *next* consent resolves to (the account the user picks). */
  userinfoEmail: string;
  /** Token returned by an authorization-code exchange. */
  exchangeToken: Record<string, unknown>;
  /** Token returned by a refresh (function so tests can rotate / preserve / fail). */
  refresh: () => FakeHttpResponse;
  refreshCount: number;
  revokeCount: number;
  exchangeCount: number;
  /** Handler for non-auth provider endpoints (calendar/gmail). */
  action: (call: FakeHttpCall) => FakeHttpResponse;
}

export interface Harness {
  runtime: ReturnType<typeof createConnectorRuntime>;
  store: ReturnType<typeof inMemoryStore>;
  clock: ReturnType<typeof fakeClock>;
  http: ReturnType<typeof fakeHttp>;
  env: GoogleEnv;
  runs: ActionRunEvent[];
  redactor: ReturnType<typeof createRedactor>;
  setApproval(decide: (input: ApprovalCheckInput) => ApprovalDecision): void;
  /** Simulate a full connect (beginAuth → user authorizes → completeAuth). */
  connect(opts?: {
    ownerId?: string;
    email?: string;
    label?: string;
    scopes?: string[];
    existingConnectionId?: string;
  }): Promise<Connection>;
}

function subFor(email: string): string {
  return `sub:${email}`;
}

export function makeHarness(): Harness {
  const clock = fakeClock();
  const env: GoogleEnv = {
    userinfoEmail: 'me@gmail.com',
    exchangeToken: { access_token: 'access-EXCH', refresh_token: 'refresh-RT', expires_in: 3600, scope: '' },
    refresh: () => ({ json: { access_token: 'access-REFRESHED', expires_in: 3600 } }),
    refreshCount: 0,
    revokeCount: 0,
    exchangeCount: 0,
    action: () => ({ status: 200, json: {} }),
  };

  const http = fakeHttp(async (call) => {
    const body = call.body ?? '';
    if (call.url.startsWith('https://oauth2.googleapis.com/token')) {
      if (body.includes('grant_type=authorization_code')) {
        env.exchangeCount++;
        return { json: env.exchangeToken };
      }
      env.refreshCount++;
      return env.refresh();
    }
    if (call.url.startsWith('https://oauth2.googleapis.com/revoke')) {
      env.revokeCount++;
      return { status: 200, json: {} };
    }
    if (call.url.includes('/oauth2/v2/userinfo')) {
      return { json: { sub: subFor(env.userinfoEmail), email: env.userinfoEmail } };
    }
    return env.action(call);
  });

  const registry = createRegistry();
  registerGoogle(registry, { fetch: http.fetch });

  const store = inMemoryStore();
  const redactor = createRedactor();
  const runs: ActionRunEvent[] = [];

  let decide: (input: ApprovalCheckInput) => ApprovalDecision = (i) => (i.mutating ? 'ask' : 'allow');
  const approval: ApprovalPolicy = { async check(i) { return decide(i); } };

  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(), // readable "sealed" blob so confinement tests are meaningful
    oauthApps: staticOAuthApps({
      google: { clientId: 'client-id', clientSecret: 'client-SECRET', redirectUri: 'http://127.0.0.1:0/callback' },
    }),
    approval,
    clock,
    redactor,
    fetch: http.fetch,
    onActionRun: (e) => runs.push(e),
  });

  return {
    runtime,
    store,
    clock,
    http,
    env,
    runs,
    redactor,
    setApproval(d) {
      decide = d;
    },
    async connect(opts = {}) {
      if (opts.email) env.userinfoEmail = opts.email;
      const begin = await runtime.beginAuth('google', {
        ...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
        scopes: opts.scopes ?? ALL_GOOGLE_SCOPES,
        ...(opts.label ? { label: opts.label } : {}),
        ...(opts.existingConnectionId ? { existingConnectionId: opts.existingConnectionId } : {}),
      });
      return runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId });
    },
  };
}
