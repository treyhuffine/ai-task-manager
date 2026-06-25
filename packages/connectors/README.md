# @connectors/engine

A local-first, trust-first **connector engine**: a small, dependency-light runtime
that lets a human-plus-agent system take authenticated actions on a user's real
external accounts — and never silently leaks a token, drops a refresh, or runs a
side effect ungated.

> Implements [`docs/connectors-module-spec.md`](../../docs/connectors-module-spec.md).
> The package name is a neutral placeholder (the spec defers licensing/naming).

## What's here (Phases 0–2 + the MCP layer)

- **The trust spine** (`src/core`): the `runAction` pipeline (the single gate),
  the OAuth2 refresh algorithm (single-flight via `Lock`, rotate-or-preserve,
  persist-before-return), the `Redactor`, canonical grant `inputDigest`, structured
  retry-safe outcomes, and total audit (`onActionRun`, paired by `attemptId`).
- **Auth strategies** (`src/auth`): OAuth2 (authorization-code + PKCE), plus
  `apiKey` / `bearer` / `basic` header-injectors.
- **Crypto / locks / stores** (`src/crypto`, `src/lock`, `src/store`): `aesGcmSecretBox`,
  in-process + file (`mkdir`-advisory) locks, and in-memory + atomic file stores.
- **The Google provider** (`src/providers/google`): one OAuth consent backing the
  `google_calendar` and `gmail` toolkits, with action-level scopes.
- **The AI-SDK projection** (`src/ai-sdk`): `toToolSet` — actions become a Vercel
  AI SDK `ToolSet` over the same `runAction`, with `account` injected/stripped and
  the opaque `connectionId` kept off the model surface.
- **The MCP layer** (`src/mcp`): `serveMcp` projects actions to *external* hosts
  (same gates, redaction, no ids to the client); `ingestMcpServer` registers an
  external MCP server as a **dynamic provider** whose tools flow through the same
  `runAction` pipeline — namespaced `mcp.<server>.<tool>`, default mutating/high-risk
  (approval-gated), provenance-tagged, redacted. `connectMcpClient` is a real
  Streamable-HTTP client (dynamic SDK import — the SDK stays an optional peer).

Run the suite: `pnpm --filter @connectors/engine test` (72 tests; the §17 contract).

## Authoring a connector (the DX)

```ts
import { defineProvider, defineToolkit, httpAction } from '@connectors/engine';
import { oauth2 } from '@connectors/engine/auth';
import { z } from 'zod';

export const github = defineProvider({
  id: 'github',
  displayName: 'GitHub',
  baseUrl: 'https://api.github.com',
  identityScopes: ['read:user'],
  auth: oauth2({
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
  }),
  identify: async (http) => {
    const me = await http.get<{ id: number; login: string }>('/user');
    return { accountId: String(me.id), label: me.login };
  },
});

export const issues = defineToolkit({
  id: 'github_issues',
  providerId: 'github',
  displayName: 'GitHub Issues',
  actions: [
    httpAction({
      id: 'github_issues.create',
      description: 'Open an issue.',
      mutating: true,
      risk: 'medium',
      scopes: ['repo'],
      input: z.object({ owner: z.string(), repo: z.string(), title: z.string(), body: z.string().optional() }),
      request: (i) => ({ method: 'POST', path: `/repos/${i.owner}/${i.repo}/issues`, body: { title: i.title, body: i.body } }),
      output: (j) => ({ number: (j as { number: number }).number }),
    }),
  ],
});
```

## Wiring a host

```ts
import { createConnectorRuntime, createRegistry, staticOAuthApps, createRedactor } from '@connectors/engine';
import { aesGcmSecretBox } from '@connectors/engine/crypto';
import { fileStore } from '@connectors/engine/store';
import { registerGoogle } from '@connectors/engine/google';

const registry = createRegistry();
registerGoogle(registry);

const store = fileStore({ dir: `${configDir}/connectors` });
const runtime = createConnectorRuntime({
  registry,
  store,
  authRequests: store,
  secretBox: aesGcmSecretBox({ key: keyFromConfig }), // encrypt-at-rest from day one
  oauthApps: staticOAuthApps({ google: { clientId, clientSecret, redirectUri } }),
  redactor: createRedactor(),
  // approval, onActionRun, clock, lock, logger — host-supplied (sensible defaults otherwise)
});
```

## Deliberately not built yet (later spec phases)

- **Phase 3** — deep app integration (chat-orchestrator wiring, connect UI, a
  SQLite `ConnectionStore` via the app query layer, bridging `ApprovalPolicy` to the
  app's permission prompts).
- Sync, webhooks, hosted multi-tenant adapters — seams, not builds (spec §16/§20).
- A full JSON-Schema→Zod conversion for ingested MCP tools (today the ingested input
  schema is a permissive object; the external server validates its own args).
