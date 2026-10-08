# @integrations/engine

A local-first, trust-first **integration engine**: a small, dependency-light runtime
that lets a human-plus-agent system take authenticated actions on a user's real
external accounts — and never silently leaks a token, drops a refresh, or runs a
side effect ungated.

> Implements [`docs/integrations-module-spec.md`](../../docs/integrations-module-spec.md).
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
- **Hosted provider MCPs**: the app can supply a trusted built-in identity to
  `ingestMcpServer`, retain connection IDs, and opt into upstream tool annotations.
  `ingestMcpServers` groups multiple accounts under the same canonical provider.
  It publishes their tool union, then validates and executes against the selected
  connection's schema and transport. Conflicting risk annotations use the more
  conservative classification. The host must hold account lifecycle locks during
  grouped ingestion. The client preserves full tool definitions and supports an
  `onToolsChanged` callback for refreshing discovery.
  The hosted catalog pins endpoint rules and auth modes. Most services use browser
  OAuth, GitHub and Zapier use encrypted bearer tokens, and Exa and Microsoft Learn
  support public access without credentials. Wrike uses a permanent access token.
  Migrated providers expose hosted vendor tools directly, with their native adapters
  retired and no compatibility aliases. Todoist's picker consumes its canonical
  hosted tools without adding old action names to the discovered surface. Atlassian
  provides one authorization for Jira and Confluence, with a canonical-tool Jira
  picker. Intercom asks for a supported region and n8n asks for an instance address.
  Robinhood, PostHog, PayPal and Docusign use official hosted services. PayPal and
  Docusign ask for a production or test environment, saved per connection.
  Webflow, WordPress.com, Fibery and DataForSEO use browser OAuth. monday.com supports personal
  and internal token-based connections. Smartsheet uses separate regional API tokens.
  MCP transport owns authentication while existing account/client scope pins remain
  enforced by the runtime. See [Todoist migration and host wiring](../../docs/todoist-mcp.md)
  and [implementation progress](../../docs/integration-implementation.md).
- **QuickBooks**: 13 read-only Accounting API actions cover queries, paginated
  invoices/customers and seven financial reports. Company identity and production
  or sandbox environment are verified and saved at connection time. See
  [setup and coverage](../../docs/integration-audit/quickbooks-implementation.md).

Run the suite: `pnpm --filter @integrations/engine test`.

## Adding a hosted integration

Add its official endpoint and authentication profile to
[`HOSTED_MCP_PROVIDERS`](src/providers/hosted-mcp.ts), its `method: 'mcp'` entry to
[`PROVIDER_CATALOG`](src/providers/index.ts), and its description/category to the
app's [`integration-meta.ts`](../../src/components/integrations/integration-meta.ts).
Vendor tools and schemas load through discovery after the user connects.

Define exactly one of `url` for a fixed endpoint or `endpoint` for configurable
setup. A `region` definition contains allowlisted `{ id, label, url }` choices
with no implicit default. It also supports environment choices such as PayPal's
production/sandbox and Docusign's production/demo. The label controls UI copy.
An `instance` definition contains its label, placeholder
and documented MCP path. The host validates input, constructs the endpoint and
stores it in the existing MCP server record. Settings and agent-requested connect
pages render these definitions automatically. Changing a saved endpoint requires
disconnecting first. Instance-selected servers do not inherit trusted vendor tool
annotations. See the [endpoint resolver](../../src/lib/integrations/hosted-endpoint.ts)
and [setup evidence](../../docs/integration-audit/fourth-wave-endpoints.md).

OAuth defaults to a public PKCE client with authorization-code and refresh grants.
Trusted catalog entries can declare a different grant list or `client_secret_post`
for a dynamically registered client. Per-install client secrets remain encrypted
in OAuth state.

Use `registration: 'registered'` for a vendor that requires a pre-registered OAuth
app. The current registered providers select `client_secret_basic` or
`client_secret_post`. Settings uses the existing encrypted OAuth app
registry and displays a stable `/api/integrations/mcp-oauth/builtin_<providerId>`
callback. The saved MCP connection is bound to the selected `authConfigId` until
disconnect, including during pending setup. This mode never attempts dynamic
registration. Vendor-specific consent parameters such as Dropbox offline access
come from the trusted catalog's `authorizationParams`, which cannot override core
OAuth security parameters. Discovered metadata and PKCE state are sealed with the
connection, while the registered secret stays in its original credential store.
No SQLite migration is needed. See the [registration evidence and prerequisites](../../docs/integration-audit/fifth-wave-provider-evidence.md).

For a verified service whose gateway rejects anonymous initialization without an
OAuth challenge, the trusted catalog can set `authorizeBeforeConnect: true`.
Interactive sign-in then calls `beginMcpOAuth` using standard SDK discovery before
opening a transport. Docusign uses this path with its registered integration key
and secret. Arbitrary HTTP 403 responses remain errors. See the
[Docusign profile and verification](../../docs/integration-audit/sixth-wave-docusign.md).

The same preauthorization path can set explicit catalog `scopes`. WordPress.com
uses `auth`, as documented for its MCP, instead of the broad REST scopes in its
resource metadata. The host passes those scopes explicitly to the SDK for initial
registration and consent. These profiles can refresh in the background, but a
missing/rejected client or a need for new consent returns to interactive setup.
Background recovery cannot silently register a replacement client with broader
resource scopes. See [WordPress.com verification](../../docs/integration-audit/seventh-wave-wordpress.md).

These declarations do not bypass vendor client-approval requirements.
Set `defaultMutationRisk: 'high'` for services with broad execution, infrastructure,
financial or external communication tools. The catalog-driven host tests exercise
each entry's matching setup flow and high-risk write policy.

## Authoring an integration (the DX)

```ts
import { defineProvider, defineToolkit, httpAction } from '@integrations/engine';
import { oauth2 } from '@integrations/engine/auth';
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
import { createIntegrationRuntime, createRegistry, staticOAuthApps, createRedactor } from '@integrations/engine';
import { aesGcmSecretBox } from '@integrations/engine/crypto';
import { fileStore } from '@integrations/engine/store';
import { registerGoogle } from '@integrations/engine/google';

const registry = createRegistry();
registerGoogle(registry);

const store = fileStore({ dir: `${configDir}/integrations` });
const runtime = createIntegrationRuntime({
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
