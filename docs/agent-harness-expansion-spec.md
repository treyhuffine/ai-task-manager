# Agent Harness Expansion: OpenCode and Cursor

Status: implemented in Agentex 0.0.28 and Flow, pending supported-binary UI smoke verification

Date: 2026-07-10

Revision: 2026-07-13 Flow implementation and release review reconciliation

Repositories:

- App: `~/dynamism/ai-task-manager`
- Agent runtime: `~/dynamism/agentex`

Review reconciliation:

- OpenCode generic API-key writes are supported through `PUT /auth/:id`
- The repository-pinned OpenCode 1.3.2 schema supports provider removal through `DELETE /auth/{providerID}`
- OAuth is a separate stateful flow and disconnect uses protocol-specific adapters plus a retryable app saga
- Durable history uses a new additive contract while the existing file-shaped contract remains source compatible
- OpenCode v1 exposes Allow once and Deny only because native `always` is project-instance scoped under pooling
- OpenCode history follows backward `before` pagination and commits provider-owned checkpoints only after event persistence
- Credential changes retire affected pooled runtimes so subsequent discovery and execution use the new generation
- Cursor resume attempts become live at a validated profile marker, currently the first matching `system:init` event
- SSE recovery, pending-request reconciliation, and unattended policy are explicit contracts
- Registry capabilities are maximums and installed-binary probes determine effective capabilities
- Cursor v1 deliberately uses CLI rather than the public-beta SDK
- Every pooled OpenCode server uses password authentication and fail-closed health startup
- Persistence, model availability, session mutation, Cursor rollover, and telemetry tasks incorporate the accepted review corrections
- Repeated OpenCode part IDs are persisted as cumulative replaceable parts, with tool calls and results assigned distinct source indexes
- Cursor and OpenCode credential changes recycle matching app-cached sessions after Agentex retires its runtime generation
- A degraded, missing, or upgrade-required binary reduces every effective runtime capability and cannot execute
- Cursor secrets are registered before process launch and provider events are deep-redacted before logs, telemetry, realtime, or SQLite
- OpenCode models are usable only while their upstream provider reports connected
- Invalid persisted defaults are repaired only for implicit legacy selections. Explicit invalid user selections remain errors
- Cursor and OpenCode have independent default-on emergency rollout switches
- Model-catalog cache identity hashes runtime env/config, binary version and protocol profile, and live OpenCode connection state without storing raw credentials
- Effort visibility derives from the registry reasoning-effort capability. Harness-specific fallback levels remain data rather than UI conditions
- Dynamic model and variant preservation is explicitly bounded by async catalog validation and the executor's repeated pre-launch validation

### Implementation status, 2026-07-13

Agentex 0.0.28 is installed from the registry with no workspace override. Flow now contains the four-harness registry, effective runtime probing, model discovery and allowlists, Cursor encrypted credentials, OpenCode provider configuration, executor integration, durable OpenCode history reconciliation, onboarding, settings, and composer support described by this specification.

Verification completed in Flow:

- Production build passed, including TypeScript and 105 generated application routes
- Targeted lint passed with no errors. One unrelated pre-existing unused-helper warning remains in `src/lib/db/queries.ts`
- 78 focused harness, event persistence, model, route, and executor tests passed
- Full suite passed with 97 test files and 783 tests. One file and five tests were skipped by their existing configuration
- `@agentex/agent` resolves to registry version 0.0.28 in `pnpm-lock.yaml`
- The migration was generated for new harness settings, operations, variants, and external history checkpoints

Remaining release verification:

- Run the Flow UI smoke path with a currently supported OpenCode binary
- Run the Flow UI smoke path with a Cursor binary that supports model listing and the required stream protocol
- The local verification host currently has Cursor 2025.09.18-7ae6800 and no OpenCode binary. Its Cursor profile should correctly report upgrade-required instead of executing

OpenCode resume command decision:

- OpenCode resume inside Flow is implemented through Agentex using the stored external session ID
- The settings and execution UI intentionally do not display a standalone OpenCode CLI resume command
- The current OpenCode adapter uses an authenticated service-backed lifecycle, and no equivalent truthful standalone CLI template is exposed by the public Agentex contract
- `resumeCommandTemplate: null` is therefore capability-honest, not an unfinished plumbing task

## 1. Executive summary

Expand the app from two selectable agent harnesses to four:

1. Claude Code
2. Codex
3. Cursor
4. OpenCode

Grok is not a separate harness. Cursor is the direct harness through which users can select Grok models. OpenCode may also expose Grok models through an xAI, OpenRouter, Vercel AI Gateway, or other upstream provider, but that remains an OpenCode model selection.

The product model is:

```text
Harness
  -> authentication and upstream provider configuration
  -> discovered model catalog
  -> user-enabled model allowlist
  -> default model and tuning
  -> per-chat harness and selection with capability-gated changes
```

The settings experience follows the useful parts of Conductor's design:

- Pick a harness tab
- Configure authentication or upstream providers
- Select a small model allowlist with searchable checkboxes
- Show only enabled models in normal composer menus
- Keep the full catalog behind settings
- Hide or disable controls the chosen harness cannot honor

The app-side work is primarily registry, persistence, API, and UI plumbing. The critical runtime work belongs in `agentex`:

- Runtime binary and protocol capability probing
- A provider-neutral durable history contract
- Authenticated OpenCode server lifecycle management
- OpenCode provider and model discovery
- OpenCode permission and question bridging
- OpenCode model variants and terminal result events
- Cursor multi-turn sessions over repeated headless processes and `--resume`
- Cursor current stream JSON parsing
- Cursor authentication and model discovery

This spec deliberately does not require every harness to reach Claude Code feature parity before launch. It does require every visible capability to be honest. Unsupported controls must be absent or clearly disabled.

## 2. Product decisions

These decisions are settled for this implementation.

### 2.1 Harnesses

The canonical app harness IDs are:

```ts
export type HarnessId = 'claude' | 'codex' | 'cursor' | 'opencode'
```

Do not add `grok` as a harness ID.

### 2.2 Grok access

Grok is available through Cursor when Cursor reports a Grok model in its catalog. The app does not hardcode Grok model IDs.

Grok may also appear in OpenCode under any configured upstream provider. These are separate selections because the harness behavior differs even when the underlying model family is similar.

Examples:

```text
Cursor harness   + Grok 4.5
OpenCode harness + xai/grok-4.5
OpenCode harness + openrouter/x-ai/grok-4.5
```

### 2.3 Provider terminology

Use these terms consistently:

- Harness: the coding agent runtime, such as Cursor or OpenCode
- Upstream provider: a model and credential source inside a harness, such as Anthropic inside OpenCode
- Model: the model identifier accepted by the selected harness
- Variant: an OpenCode model variant, separate from reasoning effort
- Effort: a harness-supported reasoning effort value
- Enabled model: a model the user selected for normal menus
- Catalog model: any model reported by the harness, whether enabled or not

Avoid calling Claude Code, Codex, Cursor, and OpenCode model providers. They are harnesses in this product.

### 2.4 Model allowlists

Every harness has an explicit user-selected model allowlist.

- Settings can browse the full discovered or fallback catalog
- Composer and new-chat menus show enabled models only
- On first setup, the app may preselect a small recommended set
- A user may deselect every model only when the harness is not the active default
- The active default harness must have at least one enabled and usable model
- Disappearing models are retained in settings as unavailable selections
- The app never silently replaces an unavailable selected model with another provider's model

### 2.5 Credential ownership

Prefer native harness credential stores.

- Claude Code owns Claude login credentials
- Codex owns Codex login credentials
- Cursor owns Cursor browser-login credentials
- OpenCode owns OpenCode upstream-provider credentials

For OpenCode, the app acts as a UI client for OpenCode's provider and auth server APIs. The app must not duplicate an OpenCode API key into SQLite.

Cursor settings offer native browser login first and an optional Cursor API key field. Cursor does not need a separate vendor-key form for every model in its catalog. Cursor owns the model routing behind the one Cursor credential.

When a user enters `CURSOR_API_KEY` through the app, store it through the existing AES-256-GCM secret infrastructure in a dedicated precious-local agent credential store. Inject it only into the Cursor process environment. Clearing the key deletes the sealed value. Never store plaintext secrets in `user_state`, application logs, query strings, process arguments, chat events, or analytics.

### 2.6 Provider switching

Changing the harness for an existing execution starts a new chat against the same execution and worktree. It does not mutate the harness of an existing chat.

Changing the model or tuning within the same harness may recycle and resume the current `AgentSession` only when the corresponding effective session-change capability is supported. Otherwise it starts a new same-harness chat. Resume support alone is insufficient.

### 2.7 Capability honesty

Each harness advertises granular capabilities. UI visibility and server validation derive from these capabilities rather than harness-name conditionals.

No UI control may imply support based only on a shared TypeScript field.

The app registry stores the maximum capabilities implemented by this product. Agentex probes the installed binary and protocol to produce effective capabilities. UI and request validation use the effective capabilities. An older binary can therefore be installed and authenticated while still requiring an upgrade for discovery, modes, permissions, or another feature.

### 2.8 No static all-provider OpenCode catalog

Do not maintain a bundled list of every OpenCode model. OpenCode supports custom providers, local models, user configuration, and frequent catalog changes.

The bundled app catalog is only a small offline fallback for Claude and Codex. OpenCode and Cursor depend on live discovery, with persisted unavailable selections for offline continuity.

### 2.9 Cursor transport

Cursor v1 uses the Cursor CLI transport, not `@cursor/sdk`.

Reasons:

- Native Cursor browser login is a product requirement
- The CLI can use the user's existing local Cursor account
- The SDK requires a Cursor API key and uses separate token-based billing
- Agentex already has a Cursor CLI provider and session codec
- The SDK is public beta and introduces a second persistence and event contract

Do not switch between CLI and SDK based on credential type. If an SDK transport is added later, persist the transport on the chat and treat its session format and capabilities as a separate runtime profile.

## 3. Goals

### 3.1 User goals

- Select Claude Code, Codex, Cursor, or OpenCode as the default harness
- Connect each harness using its supported authentication methods
- Configure OpenCode upstream providers from the app
- Search the full model catalog in settings
- Check only the models that should appear during daily use
- Select Grok through Cursor when Cursor exposes it
- Choose a default model and supported tuning per harness
- Start and resume real multi-turn execution chats on all four harnesses
- See assistant text, tool activity, errors, and terminal results consistently
- Receive and answer permission or question requests where the harness supports them
- Understand when a capability is unavailable

### 3.2 Engineering goals

- Replace scattered two-provider unions and fallbacks with one harness registry
- Prevent unknown harness IDs from silently mapping to Claude
- Keep provider-specific runtime behavior inside `agentex`
- Keep user preference and presentation behavior inside the app
- Preserve existing Claude and Codex behavior
- Make model discovery context-aware and cacheable
- Keep secrets confined to native stores or encrypted precious-local storage
- Add real-binary tests for OpenCode and Cursor
- Support incremental rollout behind feature flags

## 4. Non-goals

The first production release does not require:

- A standalone Grok Build harness
- Uniform quota probing across every OpenCode upstream provider
- True mid-turn concurrent send for Cursor or OpenCode
- Per-background-task stopping where the harness exposes no task control
- Cloud execution of local harnesses
- Editing arbitrary OpenCode provider JSON by hand in the app
- A universal provider marketplace
- Strict MCP isolation for Cursor in the first release
- Automatic enablement of every newly discovered model
- Cross-harness conversation resume
- Model fallback chains between different model IDs

## 5. Current state

### 5.1 App

The app currently supports Claude and Codex in product surfaces.

Important constraints:

- `ProviderId` is `'claude' | 'codex'`
- Internal agent harness values are `'claude_code' | 'codex'`
- `user_state.defaultAgentHarness` is typed for Claude and Codex only
- Agent model, auth, and verify routes hardcode allowlists
- Onboarding hardcodes two harness cards
- New-chat and document-chat routes accept only Claude and Codex
- Several fallbacks treat every non-Codex value as Claude
- Model validation assumes Claude aliases or OpenAI-style Codex IDs
- Reconciliation supports only Claude and Codex
- Permission-mode UI assumes Claude-shaped semantics
- Settings renders every model in a flat all-harness list

Primary app files include:

- `src/lib/agent-options.ts`
- `src/lib/agent-model-discovery.ts`
- `src/lib/executor/harness.ts`
- `src/lib/executor/adapter.ts`
- `src/lib/executor/reconcile.ts`
- `src/lib/sessions/dispatch.ts`
- `src/lib/db/schema.ts`
- `src/lib/db/queries.ts`
- `src/app/api/agent/*`
- `src/app/api/orchestrator-chat/route.ts`
- `src/app/api/document-chat/route.ts`
- `src/app/api/sessions/[id]/*`
- `src/components/settings/*`
- `src/components/executions/*`
- `src/app/welcome/_components/*`

### 5.2 Agentex OpenCode

The OpenCode provider has real core execution support:

- One-shot `opencode run`
- Multi-turn sessions through `opencode serve`
- Session resume by OpenCode session ID
- Assistant, thinking, tool-call, and tool-result events
- Turn interrupt
- Token and cost data returned in `TurnResult`

Declared gaps include:

- No model discovery
- No quota probing
- No MCP configuration contract
- No plan mode or mode discovery
- No concurrent send
- No queued-message cancellation
- No per-task stop

Implementation gaps that are more important than the declared flags:

- The pooled OpenCode server has no Basic authentication
- Server health timeout currently returns success instead of throwing and cleaning up
- Session code does not bridge OpenCode permission events
- Session code does not bridge OpenCode question events
- Session code does not emit a terminal normalized `result` event
- One-shot parsing emits a normalized `result` for every `step_finish` rather than one terminal result
- Session code ignores `ProviderConfig.effort`
- Session code has no separate model variant field
- Session code ignores configured `skillDirs`
- Auth detection checks only OpenAI and Anthropic environment keys
- No structured upstream provider manager is exposed to the app
- No durable catch-up or transcript facade is exposed

### 5.3 Agentex Cursor

The Cursor provider is currently one-shot:

- `capabilities.sessions` is false
- `capabilities.modelDiscovery` is false
- `createSession` is absent

Useful behavior already exists:

- Headless stream JSON execution
- `--resume` support in the one-shot executor
- Session ID extraction
- Explicit `--model`
- Skill injection
- Instructions
- Workspace preparation and child-process cwd selection
- Unknown-session retry

Important gaps:

- The app requires `createSession` for chat execution
- Current Cursor stream JSON uses top-level tool-call events that the parser does not fully normalize
- Current argv passes undocumented `--workspace` and obsolete `--yolo` flags
- Cursor now exposes model discovery through `agent models` or `--list-models`
- Auth detection should use the selected Cursor binary's `status` command and native login state
- Cursor modes should expose Agent, Plan, and Ask where supported
- No durable catch-up facade exists
- Permission behavior in headless mode needs versioned live validation
- The locally installed `cursor-agent` is an older profile that has resume and model flags but no model-listing or mode flags

## 6. Target capability model

Replace broad booleans in app code with a granular maximum and effective capability view.

```ts
export interface HarnessCapabilitySet {
  sessions: boolean
  resume: boolean
  durableCatchUp: boolean
  modelDiscovery: boolean
  upstreamProviders: boolean
  upstreamProviderDisconnect: boolean
  modelVariants: boolean
  reasoningEffort: boolean
  permissionRequests: boolean
  questionRequests: boolean
  planMode: boolean
  modes: boolean
  mcpAttachment: boolean
  strictMcpIsolation: boolean
  skills: boolean
  concurrentSend: boolean
  cancelQueuedMessage: boolean
  stopTask: boolean
  usage: boolean
  cost: boolean
  sessionModelChange: boolean
  sessionVariantChange: boolean
  sessionEffortChange: boolean
  sessionModeChange: boolean
}

export type CapabilityStatus =
  | 'supported'
  | 'missing'
  | 'upgrade_required'
  | 'degraded'

export interface BinaryCompatibility {
  status: CapabilityStatus
  command: string | null
  version: string | null
  protocolProfile: string | null
  reason?: string
}

export interface EffectiveHarnessCapabilities {
  maximum: HarnessCapabilitySet
  effective: HarnessCapabilitySet
  statusByCapability: Partial<Record<keyof HarnessCapabilitySet, {
    status: CapabilityStatus
    reason?: string
  }>>
  binary: BinaryCompatibility
}
```

The registry owns `maximum`. Agentex feature probes own `effective`. Effective capability values may only equal or reduce the maximum values.

Initial maximum production matrix after the planned Agentex work:

| Capability | Claude | Codex | OpenCode | Cursor |
|---|---:|---:|---:|---:|
| Multi-turn session | Yes | Yes | Yes | Yes |
| Resume | Yes | Yes | Yes | Yes |
| Durable catch-up | Yes | Yes | Yes | No |
| Live model discovery | No | Yes | Yes | Yes |
| Upstream provider setup | No | No | Yes | No |
| Upstream provider disconnect | No | No | Yes | No |
| Arbitrary variants | No | No | Yes | No |
| Reasoning effort | Yes | Yes | No | No |
| Permission requests | Yes | Yes | Yes | No |
| Question requests | Yes | Yes | Yes | No |
| Plan mode | Yes | Yes | Yes | Yes |
| App MCP attachment | Yes | No | No | No |
| Strict MCP isolation | Yes | No | No | No |
| Concurrent send | Yes | Yes | No | No |
| Cancel queued message | Yes | No | No | No |
| Stop one task | Yes | No | No | No |
| In-chat model change | Yes | Yes | Yes | No |
| In-chat variant change | No | No | Yes | No |
| In-chat effort change | Yes | Yes | No | No |
| In-chat mode change | Yes | Yes | Yes | No |

This table is a build contract, not an assumption about any installed binary. Runtime probes must downgrade unsupported features. In particular, Cursor discovery, Plan, and Ask remain unavailable until the installed binary advertises and passes the corresponding probes. OpenCode variants remain available independently of reasoning effort.

The app-level `durableCatchUp` value is true when Agentex reports either the legacy file-shaped `durableSessions` capability or the new provider-neutral `durableHistory` capability. The app prefers `attachHistory` when present and keeps existing reconciliation paths during migration.

Required probe inputs:

- Binary presence and version
- Help output and command success for CLI-only features
- OpenCode `GET /doc` schema and authenticated endpoint probes
- Cursor model-listing and mode commands
- Supported stream protocol fixture profile
- Auth status command compatibility

Do not infer support from version alone when a direct non-mutating feature probe exists.

Minimum-support policy:

- Maintain a release manifest of real-binary versions and protocol profiles tested by Agentex
- OpenCode is enableable only when authenticated server startup, health, sessions, provider listing, model listing, and event streaming pass
- Cursor is enableable only when stream JSON, resume, model listing, status, model selection, and force behavior pass
- Cursor Plan and Ask are optional effective capabilities and do not determine basic harness usability
- A binary outside the tested manifest may still be supported when all required feature probes match a known protocol profile
- A binary missing a required feature is `upgrade_required`, not silently downgraded to a static catalog
- A binary with an unexpected endpoint or event shape is `degraded` and cannot start new chats until verified

### 6.1 Scope and relative size

Relative sizing describes implementation risk and review surface, not calendar estimates.

- `S`: localized implementation with an established contract
- `M`: several modules or a new adapter with bounded protocol work
- `L`: cross-repository behavior, lifecycle handling, or security-sensitive integration
- `XL`: depends on an upstream interface that is missing or unstable

The app changes are mostly plumbing, but they are broad plumbing. The registry, validation, database migration, APIs, settings UI, composer filtering, and onboarding are each conventional changes. The risk comes from making the same selection tuple consistent across every entry point and from eliminating silent Claude fallbacks. Treat the app track as `L` in total even though most individual tasks are `S` or `M`.

The larger work is in Agentex:

- Effective capability probing is `M` because the app must distinguish missing, upgrade-required, and degraded features
- Generalizing durable history is `L` because existing contracts assume files and byte offsets
- OpenCode server authentication is `M` and launch-blocking
- OpenCode discovery and provider auth are `L` because they add a security-sensitive configuration API and version compatibility
- OpenCode permission and question bridging are `L` because a missed event can leave a turn blocked
- OpenCode terminal result and variant plumbing are `S` to `M`
- OpenCode durable catch-up is `L` because it needs stable IDs, checkpoints, and idempotency
- Cursor session support is `L` because a one-process-per-turn CLI must behave like an `AgentSession`
- Cursor stream parser, model discovery, auth detection, and modes are each `M`
- The model allowlist UI is `M`, with virtualization and unavailable-model behavior carrying most of the complexity

### 6.2 Disposition of current `No` capabilities

| Current gap | Can we fix it | First-release decision | Size | Primary owner |
|---|---|---|---:|---|
| OpenCode model discovery | Yes | Implement | M | Agentex |
| OpenCode upstream provider and auth management | Yes | Implement API key and OAuth flows, gate disconnect by runtime support | L | Agentex and app |
| OpenCode permission requests | Yes | Implement | L | Agentex |
| OpenCode question requests | Yes | Implement | L | Agentex |
| OpenCode terminal result event | Yes | Implement | S | Agentex |
| OpenCode model variants | Yes | Implement | S | Agentex and app |
| OpenCode agent and plan modes | Yes | Implement when reported | M | Agentex and app |
| OpenCode app-managed skills | Yes | Implement | M | Agentex |
| OpenCode durable catch-up | Yes | Generalize Agentex history first, then implement before default enablement | L | Agentex and app |
| OpenCode MCP attachment | Partly | Harden after core chat works | L | Agentex and app |
| OpenCode strict MCP isolation | Unknown until proven | Keep false until a proving test passes | XL | Agentex |
| OpenCode native concurrent send | Not from the current stable contract | Reject overlap and use an app queue | XL | Upstream and Agentex |
| OpenCode native queued-message cancellation | Not from the current stable contract | Support app-queue cancellation only | XL | Upstream and Agentex |
| OpenCode per-task stop | Not from the current stable contract | Defer | XL | Upstream |
| Uniform OpenCode quota probing | Not reliably | Defer provider-specific quota UI | XL | Upstream providers |
| Cursor multi-turn sessions | Yes | Implement over repeated `--resume` processes | L | Agentex |
| Cursor current stream event normalization | Yes | Implement | M | Agentex |
| Cursor model discovery | Yes | Implement | M | Agentex |
| Cursor auth detection | Yes | Implement | S | Agentex and app |
| Cursor Agent, Plan, and Ask modes | Yes | Implement | M | Agentex and app |
| Cursor interactive permission bridge | Not from the current headless contract | Keep false and prove no hidden prompt hangs | XL | Upstream and Agentex |
| Cursor durable catch-up | Not from a stable export contract | Keep false in first release | XL | Upstream and Agentex |
| Cursor app-scoped MCP isolation | Not proven | Keep false in first release | XL | Agentex |
| Standalone Grok harness | Not applicable | Do not build by product decision | None | App |

Additional launch blockers:

- OpenCode server authentication and fail-closed health startup
- Effective binary and protocol capability reporting
- Permission reply scope and unattended policy
- Cursor CLI transport ADR and a prohibition on implicit SDK switching

The launch-critical path is the shared Agentex contract milestone, then the app registry and persistence foundation, authenticated OpenCode runtime parity and durable history, Cursor resumable sessions, and real-binary verification. MCP isolation and capabilities that require missing upstream interfaces must not block the first release.

## 7. Target settings experience

### 7.1 Harness settings page

Render a `Harnesses` section with tabs:

```text
Claude Code | Codex | Cursor | OpenCode
```

Each tab has the same outer structure:

1. Harness summary and documentation link
2. Installation and authentication status
3. Providers, only when the harness has an upstream-provider layer
4. Enabled models
5. Default model and tuning
6. Advanced settings

The tab content derives from the harness registry and capabilities.

### 7.2 Harness status

Show these states:

- Not installed
- Installed, upgrade required
- Installed, degraded capability profile
- Installed, authentication unknown
- Installed, not authenticated
- Connected through native login
- Connected through API key
- Connected with one or more upstream providers
- Verification failed
- Verification succeeded

Do not reduce all authentication to subscription versus API key. OpenCode may have several connected upstream providers. Cursor may use native account login while still exposing many vendor models.

### 7.3 OpenCode provider section

Only OpenCode initially renders a provider section.

Summary example:

```text
Providers 3 configured
[Add provider]
```

The provider picker behavior:

- Search input at top
- Curated common providers shown first
- Expandable provider rows
- `View all providers` reveals the complete OpenCode-reported list
- Connected rows show a connected badge
- Show disconnect only when the effective OpenCode protocol profile exposes a safe programmatic disconnect
- When disconnect is unavailable, show the `opencode auth logout` instruction without pretending the app can perform it
- API-key methods use a standard write-only API-key form
- OAuth methods render safe text and select prompts reported by OpenCode
- Secret values are write-only
- Saving never echoes the secret back to the client
- A successful save refreshes provider state and the model catalog

Initial curated provider order:

1. OpenCode Go or OpenCode Zen
2. OpenAI
3. Anthropic
4. xAI
5. Google
6. GitHub Copilot or GitHub Models
7. Vercel AI Gateway
8. OpenRouter

Do not hardcode this as the only supported list. It is presentation ordering over OpenCode-reported providers.

### 7.4 Enabled models section

Summary example:

```text
Models 5 selected
[Manage models]
```

The model picker:

- Search by model name, model ID, and upstream provider name
- Group by upstream provider when the catalog supplies one
- Checkbox per model
- Show enabled models first inside each group
- Show non-available persisted selections in groups by status and reason
- Show variant and capability metadata only after expanding a row
- Do not render thousands of models into the page before the modal opens
- Virtualize when the catalog exceeds 200 rows
- Preserve keyboard navigation
- Save checkbox changes atomically

For OpenCode, model IDs remain full opaque IDs such as `provider/model`.

For Cursor, model IDs are exactly the identifiers accepted by the selected Cursor binary's `--model` option. Grok appears as an ordinary Cursor model when discovered.

### 7.5 Defaults and tuning

Each harness settings row stores a preferred default among its enabled models.

Rules:

- Enabling the first model makes it the harness default
- Disabling the default chooses the first remaining enabled model after confirmation
- Disabling the final model is rejected when this is the global default harness
- A default model must be enabled
- OpenCode variant is stored separately from effort
- Unsupported effort or variant values are preserved on historical chats but cannot be newly selected
- Model catalog defaults are suggestions, not forced replacements

### 7.6 Composer model menu

The composer menu changes from a flat all-catalog list to:

- Current harness section with enabled models
- Other harness sections with enabled models and a `new chat` marker
- Connection status per harness
- No full-catalog search
- A `Manage models` link to settings

Selecting a different harness starts a new chat against the same execution.

Selecting a model or tuning within the current harness updates and recycles the session only when the corresponding effective session-change capability is supported. Otherwise it starts a new chat in the same harness and execution. Resume support alone never implies that model, variant, effort, or mode can change safely.

### 7.7 Onboarding

Onboarding shows the same four harness choices but keeps setup concise:

1. Pick harness
2. Verify installation and authentication
3. Discover catalog
4. Preselect a recommended small model set
5. Pick a default

OpenCode onboarding includes an optional `Add provider` action before model selection.

Cursor onboarding treats Grok as a model, not as a separate card.

### 7.8 Error and offline states

- Catalog discovery failure uses persisted enabled models and marks the catalog stale
- Missing binary keeps settings readable and disables verification
- Disconnected OpenCode provider does not delete its enabled model selections
- A selected model missing from the latest catalog is shown with a specific availability status and reason
- Sending with an unavailable model fails before chat creation with a specific action message
- An installed but unsupported binary shows an upgrade action and does not expose unproven controls
- Unknown harness IDs return a validation error and never fall back to Claude
- Permission bridge failure interrupts the OpenCode turn rather than leaving it blocked indefinitely

### 7.9 Provider disconnect and default validity

Before an in-app provider disconnect, calculate the enabled and default models that would become unusable.

- If the provider does not affect the global default selection, retain its models as disconnected selections after successful deletion
- If it affects the global default, require a replacement harness and enabled model before deletion
- Never silently choose a different harness or model
- If credentials disappear outside the app, retain the configured default but mark it unusable and block new sends until the user reconnects or chooses a replacement

SQLite settings and OpenCode's credential store cannot share one transaction. Use a recoverable saga:

1. Validate the replacement selection and effective capabilities
2. In one SQLite transaction, install the valid replacement and insert a pending disconnect operation
3. Interrupt and retire affected OpenCode sessions and pool instances
4. Perform idempotent credential deletion through the selected protocol adapter
5. On success, mark the operation complete and refresh provider and model state against a new pool generation
6. On failure, mark the operation failed, retain the safe replacement, leave credentials connected, and expose retry
7. A retry resumes the same operation ID and treats already-absent credentials as success

Safety favors leaving credentials connected over leaving the active default unusable.

## 8. App architecture

### 8.1 Harness registry

Create a single app registry that owns identity and presentation metadata.

Suggested file:

```text
src/lib/agents/registry.ts
```

Suggested shape:

```ts
export interface HarnessDefinition {
  id: HarnessId
  agentexProviderId: 'claude' | 'codex' | 'cursor' | 'opencode'
  agentRecordHarness: 'claude_code' | 'codex' | 'cursor' | 'opencode'
  name: string
  description: string
  installHint: string
  loginCommand: string | null
  docsUrl: string
  maximumCapabilities: HarnessCapabilitySet
  offlineModels: ModelOption[]
}

export const HARNESS_REGISTRY: Record<HarnessId, HarnessDefinition>
```

Required helpers:

```ts
isHarnessId(value: unknown): value is HarnessId
getHarnessDefinition(id: HarnessId): HarnessDefinition
harnessIdFromAgentRecord(value: string): HarnessId
agentRecordHarness(id: HarnessId): string
agentexProviderId(id: HarnessId): string
```

All mappings must be exhaustive. No helper may use `condition ? codex : claude` for provider selection.

### 8.2 Effective capability service

Add a server-only service that combines registry maximums with Agentex runtime probes.

```ts
getEffectiveHarnessCapabilities(input: {
  harness: HarnessId
  workspaceId?: string
  refresh?: boolean
}): Promise<EffectiveHarnessCapabilities>
```

Rules:

- Cache by harness, binary command, version, cwd context, and protocol profile
- Never cache a successful probe across a binary-version change
- Treat missing optional features as `upgrade_required` when they are required for enabling the harness
- Treat endpoint or stream-shape mismatch as `degraded`
- Keep authentication status separate from binary compatibility
- Expose reasons safe for the settings UI
- Never probe by running a mutating agent turn

For OpenCode, inspect the authenticated `GET /doc` schema and probe required read-only endpoints. For Cursor, inspect help output and run bounded read-only commands such as status and model listing.

### 8.3 Catalog types

Use a richer model type without requiring every provider to populate every field.

```ts
export interface ModelVariantOption {
  id: string
  label: string
  description?: string
  isDefault?: boolean
  disabled?: boolean
}

export interface HarnessModelOption {
  id: string
  label: string
  description?: string
  upstreamProviderId?: string
  upstreamProviderName?: string
  variants?: ModelVariantOption[]
  supportedEfforts?: string[]
  defaultEffort?: string
  contextWindow?: number
  maxOutputTokens?: number
  inputCostPerMillion?: number
  outputCostPerMillion?: number
  supportsImages?: boolean
  supportsTools?: boolean
  availability: {
    status:
      | 'available'
      | 'provider_disconnected'
      | 'model_removed'
      | 'binary_unsupported'
      | 'catalog_stale'
    reason?: string
  }
}

export interface HarnessCatalogResponse {
  harness: HarnessId
  source: 'provider' | 'cli' | 'fallback' | 'persisted'
  fetchedAt: string
  stale: boolean
  providers?: UpstreamProviderSummary[]
  models: HarnessModelOption[]
}
```

### 8.4 Model selection tuple

The provider boundary receives one validated tuple:

```ts
export interface AgentSelection {
  harness: HarnessId
  agentRecordHarness: string
  providerId: string
  model: string
  variant: string | null
  effort: string | null
}
```

Validation rules are harness-specific and capability-driven.

- Claude accepts known aliases and valid discovered IDs
- Codex accepts catalog-backed models and preserved historical IDs
- OpenCode accepts catalog-backed full IDs for new selections
- Cursor accepts catalog-backed IDs for new selections
- Historical IDs remain readable even after catalog removal
- Cross-harness model IDs never carry over during harness switching

### 8.5 Catalog cache

Cache discovery by effective runtime context:

```text
harness ID
working directory or global-settings context
command override
environment/config fingerprint
harness binary version
```

Defaults:

- Success TTL: 15 minutes
- Failure TTL: 30 seconds
- Manual refresh bypasses cache
- Provider credential changes invalidate OpenCode cache
- Binary version changes invalidate that harness cache

Never include raw secret values in a cache key or log. Hash the relevant environment overlay when separation is required.

### 8.6 Capability-driven executor config

`src/lib/executor/adapter.ts` must build provider config through a harness adapter rather than directly applying Claude flags.

Suggested interface:

```ts
interface HarnessSessionConfigBuilder {
  build(input: {
    selection: AgentSelection
    permissionMode: PermissionMode
    sessionType: ChatSessionType
    workspaceId: string | null
    cwd: string
    effectiveCapabilities: HarnessCapabilitySet
  }): Promise<ProviderConfig>
}
```

Rules:

- Claude permission modes continue using native Claude behavior
- Codex permission and modes continue using Codex behavior
- OpenCode variant and agent mode use OpenCode-specific typed config
- Cursor plan mode uses Cursor mode configuration
- Unsupported fields are not passed and are not shown in UI
- In-chat model, variant, effort, and mode changes are validated independently
- App-managed connectors attach only when the harness advertises the required MCP capability
- Strict connector scoping fails closed when strict isolation is required but unavailable

## 9. Persistence and migration

### 9.1 New `agent_harness_settings` table

Add one row per local user and harness.

```ts
export const agentHarnessSettings = sqliteTable(
  'agent_harness_settings',
  {
    id: text().primaryKey(),
    ...timestamps,
    userId: text().notNull().default('local'),
    harness: text().notNull(),
    enabledModelIds: text({ mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    defaultModel: text(),
    defaultVariant: text(),
    defaultEffort: text(),
    catalogRefreshedAt: text(),
  },
  (table) => [
    uniqueIndex('agent_harness_settings_user_harness_uq')
      .on(table.userId, table.harness),
  ],
)
```

The exact TypeScript formatting may follow repository conventions. The table must follow the shared timestamp rule.

Why a table instead of more singleton JSON on `user_state`:

- One natural row per harness
- Independent updates do not rewrite all harness preferences
- Future per-user support has an obvious key
- Model allowlists remain compact JSON rather than one row per catalog model
- Catalog models are not persisted as product truth

### 9.2 `user_state`

Expand `defaultAgentHarness` to:

```text
claude | codex | cursor | opencode
```

Keep these existing fields during migration:

- `defaultAgentModel`
- `defaultAgentEffort`

`user_state.defaultAgentHarness` is the source of truth for the active harness. `agent_harness_settings` is the source of truth for that harness's default model, variant, effort, and allowlist.

Keep `defaultAgentModel` and `defaultAgentEffort` only as compatibility mirrors while old call sites are migrated. Update them transactionally from the active harness settings row. Do not add `defaultAgentVariant` to `user_state` because that would create another duplicated global tuple field.

### 9.3 `chat_sessions`

Add:

- `modelVariant`, nullable text

Keep `model` and `effort` for backward compatibility.

Every new chat must persist an explicit model. Variant and effort may be null when unsupported.

### 9.4 Migration backfill

For existing users:

1. Create a Claude settings row with the existing Claude fallback models enabled
2. Create a Codex settings row with the current Codex fallback models enabled
3. If `user_state.defaultAgentHarness` and legacy model are set, ensure that model is enabled and defaulted in its harness row
4. Do not create Cursor or OpenCode enabled-model selections until discovery or onboarding occurs
5. Leave existing chat `modelVariant` null
6. Preserve all existing chat model and effort values
7. Mirror the active harness row back to legacy `defaultAgentModel` and `defaultAgentEffort` fields in the same transaction

Migration must be idempotent at the query/helper level because local databases can skip onboarding paths.

### 9.5 Query functions

Add shared query functions in `src/lib/db/queries.ts`:

```ts
getAgentHarnessSettings(harness: HarnessId)
listAgentHarnessSettings()
upsertAgentHarnessSettings(input)
setEnabledHarnessModels(harness, models)
setHarnessDefaultSelection(harness, selection)
setActiveHarness(harness)
```

Route handlers must use these functions and must not write raw SQL.

`setActiveHarness` must validate that the target harness has an enabled and usable default, update `defaultAgentHarness`, and mirror the target row's model and effort into legacy fields in one transaction.

### 9.6 Agent harness operations

Persist cross-store operations that require retry.

```ts
export const agentHarnessOperations = sqliteTable('agent_harness_operations', {
  id: text().primaryKey(),
  ...timestamps,
  harness: text().notNull(),
  operation: text({ enum: ['disconnect_upstream_provider'] }).notNull(),
  upstreamProviderId: text().notNull(),
  status: text({ enum: ['pending', 'completed', 'failed'] }).notNull(),
  replacementHarness: text(),
  replacementModel: text(),
  lastErrorCode: text(),
})
```

The table contains no credentials, provider tokens, auth bodies, or raw error messages. Retain completed and failed rows for diagnostics and idempotent retry. A later cleanup policy may compact old completed operations.

Required queries:

```ts
beginProviderDisconnectSaga(input)
completeProviderDisconnectSaga(operationId)
failProviderDisconnectSaga(operationId, safeErrorCode)
getProviderDisconnectSaga(operationId)
listRetryableProviderDisconnectSagas()
```

## 10. API contracts

### 10.1 List harnesses

```text
GET /api/agent/harnesses
```

Response:

```ts
interface HarnessSummary {
  id: HarnessId
  name: string
  installed: boolean
  connectionStatus: 'connected' | 'not_connected' | 'unknown'
  capabilities: EffectiveHarnessCapabilities
  enabledModelCount: number
  defaultModel: string | null
}
```

### 10.2 Catalog

```text
GET /api/agent/models?harness=<id>&workspaceId=<optional>&refresh=<optional>
```

Response is `HarnessCatalogResponse`.

Validation:

- Reject unknown harness IDs
- Resolve workspace cwd only after validating workspace access
- Do not accept arbitrary cwd from the client
- `refresh=true` bypasses provider and app caches

### 10.3 Enabled models

```text
PUT /api/agent/models/enabled
```

Request:

```ts
{
  harness: HarnessId
  modelIds: string[]
  defaultSelection?: {
    model: string
    variant?: string | null
    effort?: string | null
  }
}
```

Behavior:

- Validate every newly enabled model against the live catalog when available
- Permit already-persisted unavailable models to remain checked
- Reject duplicates
- Require the default model to be present in `modelIds`
- Validate default variant and effort against effective capabilities and catalog metadata
- Update settings atomically
- Return the normalized settings row

### 10.4 Harness auth and verification

Keep the existing routes but generalize their response model.

```text
POST /api/agent/auth
POST /api/agent/verify
```

Auth response must support multiple paths:

```ts
interface HarnessConnectionReport {
  harness: HarnessId
  binary: BinaryCompatibility
  usable: boolean
  methods: Array<{
    id: string
    kind: 'native_login' | 'api_key' | 'oauth' | 'upstream_provider'
    label: string
    present: boolean
    metered?: boolean
  }>
  identity?: {
    email?: string
    plan?: string
  }
  upstreamProviderCount?: number
}
```

Do not make `hasSubscription`, `hasApiKey`, or `hasBedrock` the universal client abstraction. They may remain compatibility fields during migration.

Cursor credential writes use explicit actions on the auth route or dedicated nested routes:

```text
PUT    /api/agent/cursor/api-key
DELETE /api/agent/cursor/api-key
```

`PUT` accepts the key once, seals it immediately in precious-local storage, registers it with the runtime redactor, and returns only presence metadata. `DELETE` removes the sealed key and clears relevant auth and model caches. Execution and discovery open the key only long enough to construct a `CURSOR_API_KEY` environment overlay.

Verification chooses an enabled cheap model when possible. If no model is enabled, verification may use the harness default without persisting it.

### 10.5 OpenCode upstream providers

```text
GET    /api/agent/opencode/providers
GET    /api/agent/opencode/providers/:providerId/auth-methods
PUT    /api/agent/opencode/providers/:providerId/api-key
POST   /api/agent/opencode/providers/:providerId/oauth/begin
POST   /api/agent/opencode/providers/:providerId/oauth/complete
DELETE /api/agent/opencode/providers/:providerId/auth
```

All routes delegate to `agentex` OpenCode configuration APIs.

Backend behavior:

- API-key writes use OpenCode's documented `PUT /auth/:id` server endpoint
- OAuth begin uses the provider authorize endpoint and returns a redacted flow record
- OAuth complete uses the provider callback endpoint and an app-issued flow ID
- Do not expose OpenCode's provider method index as the app flow identity
- Flow IDs are random, single-use, expire after 10 minutes, and are bound to provider, cwd context, protocol profile, and pooled server instance
- Code-based flows accept the user-returned code and automatic browser flows complete without a code
- A process restart expires in-memory auth flows and returns a typed restart-required response
- Disconnect is enabled only when the effective protocol profile exposes a safe programmatic removal operation
- The tested `opencode-ai@1.3.2` profile removes provider credentials through `DELETE /auth/{providerID}`
- A newer credential-ID profile removes credentials through `DELETE /api/credential/{credentialID}` after resolving the credential that belongs to the provider
- The binary-generated authenticated OpenAPI schema is runtime authority when prose documentation is incomplete
- When disconnect is unsupported, return `409 disconnect_unsupported` and show `opencode auth logout` guidance
- Do not directly edit OpenCode's auth file in v1

Secret handling requirements:

- Auth request body is never logged
- Response never includes submitted credentials
- Error messages are redacted
- Rate-limit repeated failed auth writes
- Retire or restart affected OpenCode pool instances after successful credential mutation
- Invalidate model and connection caches after pool retirement
- When the DELETE route is enabled, it means disconnect through OpenCode's native credential store
- Disconnect runs through the recoverable saga in section 7.9

### 10.6 Chat mutation

Generalize these inputs:

```ts
{
  harness?: HarnessId
  model?: string
  variant?: string | null
  effort?: string | null
}
```

Affected APIs include:

- New execution chat
- Orchestrator chat
- Document chat
- Session model update
- Default harness update

Every route calls the same async selection validator.

For an existing chat, the validator also checks the effective `sessionModelChange`, `sessionVariantChange`, `sessionEffortChange`, and `sessionModeChange` capabilities. Unsupported changes create a new same-harness chat rather than mutating or resuming the current one.

## 11. Agentex public contract changes

### 11.1 Context-aware model discovery

Expand the model discovery options:

```ts
export interface ListModelsOptions {
  cwd?: string
  env?: Record<string, string>
  config?: ProviderConfig
  cacheTtlMs?: number
  refresh?: boolean
}
```

Expand `ProviderModel` additively:

```ts
export interface ProviderModel {
  id: string
  name: string
  provider?: string
  providerName?: string
  variants?: Array<{
    id: string
    name: string
    description?: string
    isDefault?: boolean
    disabled?: boolean
  }>
  supportedEfforts?: string[]
  defaultEffort?: string
  contextWindow?: number
  maxOutputTokens?: number
  inputCostPerMillion?: number
  outputCostPerMillion?: number
  supportsImages?: boolean
  supportsTools?: boolean
}
```

Existing consumers remain compatible because all new fields and options are optional.

### 11.2 Model variant

Add a provider-neutral optional field:

```ts
export interface ProviderConfig {
  model?: string
  modelVariant?: string
  effort?: string
}
```

Providers ignore unsupported fields. OpenCode must send `modelVariant` through its message request as the native variant value.

### 11.3 Upstream provider manager

Add an optional provider configuration surface:

```ts
export interface UpstreamProviderManager {
  list(ctx?: ProviderRuntimeContext): Promise<UpstreamProvider[]>
  authMethods(
    providerId: string,
    ctx?: ProviderRuntimeContext,
  ): Promise<ProviderAuthMethod[]>
  setApiKey(
    providerId: string,
    key: string,
    ctx?: ProviderRuntimeContext,
  ): Promise<void>
  beginOAuth(
    providerId: string,
    methodId: string,
    inputs: Record<string, string> | undefined,
    ctx?: ProviderRuntimeContext,
  ): Promise<ProviderAuthFlow>
  completeOAuth(
    flowId: string,
    code: string | undefined,
    ctx?: ProviderRuntimeContext,
  ): Promise<void>
  canDisconnect(
    providerId: string,
    ctx?: ProviderRuntimeContext,
  ): Promise<boolean>
  disconnect(
    providerId: string,
    ctx?: ProviderRuntimeContext,
  ): Promise<void>
}

export interface ProviderModule {
  upstreamProviders?: UpstreamProviderManager
}
```

The contract must guarantee that provider, auth-method, and auth-flow responses are secret-free. `ProviderAuthFlow` contains an app-safe flow ID, URL, completion mode, instructions, and expiry. It never contains tokens, provider method indexes, or credentials.

`setApiKey` maps to OpenCode's documented generic auth write endpoint. `beginOAuth` and `completeOAuth` map its stateful OAuth protocol. `disconnect` must throw a typed unsupported error when no safe programmatic removal operation exists.

Agentex owns a bounded in-memory flow store. Flow records are random-ID keyed, single-use, expire after 10 minutes, and bind the provider, runtime context, protocol profile, and pooled server instance. A missing record returns a typed expired-or-restarted error.

### 11.4 Capability metadata

Keep existing static capability fields as maximums for compatibility. Add runtime probing for honest host behavior:

```ts
interface ProviderCapabilities {
  resume?: boolean
  modelVariants?: boolean
  permissionRequests?: boolean
  questionRequests?: boolean
  strictMcpIsolation?: boolean
  upstreamProviderDisconnect?: boolean
  sessionModelChange?: boolean
  sessionVariantChange?: boolean
  sessionEffortChange?: boolean
  sessionModeChange?: boolean
}

interface ProviderRuntimeReport {
  binary: {
    status: 'supported' | 'missing' | 'upgrade_required' | 'degraded'
    command: string | null
    version: string | null
    protocolProfile: string | null
    reason?: string
  }
  capabilities: Partial<Record<keyof ProviderCapabilities, {
    supported: boolean
    status: 'supported' | 'missing' | 'upgrade_required' | 'degraded'
    reason?: string
  }>>
}

interface ProviderModule {
  probeCapabilities?(ctx?: ProviderRuntimeContext): Promise<ProviderRuntimeReport>
}
```

The static `capabilities` object is the maximum implemented by the provider module. `probeCapabilities` reports what the installed binary and protocol profile can actually honor. Existing consumers that read static capabilities continue to compile, while the app uses the runtime report.

Keep legacy `durableSessions` false for OpenCode because that flag describes the existing file-shaped `attachSession` contract. Add and probe `durableHistory` for the new `attachHistory` contract in section 11.6.

### 11.5 Permission response and unattended semantics

Permission and question events continue through the existing `onUserInputRequest` callback. OpenCode question events normalize to the same `AskUserQuestion` input shape already understood by Agentex consumers. Do not add a second host callback for one harness.

Keep the existing `UserInputRequest` and `UserInputResponse` shapes for v1. Add only an explicit unattended policy:

```ts
interface ProviderConfig {
  unattendedPermissionPolicy?: 'allow' | 'deny'
}
```

Rules:

- OpenCode maps `allow: true` to native `once`
- OpenCode maps `allow: false` to native `reject`
- OpenCode v1 never sends native `always`
- The app offers only Allow once and Deny for OpenCode
- Do not label OpenCode `always` as session scope while chats share a pooled project instance
- A future remembered-approval feature requires either per-chat server isolation or an honest provider-instance or project scope in Agentex and UI
- Agentex keeps `allow` as the default unattended policy for backward compatibility
- This app explicitly passes `deny` for managed sessions unless the user selected a validated bypass mode
- A missing or failed callback follows the explicit unattended policy, not a provider-specific surprise default

### 11.6 Provider-neutral durable history

The current Agentex durable contract is file-specific. Keep it unchanged and add a second provider-neutral history surface. Do not replace or widen the existing `SessionAttachment`, `CatchUpYield`, `CatchUpOptions`, `FoundTranscript`, `transcript`, or `attachSession` types in this release.

```ts
export interface HistoryCheckpoint {
  kind: string
  value: unknown
}

export type HistorySource =
  | { kind: 'file', path: string }
  | { kind: 'service', description: string }

export interface HistoryCatchUpYield {
  event: StreamEvent
  checkpoint: HistoryCheckpoint
  eventId: string | null
}

export interface HistoryCatchUpOptions {
  after?: HistoryCheckpoint
  mode?: 'incremental' | 'bounded_full_resync'
}

export interface HistoryAttachment {
  record: SessionRecord
  historySource: HistorySource | null
  lastTurn: LastTurnStatus
  catchUp(opts?: HistoryCatchUpOptions): AsyncIterable<HistoryCatchUpYield>
  resume(ctx?: SessionContext): Promise<AgentSession>
  close?(): Promise<void>
}

export interface ProviderCapabilities {
  durableHistory?: boolean
}

export interface ProviderModule {
  attachHistory?(
    record: SessionRecord,
    opts?: AttachOptions,
  ): Promise<HistoryAttachment>
}

export interface AgentSession {
  describeHistory?(): SessionRecord | null
}
```

Compatibility requirements:

- Existing `attachSession`, `SessionAttachment.transcript`, `CatchUpYield.offset`, and `CatchUpOptions.fromOffset` remain byte-for-byte type compatible
- Existing Claude and Codex provider implementations and consumers compile without changes
- Claude and Codex add optional `attachHistory` adapters alongside their existing durable APIs
- Claude and Codex history adapters translate byte offsets into validated provider-owned checkpoints without changing the old yield type
- OpenCode implements `describeHistory` and `attachHistory`, not the file-shaped `attachSession`
- OpenCode keeps legacy `durableSessions` false and sets `durableHistory` true only after its history tests pass
- Providers validate checkpoint kind and payload through their codec
- Checkpoints must be JSON-serializable and secret-free
- Attachment is read-only and never starts a model turn
- Attachment may start or connect to a local read-only history service
- Service-backed attachments expose cleanup through `close`
- Pagination, restart, deduplication, invalid checkpoints, and missing sessions have contract tests

### 11.7 Exec-backed session helper

Add a reusable helper for CLIs that are one process per turn but support resume:

```ts
createExecBackedSession({
  providerType,
  execute,
  sessionCodec,
  ctx,
})
```

Required behavior:

- First `send()` runs one-shot execute
- Captures returned `sessionParams`
- Later `send()` passes the latest session params
- Buffers attempt events until a protocol-profile acceptance marker is observed
- For the validated Cursor profile, the first matching `system:init` event is the acceptance marker
- On acceptance, flush buffered events in order, emit the marker, and stream later events live
- A profile may use successful process exit as fallback acceptance only when a real-binary fixture proves that it emits no earlier marker
- Discards or diagnostically quarantines events from a failed unknown-session resume attempt
- Emits only accepted-attempt stream events through the session callback
- Rejects overlapping sends
- Supports interrupt through an active abort controller
- Implements `cancel()` with `{ cancelled: false }` when no queued message can be removed
- Implements `stopTask()` with `{ stopped: false }` when unsupported
- Wraps the provider's goal capability or emulated goal controller
- Emits preparing, spawning, running, completed, cancelled, and error lifecycle states consistently
- `close()` prevents later sends
- `drain()` waits for the active turn
- Unknown session retry updates the promoted session ID
- Unknown-session rollover is allowed only before acceptance
- An unknown-session-shaped error after acceptance is an ordinary failed turn and does not trigger hidden replay
- Unexpected marker order marks the runtime profile degraded
- `TurnResult` is derived without double-emitting terminal events

Cursor is the first consumer. The helper must not be Cursor-specific.

## 12. Agentex OpenCode implementation

### 12.1 Server lifecycle reuse

Reuse the existing pooled `opencode serve` process for:

- Sessions
- Provider discovery
- Model discovery
- Auth method discovery
- API-key and OAuth configuration
- Provider disconnect only when the protocol profile supports it
- Message history catch-up
- Agent and mode discovery
- MCP status and attachment

Pool keys must continue to include binary, cwd, prefix args, and an environment/config fingerprint. Never pool sessions across different credential environments.

Every pooled server must be authenticated even though it binds to loopback:

1. Generate at least 32 random bytes for each new pooled server
2. Pass the encoded secret through `OPENCODE_SERVER_PASSWORD`
3. Use the default `opencode` username or a generated non-secret username
4. Return an internal authenticated HTTP client rather than a bare URL
5. Send Basic authentication on health, API, and SSE requests
6. Keep the password and authorization header out of pool keys, logs, errors, events, and public handles
7. Throw when the health deadline expires
8. Kill and remove the process when spawn, URL detection, authentication, or health validation fails

The pool key selects a runtime configuration. The server password belongs to the selected pool instance and is generated only when that instance is created.

### 12.2 Provider and model discovery

Use structured OpenCode server endpoints rather than parsing human CLI output when available.

Primary inputs:

- `GET /provider`
- `GET /config/providers`
- `GET /config`

Required output:

- All reported upstream providers
- Connected upstream provider IDs
- Provider display names
- Full `provider/model` IDs
- Model display names
- Variants
- Context and output limits when reported
- Cost metadata when reported
- Default model information

Fallback:

- `opencode models [provider]`
- `--refresh` on explicit refresh
- `--verbose` only when its format is version-tested

Discovery must run in the target cwd so project configuration is respected.

### 12.3 OpenCode auth manager

Use:

- `GET /provider/auth`
- `PUT /auth/:id` for generic API-key credentials
- Provider OAuth authorize and callback endpoints for multi-step login
- Authenticated `GET /doc` to select the credential-removal adapter
- `DELETE /auth/{providerID}` for the tested OpenCode 1.3.2 profile
- `DELETE /api/credential/{credentialID}` for newer credential-ID profiles when probed and fixture-tested

If OpenCode's endpoint shapes vary by version, isolate compatibility handling in one client module and cover supported versions with fixtures.

Do not read or rewrite OpenCode credential files in v1. Unknown profiles return typed unsupported disconnect. The repository-pinned 1.3.2 profile is supported and must have a real-binary removal test.

After any API-key write, OAuth completion, or credential removal:

1. Increment the affected runtime-context generation
2. Mark matching pooled instances retired so new acquisition starts a fresh authenticated server
3. Prevent a stale session handle from sending another turn and return `runtime_reconfigured`
4. For API-key and OAuth connection, allow an active turn to finish before retiring its handle
5. For disconnect, interrupt and close affected active sessions before deletion so removed credentials cannot continue serving new work
6. Refresh provider connection state and model discovery against the new generation

### 12.4 Permission bridge

Subscribe to OpenCode permission events for the active session.

Connection behavior:

- Establish the authenticated SSE request before allowing a turn
- Wait for the server-connected event or a bounded readiness signal
- Reconnect with bounded exponential backoff after unexpected loss
- After initial connection and every reconnect, list pending permissions and questions through the probed protocol profile
- Filter by session ID and deduplicate by request ID
- While a message POST is in flight, poll pending permissions and questions at a bounded interval so a lost SSE event can be recovered
- Do not infer a permission block merely because a message POST is long-running
- Start the user-input response deadline only after a pending permission or question is observed
- Bound general long-running or no-progress execution through the normal send timeout, not the input watchdog
- Interrupt and fail the turn only when an observed pending request exceeds its response deadline or cannot be reconciled

On request:

1. Confirm the event session ID matches this `AgentSession`
2. Normalize into agentex `UserInputRequest`
3. Call `ctx.onUserInputRequest`
4. Map allow to OpenCode `once` and deny to OpenCode `reject`
5. Bound the callback with cancellation from session close or interrupt
6. Emit lifecycle state while waiting
7. Reject safely when the host callback throws or disappears

Never send OpenCode `always` in v1. Its approved rules live on the pooled project instance and can affect other app chats that share the server.

### 12.5 Question bridge

Subscribe to OpenCode question events.

Normalize through the existing `onUserInputRequest` path using the established `AskUserQuestion` input convention:

- Request ID
- Session ID
- One or more questions
- Multiple-choice options
- Free-form response support

Use the OpenCode request ID as the normalized tool-use ID. Map `updatedInput` answers from the host response to OpenCode's reply endpoint. Map host denial to OpenCode's reject endpoint. This keeps the app's existing question UI and avoids a provider-specific callback.

### 12.6 Terminal result event

At the end of every OpenCode session turn, emit exactly one normalized `result` event carrying:

- Final text
- Status
- Error state
- Model ID
- Token usage
- Cache-read tokens
- Cost when reported
- Duration when available

The `TurnResult` and stream `result` must describe the same outcome.

This allows the app's existing run telemetry to work without provider-specific completion logic.

Apply the same exactly-once terminal rule to one-shot OpenCode execution. `step_finish` is an intermediate step event and must not normalize into a terminal `result`. Add a separate parser fixture with multiple step finishes followed by one terminal outcome.

### 12.7 Variants and agents

- Parse `provider/model` on the first slash only
- Send `{ providerID, modelID }` to OpenCode
- Send `modelVariant` separately
- Discover available OpenCode agents through `GET /agent`
- Expose primary agents as agentex modes
- Apply selected mode through the message `agent` field
- Map app plan mode to OpenCode's plan agent when available
- Do not assume every installation has an agent named `plan`

### 12.8 Skills

Support session `skillDirs` without mutating project repositories.

Preferred mechanism:

- Build a temporary `OPENCODE_CONFIG_DIR`
- Materialize app-managed skill links there
- Preserve native global and project skill discovery
- Clean the temporary directory on server release

Avoid writing `.opencode/skills` into user repositories as an implementation side effect.

### 12.9 Durable catch-up

Implement OpenCode durable catch-up through server message history and the generalized Agentex history contract.

Required operations:

- Describe session existence
- Represent the history source as a service
- Start or connect to an authenticated read-only OpenCode server during attachment
- Use a checkpoint containing the last committed OpenCode message ID and part ID
- Normalize historical parts into stable stream events
- Use OpenCode message and part IDs for idempotency
- Promote a missing session to a clean rollover rather than looping

The installed 1.3.2 and current message APIs paginate backward with `limit` and an opaque `before` cursor. Incremental catch-up must:

1. Fetch the newest page without `before`
2. Follow `X-Next-Cursor` or the profile-equivalent cursor backward
3. Continue until the checkpoint message is found or a configured bound is reached
4. In the checkpoint message, discard parts through the checkpoint part ID
5. Retain later parts from that message and every later message
6. Reverse collected pages into chronological order while preserving part order
7. Normalize and emit with a checkpoint only after all events for that message and part boundary are committed

Defaults:

- Page size: 100 messages
- Maximum pages: 100
- Maximum collected messages: 10,000
- Maximum buffered response data: 25 MiB

If a non-null checkpoint cannot be found, return `history_checkpoint_not_found`. The app may retry explicitly with `mode: 'bounded_full_resync'`, replay from the oldest collected history, and deduplicate by stable OpenCode message and part IDs. If a full resync exceeds a bound, return `history_resync_limit` and require a clean rollover or explicit user action.

Implement OpenCode `describeHistory`, `attachHistory`, history `catchUp`, history `resume`, and attachment cleanup behind the additive contract. Set `durableHistory` true only after restart, backward-pagination, deduplication, invalid-checkpoint, bounded-resync, and missing-session tests pass. Keep legacy `durableSessions` false.

### 12.10 MCP

MCP attachment is a later hardening milestone, not a launch blocker.

When implemented:

- Map agentex `McpServerConfig` into OpenCode-native MCP configuration
- Support stdio, HTTP, and SSE transports supported by both contracts
- Keep secrets out of argv
- Query MCP health before dispatch
- Clean app-managed entries on session close

Strict isolation must not be advertised until a test proves that global and repository MCP servers cannot leak into a strict app-managed session.

If OpenCode configuration merging prevents this guarantee, keep `strictMcpIsolation` false and disable strict connector-scoped execution on OpenCode.

## 13. Agentex Cursor implementation

### 13.1 Transport decision record

Record the v1 CLI decision as an ADR in Agentex before implementation.

Compare CLI and `@cursor/sdk` across:

- Native browser login
- API-key login
- Billing behavior
- Model IDs and discovery
- Multi-turn semantics
- Event completeness
- Durable history
- Permissions
- Dependency and platform cost
- Public-beta stability and licensing

Decision: use CLI for v1. Do not add the SDK dependency and do not choose transport dynamically from the credential type.

### 13.2 Binary and command

Discover both `agent` and `cursor-agent`. Record the selected command and version in the runtime profile rather than assuming one name is universally primary.

Validate current CLI flags with real-binary tests:

- `-p` or `--print`
- `--output-format stream-json`
- `--model`
- `--resume`
- `--mode`
- `--force`
- child-process cwd behavior

Rules:

- Use the child process `cwd` for workspace selection
- Do not pass `--workspace` unless the selected binary explicitly advertises and tests it
- Map bypass to `--force` when advertised
- Never pass the obsolete `--yolo` flag
- Pass model-listing and mode flags only when their probes succeed

### 13.3 Multi-turn session

Implement `createSession` using the exec-backed session helper.

Session behavior:

- First send creates a Cursor session
- The system init event promotes the Cursor session ID
- Later sends use `--resume <id>`
- Same cwd is required for resume
- Buffer events until the probed profile's acceptance marker
- For the validated profile, accept on the first matching `system:init` event and flush buffered events immediately
- Unknown-session failure before acceptance retries once without resume
- The new session ID replaces the stale ID
- Events from the failed resume attempt remain quarantined and are not persisted as chat events
- Only events from the accepted clean rollover are emitted to the host
- Unknown-session-shaped failures after acceptance do not trigger rollover
- Overlapping send returns an explicit busy error
- Interrupt aborts only the active process

Set capabilities:

```text
sessions: true
resume: true
concurrentSend: false
cancelQueuedMessage: false
stopTask: false
```

### 13.4 Stream parser

Update parsing to the current documented top-level Cursor events.

Required event support:

- `system` init
- Incremental assistant text
- Top-level `tool_call` started
- Top-level `tool_call` completed
- Tool call ID correlation
- Tool input and result
- Terminal `result`
- Error events
- Unknown forward-compatible events

Rules:

- Do not return after the first content block when one line contains several meaningful blocks
- Preserve raw events
- Preserve session IDs on every normalized event
- Keep event IDs null only when Cursor supplies no stable identity
- Use `call_id` for tool correlation
- Do not synthesize cost when Cursor does not report it

### 13.5 Model discovery

Use Cursor's non-interactive model listing:

- `agent models`
- `--list-models` as supported by the installed version

Prefer a machine-readable option if available. If only formatted text is available:

- Keep parsing in one version-aware module
- Store fixture captures from supported Cursor versions
- Treat `Auto` as a valid model option only when Cursor reports it
- Preserve display names and accepted model IDs separately
- Include Grok models exactly as Cursor reports them
- Never hardcode a Grok version as required product behavior

If neither model-listing command is supported, report `modelDiscovery: upgrade_required`. Do not substitute a hardcoded Cursor catalog or silently show models from a newer fixture.

### 13.6 Authentication

Use the selected Cursor binary's `status` command as the primary auth check.

Detect:

- Native Cursor login
- `CURSOR_API_KEY`
- Binary missing
- Authentication failure

Remove `OPENAI_API_KEY` as a Cursor credential signal unless current official Cursor behavior explicitly validates it.

Connection UI offers:

- `agent login`
- API-key instructions
- Recheck
- Real verification using an enabled cheap or Auto model

### 13.7 Modes and permissions

Expose current Cursor modes:

- Agent
- Plan
- Ask

Map plan mode to Cursor's native plan mode.

Expose these modes only when the installed binary's probe succeeds. Set independent Cursor reasoning effort to false until a concrete supported control is implemented and tested.

Do not advertise interactive permission requests until a headless protocol exposes a request and response bridge that agentex can control.

For the first release:

- Default execution uses the validated headless behavior
- Bypass maps to the validated force flag when required
- Plan maps to plan mode
- Unsupported permission modes are hidden for Cursor

Live tests must prove that a default execution cannot hang on an unseen terminal prompt.

### 13.8 Cursor MCP and recovery

Cursor's ambient native MCP and persisted sessions do not automatically satisfy app-scoped MCP or durable catch-up requirements.

First release:

- Keep app MCP attachment false
- Keep strict MCP isolation false
- Keep durable catch-up false
- Rely on live stream persistence and process resume between turns

Later work may add an isolated Cursor config directory and a session-export or transcript reader when a stable interface exists.

## 14. App executor and reconciliation behavior

### 14.1 Session creation

The adapter resolves:

1. Chat session
2. Agent record
3. Canonical harness ID
4. Validated model tuple
5. Effective binary and protocol capabilities
6. Capability-derived provider config
7. Provider `createSession`

Every production harness in the registry must implement agentex `createSession` before the app exposes it.

### 14.2 Running state and overlapping sends

- Claude and Codex retain native concurrent send
- OpenCode and Cursor reject overlapping sends
- UI disables or queues based on the capability
- App-owned queued messages may be cancelled before dispatch
- Host queueing must not be labeled as native concurrent send

### 14.3 Permission modes

Replace the global assumption that every session supports the same four permission modes.

Suggested app capability:

```ts
type AppPermissionMode = 'bypass' | 'default' | 'accept_edits' | 'plan'

interface PermissionModeSupport {
  supported: AppPermissionMode[]
  defaultMode: AppPermissionMode
}
```

Historical sessions retain stored values. The UI only offers values the current harness can apply.

Pending permission UI supports:

- Allow once
- Deny

OpenCode v1 does not expose remembered approval because native `always` is broader than one app chat under pooled project instances.

The app passes `unattendedPermissionPolicy: 'deny'` for managed sessions unless the user explicitly selected a validated bypass mode.

### 14.4 Reconciliation

Refactor app reconciliation to prefer agentex's provider-polymorphic durable session surface.

Order:

1. Ask the provider whether durable catch-up is supported
2. Catch up from the saved provider-owned checkpoint
3. Persist normalized events idempotently
4. Advance checkpoint
5. Fall back to no-op for unsupported Cursor sessions

Keep the existing Claude and Codex specialized paths until the generic facade reaches parity.

The app treats checkpoints as opaque JSON and never assumes byte offsets. It persists a new checkpoint only after every event associated with it has been committed.

### 14.5 Resume command display

Execution metadata displays a harness-specific resume hint only when one exists.

Examples:

```text
claude --resume <id>
codex resume <id>
agent --resume <id>
opencode run --session <id>
```

Generate these through the registry. Do not hardcode them in execution components.

## 15. Security requirements

### 15.1 Secrets

- Never persist raw provider secrets in SQLite
- Never include secrets in `chat_events.raw`
- Never include secrets in thrown error messages
- Never put secrets in command arguments
- Use native harness credential stores when possible
- Use AES-256-GCM precious-local storage only when app storage is necessary
- Agent credential directory mode is 0700
- Encryption key and credential files are mode 0600
- Register active secrets with the app redactor while in memory
- Clear secret-bearing request objects after use where practical

### 15.2 Local servers

- Bind OpenCode servers to `127.0.0.1`
- Use random ports
- Generate a random `OPENCODE_SERVER_PASSWORD` for every pooled server instance
- Send Basic authentication on health, API, and SSE requests
- Encapsulate server authentication in one OpenCode HTTP client
- Never expose the raw server URL and password as separate public values
- Do not expose server URLs through client APIs
- Separate pooled servers by effective credentials and config
- Throw and release processes on failed spawn, URL detection, authentication, health, and connect paths
- Bound health checks and API calls
- Validate response sizes before buffering

### 15.3 Model and provider IDs

- Treat catalog IDs as opaque strings
- Encode IDs as path parameters safely
- Reject control characters
- Do not interpolate IDs into shell command strings
- Use `execFile` or spawn argument arrays
- Resolve workspace context server-side

### 15.4 Permission safety

- Agentex retains its backward-compatible unattended default unless the host provides a policy
- This app explicitly selects deny for managed sessions and bypass only through a validated user mode
- A failed permission response interrupts the turn
- SSE loss triggers pending-request reconciliation and a bounded watchdog
- OpenCode native `always` is never sent while multiple chats can share a pooled project instance
- Connector scoping fails closed where the product promises scope isolation
- Unsupported strict isolation is visible in capability metadata

## 16. Telemetry and pricing

### 16.1 Normalized results

Every harness turn should emit one normalized terminal result so existing run telemetry can capture:

- Model
- Input tokens
- Output tokens
- Cached input tokens
- Cost when reported
- Summary
- Error status

### 16.2 Unknown pricing

- Prefer provider-reported cost
- Fall back to local pricing only for recognized model IDs
- Never infer a vendor from a model-name substring
- Unknown models retain usage with null cost
- OpenCode full IDs are pricing keys as reported, including upstream provider prefix
- Cursor usage may remain null if the CLI does not report it

### 16.3 Diagnostics

Structured logs may include:

- Harness ID
- Provider ID
- Model ID
- Binary version
- Discovery source
- Cache hit or miss
- Turn status

They must not include:

- API keys
- OAuth tokens
- Auth request bodies
- Full environment objects
- Provider server authorization headers

## 17. Testing strategy

### 17.1 Agentex unit tests

OpenCode:

- Provider catalog parsing
- Connected-provider filtering
- API-key auth mapping through `PUT /auth/:id`
- OAuth begin and complete mapping
- OpenCode 1.3.2 removal through `DELETE /auth/{providerID}`
- Newer credential-ID removal adapter fixtures
- Unsupported disconnect behavior
- Runtime generation increment and pool retirement after credential mutation
- Stale session handles return `runtime_reconfigured`
- Auth flow and credential redaction
- Per-server Basic authentication
- Authenticated health and SSE requests
- Health timeout throws and kills the server
- Model metadata and variant mapping
- Permission request mapping
- Permission once and deny mapping
- Native `always` is never sent
- Explicit unattended permission policy
- SSE readiness before first turn
- SSE reconnect and pending-request reconciliation
- Pending-request polling does not time out a long turn with no observed input request
- Observed input request deadline and general send timeout remain separate
- Question request and response mapping
- Exactly-one terminal result emission for session and one-shot execution
- Multiple `step_finish` events remain non-terminal
- Usage and cost mapping
- Session resume
- Unknown session rollover
- Additive `attachHistory` compatibility with unchanged legacy durable types
- Service-backed message history catch-up
- Backward `before` pagination, chronological reversal, and part-boundary filtering
- Opaque checkpoint validation, bounded full resync, pagination limits, and deduplication
- Server pool credential separation
- Cleanup on failure

Cursor:

- Current stream JSON assistant deltas
- Top-level tool started and completed
- Tool correlation
- Result and failure events
- Model list parsing
- Native auth status parsing
- Exec-backed first send
- Resume send
- Unknown-session rollover
- Failed-resume event quarantine
- `system:init` acceptance marker flushes buffered events before process exit
- Unknown-session errors after acceptance do not roll over
- Unexpected acceptance-marker ordering degrades the profile
- Overlapping-send rejection
- Interrupt and close
- Child-process cwd without undocumented workspace flags
- `--force` mapping without `--yolo`
- Upgrade-required profile when discovery or modes are absent

Shared:

- Expanded capability contracts
- Maximum versus effective capability intersection
- Provider-neutral file and service history contracts
- Full exec-backed `AgentSession` contract including goals, cancel, and stopTask
- Context-aware model discovery options
- Backward compatibility of existing providers
- No secret values in errors or snapshots

### 17.2 Agentex real-binary tests

Add opt-in tests:

```text
AGENTEX_REAL_OPENCODE=1
AGENTEX_REAL_CURSOR=1
```

OpenCode live test:

- Start an authenticated server
- Prove unauthenticated requests fail
- Prove authenticated health, API, and SSE requests work
- List providers and models
- Set and remove a disposable provider credential through the probed 1.3.2 auth adapter
- Retire the pool and prove the next discovery observes the credential change
- Create session
- Run a harmless turn
- Observe assistant and result
- Resume session
- Exercise a controlled permission request if possible
- Exercise allow-once and deny where possible
- Prove no native `always` response is sent
- Restart and catch up through backward pagination from a service checkpoint
- Close and prove server cleanup

Cursor live test:

- Run `agent status`
- Record the selected command, version, and protocol profile
- List models
- Create headless session
- Observe session ID and result
- Observe and validate the `system:init` acceptance marker before live event flush
- Resume with a second turn
- Run a harmless read tool and observe correlated tool events
- Interrupt a bounded long turn
- Prove the runtime reports upgrade-required on a fixture or binary without discovery and modes

CI may skip authenticated live tests, but a documented maintainer command must run them before release.

### 17.3 App unit and route tests

- Registry mapping is exhaustive
- Unknown harness never maps to Claude
- All provider-input routes reject unknown IDs
- Settings row migration and defaults
- Active harness and legacy compatibility mirrors stay transactionally consistent
- Enabled-model atomic validation
- Unavailable selections persist
- Availability status and reason are preserved
- Default model must be enabled
- Harness switch starts new chat
- Same-harness model switch preserves harness
- Unsupported in-chat selection changes start a new same-harness chat
- Variant persists separately from effort
- Capability-driven permission controls
- Composer shows enabled models only
- OpenCode provider route responses are secret-free
- OpenCode unsupported disconnect returns a typed conflict
- OpenCode disconnect cannot invalidate the global default without a replacement
- Disconnect saga leaves credentials connected on external-store failure
- Disconnect saga retries idempotently and treats already-absent credentials as success
- Catalog cache invalidation
- Onboarding for all four harnesses

### 17.4 App integration tests

- Existing Claude execution remains unchanged
- Existing Codex execution remains unchanged
- OpenCode provider connect refreshes models
- OpenCode credential mutation retires the affected pool and refreshes the next discovery
- OpenCode enabled model starts a session
- OpenCode permission prompt reaches pending-input UI
- OpenCode permission prompt supports once and deny only
- OpenCode approval in one chat never authorizes another pooled chat
- OpenCode restart catches up from an opaque service checkpoint
- Cursor model catalog includes Grok when the installed Cursor catalog reports it
- Cursor Grok selection starts a Cursor session
- Cursor second message resumes the same external session
- Failed Cursor resume attempt events are not persisted before rollover
- Unsupported controls are hidden for Cursor
- Offline catalog uses persisted enabled models

## 18. Rollout

### 18.1 Feature flags

The implemented kill switches are public build-time environment variables so
the browser and server share the same visible harness set:

```text
NEXT_PUBLIC_FLOW_OPENCODE_ENABLED
NEXT_PUBLIC_FLOW_CURSOR_ENABLED
```

Semantics:

- Both harnesses are enabled by default after the Agentex 0.0.28 release
- Setting either variable to the exact string `false` hides that harness and
  makes server dispatch reject it
- Claude and Codex are not controlled by these emergency switches
- Model allowlists are now part of the base four-harness model and do not need
  a separate rollout flag

Remove flags after one stable release cycle.

### 18.2 Rollout sequence

1. Land additive Agentex capability, permission, auth, and `attachHistory` contracts
2. Prove the legacy durable API is unchanged and Claude and Codex work through both surfaces
3. Ship app registry and persistence with only Claude and Codex visible
4. Ship model allowlists for Claude and Codex
5. Complete authenticated OpenCode discovery, session parity, and durable catch-up
6. Publish the Agentex OpenCode changes and upgrade the app dependency
7. Enable OpenCode for maintainers
8. Complete Cursor protocol probes and resumable CLI sessions
9. Publish the Agentex Cursor changes and upgrade the app dependency
10. Enable Cursor for maintainers
11. Validate Cursor Grok model selection
12. Enable OpenCode and Cursor by default

### 18.3 Rollback

- Feature flags hide new harnesses without deleting settings
- Existing OpenCode and Cursor chat events and provider session records remain readable
- Disabling a harness prevents new chat creation but does not rewrite agent rows
- Migration is additive and does not remove existing user-state fields
- Agentex changes remain additive to public types

## 19. Acceptance criteria

The implementation is complete when all of the following are true.

### 19.1 Product

- Settings shows exactly four harness tabs
- No standalone Grok harness appears
- Cursor catalog can expose Grok without app hardcoding
- OpenCode supports API-key and OAuth provider connection
- The tested OpenCode 1.3.2 profile supports provider disconnect through its generated DELETE endpoint
- OpenCode supports in-app disconnect only when the effective protocol profile exposes a safe removal operation
- Unsupported OpenCode disconnect shows native logout guidance
- User can select a model allowlist per harness
- Composer shows enabled models only
- User can select default models per harness
- Harness switching starts a new chat on the same execution
- Model and tuning changes use the current chat only when their effective session-change capabilities allow it
- Unsupported same-harness changes start a new chat without changing the execution
- Unsupported controls are hidden or disabled with a reason

### 19.2 Runtime

- OpenCode multi-turn chat works through the app
- OpenCode provider and model discovery is live and cwd-aware
- OpenCode API-key and OAuth flows use distinct typed operations
- OpenCode permission and question requests reach the app
- OpenCode permission replies support once and deny
- OpenCode never sends native `always` while project instances are pooled
- OpenCode emits terminal result telemetry
- OpenCode one-shot and session turns emit exactly one terminal result
- OpenCode durable recovery uses the additive `attachHistory` contract without changing legacy durable types
- OpenCode catch-up pages backward, emits chronologically, and handles missing checkpoints through bounded full resync
- Cursor implements agentex `createSession`
- Cursor resumes a second turn through the same Cursor session ID
- Cursor emits buffered events after the validated `system:init` acceptance marker
- Cursor current tool events render correctly
- Cursor model discovery works on a supported real binary
- Older Cursor binaries report upgrade-required rather than receiving unsupported flags
- Cursor uses child-process cwd and never emits obsolete `--yolo`
- Cursor native login and API-key status are detected
- Existing Claude and Codex tests remain green

### 19.3 Security

- No raw provider key is stored in SQLite
- No raw provider key appears in logs or API responses
- OpenCode server is loopback-only and protected by a random per-instance password
- Every OpenCode health, API, and SSE request is authenticated
- OpenCode server passwords and authorization headers never appear in logs, errors, events, or API responses
- Failed OpenCode health startup throws and kills the process
- Failed permission bridging cannot leave a forever-blocked turn
- Unknown harness IDs fail validation
- Strict MCP isolation is not claimed without a proving test

### 19.4 Quality

- Typecheck passes in both repositories
- Lint passes in the app
- Agentex unit suite passes
- App targeted and full tests pass
- Real OpenCode smoke test passes
- Real Cursor smoke test passes
- Migration is tested against a populated pre-change database
- Settings remains usable with more than 1,000 catalog models
- Cursor CLI versus SDK ADR is committed and v1 transport is unambiguous
- Effective capability tests cover supported, missing, upgrade-required, and degraded profiles

## 20. Combined implementation task list

Task labels:

- `[AX]` means `~/dynamism/agentex`
- `[APP]` means `~/dynamism/ai-task-manager`
- `[QA]` means cross-repository verification
- `[DOC]` means documentation or release notes

Tasks are ordered by dependency. Do not expose a new harness in the app before its agentex session path and live smoke test pass.

Execution rules:

- Treat each milestone as a work package and each checkbox as a commit-sized task or an explicit test obligation
- Complete Agentex contract and runtime tasks before the app tasks that consume them
- Land additive Agentex contracts first, publish or link the new Agentex version, then update the app lockfile
- Keep the harness feature flag off until that harness passes its milestone exit criteria and the relevant real-binary checks
- A checkbox is complete only when its implementation, typed failure behavior, and named tests are present
- If implementation disproves a protocol assumption, update this spec and its fixture before continuing dependent tasks
- Do not combine OpenCode and Cursor enablement into one release gate. Each harness may ship independently after its own checks pass

### Milestone 0: Baseline and contracts

- [ ] `[QA]` Record current app and agentex typecheck and test baselines
- [ ] `[QA]` Record installed Claude, Codex, OpenCode, and Cursor binary versions where present
- [ ] `[DOC]` Add the Cursor CLI versus SDK ADR with the v1 CLI decision
- [ ] `[DOC]` Record that transport may not switch implicitly based on credential type
- [ ] `[AX]` Add `ListModelsOptions` with cwd, env, config, cache, and refresh fields
- [ ] `[AX]` Expand `ProviderModel` with optional provider, variant, capability, context, and cost metadata
- [ ] `[AX]` Add optional `ProviderConfig.modelVariant`
- [ ] `[AX]` Add maximum and effective runtime capability report types
- [ ] `[AX]` Add session model, variant, effort, and mode change capabilities
- [ ] `[AX]` Add upstream-provider disconnect capability
- [ ] `[AX]` Add provider runtime probe contract
- [ ] `[AX]` Define required versus optional feature probes for OpenCode and Cursor
- [ ] `[DOC]` Add a tested binary and protocol profile manifest
- [ ] `[AX]` Add explicit unattended permission policy with backward-compatible default behavior
- [ ] `[AX]` Keep existing durable types and `attachSession` byte-for-byte source compatible
- [ ] `[AX]` Add provider-owned `HistoryCheckpoint` and file-or-service `HistorySource` types
- [ ] `[AX]` Add optional `describeHistory` and `attachHistory` methods
- [ ] `[AX]` Add `durableHistory` capability independently from legacy `durableSessions`
- [ ] `[AX]` Add service-backed `HistoryAttachment` cleanup
- [ ] `[AX]` Add Claude and Codex `attachHistory` adapters without changing their legacy APIs
- [ ] `[AX]` Keep OpenCode legacy `durableSessions` false
- [ ] `[AX]` Add secret-free provider manager types for API key, OAuth begin, OAuth complete, disconnect capability, and disconnect
- [ ] `[AX]` Add public contract tests proving older provider modules remain valid
- [ ] `[DOC]` Document the additive agentex API changes

Exit criteria:

- Agentex compiles with all existing providers
- Existing public provider consumers require no changes
- Existing durable consumers compile against unchanged legacy fields
- Claude and Codex pass both legacy durability and new `attachHistory` tests
- New auth, permission, capability, and history contracts have unit tests

### Milestone 1: App harness registry

- [ ] `[APP]` Create `src/lib/agents/registry.ts`
- [ ] `[APP]` Define `HarnessId` with exactly Claude, Codex, Cursor, and OpenCode
- [ ] `[APP]` Define maximum and effective app capability models
- [ ] `[APP]` Store only maximum capabilities in the static registry
- [ ] `[APP]` Add server-only effective capability service backed by Agentex probes
- [ ] `[APP]` Add supported, missing, upgrade-required, and degraded statuses with safe reasons
- [ ] `[APP]` Add exhaustive harness to agentex provider mapping
- [ ] `[APP]` Add exhaustive harness to agent-record harness mapping
- [ ] `[APP]` Add harness-specific install, login, docs, icon, and resume metadata
- [ ] `[APP]` Replace `ProviderId` and duplicate `AgentHarness` unions with registry types
- [ ] `[APP]` Replace unknown-to-Claude fallback helpers with validation or exhaustive switches
- [ ] `[APP]` Add registry mapping tests
- [ ] `[APP]` Add a test that an unknown harness never resolves to Claude
- [ ] `[APP]` Add tests that effective capabilities can only reduce registry maximums
- [ ] `[APP]` Add fixture tests for older Cursor and OpenCode protocol profiles

Affected app areas:

- [ ] `[APP]` Update `src/lib/agent-options.ts`
- [ ] `[APP]` Update `src/lib/executor/harness.ts`
- [ ] `[APP]` Update `src/lib/sessions/dispatch.ts`
- [ ] `[APP]` Update orchestrator and document chat routes
- [ ] `[APP]` Update new-chat and session routes
- [ ] `[APP]` Update hooks and API client types
- [ ] `[APP]` Update execution and harness-chat component callback types
- [ ] `[APP]` Update execution header resume labels and commands

Exit criteria:

- App compiles with four registry entries and runtime capability reports
- Feature flags still show only existing harnesses
- Claude and Codex behavior is unchanged

### Milestone 2: Persistence and model allowlists

- [ ] `[APP]` Add `agent_harness_settings` schema with shared timestamps
- [ ] `[APP]` Add derived types in `src/db/types.ts`
- [ ] `[APP]` Expand `user_state.defaultAgentHarness`
- [ ] `[APP]` Make `defaultAgentHarness` the active-harness source of truth
- [ ] `[APP]` Store enabled models as model ID strings only
- [ ] `[APP]` Store per-harness model, variant, and effort defaults only in `agent_harness_settings`
- [ ] `[APP]` Keep legacy global model and effort fields as transactionally mirrored compatibility fields
- [ ] `[APP]` Add `chat_sessions.modelVariant`
- [ ] `[APP]` Add secret-free `agent_harness_operations` table with shared timestamps
- [ ] `[APP]` Add pending, completed, and failed disconnect operation states
- [ ] `[APP]` Generate the Drizzle migration
- [ ] `[APP]` Implement populated-database backfill for Claude and Codex settings
- [ ] `[APP]` Add settings query helpers
- [ ] `[APP]` Add transactional active-harness selection helper
- [ ] `[APP]` Add begin, complete, fail, get, and retryable disconnect saga queries
- [ ] `[APP]` Add enabled-model normalization and duplicate rejection
- [ ] `[APP]` Add default-model invariant enforcement
- [ ] `[APP]` Add migration tests from pre-change schema and seeded data
- [ ] `[APP]` Add query tests for independent per-harness settings

Exit criteria:

- Existing databases migrate without losing chat selections
- Active harness and legacy compatibility mirrors cannot drift
- Failed cross-store disconnects remain safely retryable without storing secrets
- Claude and Codex get sensible enabled-model defaults
- Cursor and OpenCode start with empty allowlists

### Milestone 3: Catalog service and APIs

- [ ] `[APP]` Replace `ModelOption` with the richer harness model view or add an adapter type
- [ ] `[APP]` Refactor `src/lib/agent-model-discovery.ts` around the registry
- [ ] `[APP]` Add context-aware cache keys without raw secrets
- [ ] `[APP]` Add manual refresh support
- [ ] `[APP]` Add persisted unavailable-model merge behavior
- [ ] `[APP]` Replace model availability boolean with status and reason
- [ ] `[APP]` Add `GET /api/agent/harnesses`
- [ ] `[APP]` Return effective capabilities, binary compatibility, and protocol profile from the harness API
- [ ] `[APP]` Generalize `GET /api/agent/models`
- [ ] `[APP]` Add `PUT /api/agent/models/enabled`
- [ ] `[APP]` Update enabled model IDs and per-harness default selection atomically
- [ ] `[APP]` Generalize auth response types
- [ ] `[APP]` Generalize verify route selection
- [ ] `[APP]` Add route validation tests for all harness IDs
- [ ] `[APP]` Add catalog cache and invalidation tests
- [ ] `[APP]` Add capability-probe cache and binary-version invalidation tests

Exit criteria:

- Claude and Codex catalogs flow through the new API
- Enabled models can be updated atomically
- Offline persisted selections remain visible
- Unsupported binaries report upgrade-required without receiving unsupported flags

### Milestone 4: Conductor-style settings UI

- [ ] `[APP]` Replace the flat model list with harness tabs
- [ ] `[APP]` Add shared harness status header
- [ ] `[APP]` Add installed, upgrade-required, degraded, connected, and verification states
- [ ] `[APP]` Add enabled-model count and manage-models action
- [ ] `[APP]` Build searchable checkbox model picker
- [ ] `[APP]` Group models by upstream provider
- [ ] `[APP]` Add unavailable selected-model group
- [ ] `[APP]` Display provider-disconnected, model-removed, binary-unsupported, and stale-catalog reasons
- [ ] `[APP]` Add enabled-first sorting
- [ ] `[APP]` Add virtualization threshold for large catalogs
- [ ] `[APP]` Add default model selection
- [ ] `[APP]` Add variant selection where supported
- [ ] `[APP]` Add effort selection where supported
- [ ] `[APP]` Add advanced section with binary, version, auth source, and refresh
- [ ] `[APP]` Update composer menus to show enabled models only
- [ ] `[APP]` Add `Manage models` link from composer
- [ ] `[APP]` Update provider switching to use registry and enabled selections
- [ ] `[APP]` Make same-harness selection changes use effective session-change capabilities
- [ ] `[APP]` Start a new same-harness chat when a requested selection change cannot safely resume
- [ ] `[APP]` Update onboarding to four harnesses
- [ ] `[APP]` Ensure no Grok harness card is rendered
- [ ] `[APP]` Add UI tests for keyboard selection and large catalogs

Exit criteria:

- Claude and Codex work through the new settings UI
- A synthetic 1,000-model catalog remains usable
- Normal menus show only enabled models
- Every visible control is gated by effective rather than maximum capabilities

### Milestone 5: Agentex OpenCode discovery and auth

- [ ] `[AX]` Extract a version-aware OpenCode HTTP client
- [ ] `[AX]` Generate a random password per pooled OpenCode server
- [ ] `[AX]` Pass the password through `OPENCODE_SERVER_PASSWORD`
- [ ] `[AX]` Authenticate health, API, and SSE requests through the shared client
- [ ] `[AX]` Stop exposing bare server URLs to OpenCode provider modules
- [ ] `[AX]` Make health timeout throw and kill the pooled process
- [ ] `[AX]` Add unauthenticated-request rejection and startup-cleanup tests
- [ ] `[AX]` Reuse pooled servers for configuration operations
- [ ] `[AX]` Probe the authenticated OpenCode `GET /doc` schema
- [ ] `[AX]` Produce an effective OpenCode protocol and capability report
- [ ] `[AX]` Implement structured upstream provider listing
- [ ] `[AX]` Implement connected-provider detection
- [ ] `[AX]` Implement auth method discovery
- [ ] `[AX]` Implement generic API-key writes through `PUT /auth/:id`
- [ ] `[AX]` Implement OAuth begin and complete flows
- [ ] `[AX]` Keep provider method indexes behind the Agentex flow abstraction
- [ ] `[AX]` Add bounded, single-use, 10-minute OAuth flow storage
- [ ] `[AX]` Bind flows to provider, runtime context, protocol profile, and pooled server instance
- [ ] `[AX]` Add code, automatic, expired, consumed, and process-restart flow tests
- [ ] `[AX]` Detect safe programmatic disconnect support from the protocol profile
- [ ] `[AX]` Implement OpenCode 1.3.2 `DELETE /auth/{providerID}` adapter
- [ ] `[AX]` Implement fixture-backed credential-ID removal adapter for supported newer profiles
- [ ] `[AX]` Return a typed unsupported error when disconnect is unavailable
- [ ] `[AX]` Do not edit OpenCode auth files directly
- [ ] `[AX]` Add runtime-context generation to the OpenCode pool
- [ ] `[AX]` Retire affected pool entries after every credential mutation
- [ ] `[AX]` Make stale session handles return `runtime_reconfigured` before another send
- [ ] `[AX]` Allow active turns to finish after credential connection, then retire their handles
- [ ] `[AX]` Interrupt and close affected sessions before credential deletion
- [ ] `[AX]` Refresh provider and model state against the new pool generation
- [ ] `[AX]` Prove auth manager outputs are secret-free
- [ ] `[AX]` Implement context-aware OpenCode `listModels`
- [ ] `[AX]` Map provider names, model names, full IDs, variants, context, and cost metadata
- [ ] `[AX]` Implement explicit refresh
- [ ] `[AX]` Add CLI fallback only for supported server-API failures
- [ ] `[AX]` Add OpenCode provider, auth, and model fixtures
- [ ] `[AX]` Add API-key, OAuth, supported-disconnect, and unsupported-disconnect fixtures
- [ ] `[AX]` Add real generated-schema fixture for repository-pinned OpenCode 1.3.2
- [ ] `[AX]` Add pool retirement and stale-handle tests
- [ ] `[AX]` Add cache and server-pool separation tests

Exit criteria:

- Agentex reports connected OpenCode providers
- Agentex lists configured models in global and project cwd contexts
- Every OpenCode server request is authenticated
- API-key and OAuth flows are distinct and stateful
- Tested OpenCode 1.3.2 provider disconnect works through the generated DELETE endpoint
- The next discovery and execution after credential mutation use a fresh pool generation
- No credentials appear in returned objects or snapshots

### Milestone 6: Agentex OpenCode session parity

- [ ] `[AX]` Send `modelVariant` in OpenCode message requests
- [ ] `[AX]` Establish authenticated SSE and await readiness before the first turn
- [ ] `[AX]` Subscribe to permission events
- [ ] `[AX]` Reconnect SSE with bounded backoff
- [ ] `[AX]` List and reconcile pending permissions and questions after connection and reconnect
- [ ] `[AX]` Deduplicate pending input by request ID
- [ ] `[AX]` Poll pending input while a message POST is active
- [ ] `[AX]` Start the input deadline only after a pending request is observed
- [ ] `[AX]` Keep the general send timeout separate from input response timing
- [ ] `[AX]` Test that long turns with no pending input are not killed by the input watchdog
- [ ] `[AX]` Normalize permission events into `UserInputRequest`
- [ ] `[AX]` Send allow-once and deny responses
- [ ] `[AX]` Prove native OpenCode `always` is never sent
- [ ] `[AX]` Subscribe to question events
- [ ] `[AX]` Normalize multiple-choice and free-form questions
- [ ] `[AX]` Send question replies and rejections
- [ ] `[AX]` Bound permission and question waits by close and interrupt
- [ ] `[AX]` Apply explicit unattended permission policy
- [ ] `[AX]` Preserve Agentex backward-compatible unattended default
- [ ] `[AX]` Emit lifecycle waiting states
- [ ] `[AX]` Emit one terminal normalized result per turn
- [ ] `[AX]` Stop mapping one-shot `step_finish` events to terminal results
- [ ] `[AX]` Emit exactly one terminal result from one-shot OpenCode execution
- [ ] `[AX]` Include usage, cache, cost, model, duration, and error metadata
- [ ] `[AX]` Discover OpenCode agents
- [ ] `[AX]` Expose compatible primary agents as modes
- [ ] `[AX]` Apply selected agent to messages
- [ ] `[AX]` Add plan-agent mapping without assuming a fixed name
- [ ] `[AX]` Implement session skillDirs through temporary config directory
- [ ] `[AX]` Add SSE readiness, reconnect, pending-list, dedup, and watchdog tests
- [ ] `[AX]` Add cross-chat permission-isolation, unattended policy, question, result, variant, mode, and skills tests

Exit criteria:

- OpenCode cannot hang on an invisible permission or question request
- OpenCode one-shot and session telemetry receive exactly one terminal result per turn
- Variant selection reaches the model request

### Milestone 7: App OpenCode integration

- [ ] `[APP]` Add OpenCode upstream-provider API routes
- [ ] `[APP]` Connect routes to the agentex upstream provider manager
- [ ] `[APP]` Add provider modal with curated ordering and view-all behavior
- [ ] `[APP]` Add standard write-only API-key forms
- [ ] `[APP]` Render OAuth text and select prompts from safe metadata
- [ ] `[APP]` Implement OAuth begin and complete UI states
- [ ] `[APP]` Ensure secret inputs are write-only
- [ ] `[APP]` Add disconnect only when effective capabilities support it
- [ ] `[APP]` Show `opencode auth logout` guidance when disconnect is unsupported
- [ ] `[APP]` Preflight models affected by provider disconnect
- [ ] `[APP]` Install a valid replacement and pending saga row in one SQLite transaction
- [ ] `[APP]` Execute idempotent external credential deletion after replacement commit
- [ ] `[APP]` Mark disconnect saga complete or failed with a safe error code
- [ ] `[APP]` Add retry action for failed disconnect operations
- [ ] `[APP]` Treat already-absent credentials as successful retry completion
- [ ] `[APP]` Retain connected credentials when external deletion fails
- [ ] `[APP]` Retire affected OpenCode instances before deletion
- [ ] `[APP]` Refresh auth and catalog state after pool generation change
- [ ] `[APP]` Map OpenCode variants separately from effort
- [ ] `[APP]` Map OpenCode permission requests into existing pending-input UI
- [ ] `[APP]` Add Allow once and Deny actions only for OpenCode
- [ ] `[APP]` Add a test that one chat's approval never authorizes another pooled chat
- [ ] `[APP]` Pass explicit deny unattended policy for managed sessions
- [ ] `[APP]` Map OpenCode questions into existing question UI
- [ ] `[APP]` Hide stop-task and concurrent-send controls for OpenCode
- [ ] `[APP]` Add OpenCode connection, catalog, and selection route tests
- [ ] `[APP]` Add OpenCode pending-input integration tests

Exit criteria:

- User can connect an OpenCode provider and select a model without leaving the app
- OAuth and API-key connections use distinct safe flows
- User can run and resume an OpenCode chat
- Permission and question requests are answerable without invisible hangs

### Milestone 8: Agentex OpenCode durable catch-up

- [ ] `[AX]` Add OpenCode `describeHistory` support
- [ ] `[AX]` Implement service-backed OpenCode `attachHistory` without implementing legacy `attachSession`
- [ ] `[AX]` Start or connect to an authenticated read-only history server during attachment
- [ ] `[AX]` Add attachment cleanup
- [ ] `[AX]` Keep OpenCode legacy `durableSessions` false
- [ ] `[AX]` Set OpenCode `durableHistory` true only after history tests pass
- [ ] `[AX]` Add message-history catch-up
- [ ] `[AX]` Add checkpoint codec containing message ID and part ID
- [ ] `[AX]` Fetch the newest page first and follow opaque `before` cursors backward
- [ ] `[AX]` Stop paging when the checkpoint message is found
- [ ] `[AX]` Discard parts through the checkpoint part and retain subsequent parts
- [ ] `[AX]` Reverse collected pages into chronological order before normalization
- [ ] `[AX]` Enforce page-size, page-count, message-count, and byte-size bounds
- [ ] `[AX]` Return `history_checkpoint_not_found` when incremental lookup misses
- [ ] `[AX]` Add explicit bounded full-resync mode with stable-ID deduplication
- [ ] `[AX]` Return `history_resync_limit` when full resync exceeds a bound
- [ ] `[AX]` Normalize historical messages and parts
- [ ] `[AX]` Use stable OpenCode IDs for idempotency
- [ ] `[AX]` Add backward-pagination, part-boundary, chronological-order, invalid-checkpoint, restart, and deduplication tests
- [ ] `[AX]` Handle missing and deleted OpenCode sessions
- [ ] `[APP]` Prefer Agentex `attachHistory` for OpenCode reconciliation
- [ ] `[APP]` Persist history checkpoints only after all associated events commit
- [ ] `[APP]` Add bounded full-resync fallback and typed limit handling
- [ ] `[APP]` Add restart and missed-event integration tests

Exit criteria:

- App restart followed by OpenCode session open catches up missed output without duplicates
- No OpenCode message ID is represented as a fake byte offset
- Existing Agentex `attachSession` consumers remain source compatible

### Milestone 9: Agentex Cursor current protocol

- [ ] `[AX]` Implement Cursor command and version discovery for `agent` and `cursor-agent`
- [ ] `[AX]` Produce an effective Cursor protocol and capability report
- [ ] `[AX]` Capture current real Cursor stream JSON fixtures
- [ ] `[AX]` Parse top-level tool started events
- [ ] `[AX]` Parse top-level tool completed events
- [ ] `[AX]` Correlate tool calls through `call_id`
- [ ] `[AX]` Parse incremental assistant text correctly
- [ ] `[AX]` Parse terminal result and failures
- [ ] `[AX]` Preserve session ID and raw events
- [ ] `[AX]` Use child-process cwd for workspace selection
- [ ] `[AX]` Remove undocumented `--workspace` from the default argv
- [ ] `[AX]` Replace obsolete `--yolo` with probed `--force`
- [ ] `[AX]` Validate current force, mode, model, resume, and cwd behavior
- [ ] `[AX]` Update parser and execute tests

Exit criteria:

- Current Cursor tool activity produces correct normalized events
- Unsupported flags are never passed to older binaries
- Existing older fixtures remain supported where practical

### Milestone 10: Agentex Cursor sessions, models, and auth

- [ ] `[AX]` Implement generic exec-backed session helper
- [ ] `[AX]` Add exec-backed helper tests with a mock resumable CLI
- [ ] `[AX]` Implement cancel and stopTask false-result behavior
- [ ] `[AX]` Integrate goal emulation and full lifecycle states
- [ ] `[AX]` Implement Cursor `createSession`
- [ ] `[AX]` Promote Cursor session IDs
- [ ] `[AX]` Resume later sends
- [ ] `[AX]` Retry unknown sessions once
- [ ] `[AX]` Define an attempt-acceptance marker per validated Cursor protocol profile
- [ ] `[AX]` Use the first matching `system:init` event as the acceptance marker for the validated current profile
- [ ] `[AX]` Buffer attempt events until resume success or rollover decision
- [ ] `[AX]` Flush buffered events immediately when the acceptance marker arrives
- [ ] `[AX]` Permit unknown-session rollover only before attempt acceptance
- [ ] `[AX]` Treat unknown-looking errors after acceptance as ordinary accepted-attempt failures
- [ ] `[AX]` Use successful process exit as a fallback acceptance marker only for a fixture-proven profile without an earlier marker
- [ ] `[AX]` Mark a protocol profile degraded when marker ordering violates its fixture-backed contract
- [ ] `[AX]` Quarantine failed-resume events and stale session IDs
- [ ] `[AX]` Emit only accepted rollover events to the host
- [ ] `[AX]` Reject overlapping sends
- [ ] `[AX]` Implement interrupt, close, and drain
- [ ] `[AX]` Implement Cursor model discovery
- [ ] `[AX]` Prefer machine-readable model output where available
- [ ] `[AX]` Add version-aware text parser fallback
- [ ] `[AX]` Report model discovery as upgrade-required when listing is absent
- [ ] `[AX]` Implement selected-binary `status` auth detection
- [ ] `[AX]` Detect native login and `CURSOR_API_KEY`
- [ ] `[AX]` Remove unverified OpenAI key detection
- [ ] `[AX]` Expose Agent, Plan, and Ask modes
- [ ] `[AX]` Gate each mode on a successful feature probe
- [ ] `[AX]` Set independent Cursor reasoning effort false
- [ ] `[AX]` Set in-chat model, effort, variant, and mode changes false until proving tests exist
- [ ] `[AX]` Set honest Cursor capability flags
- [ ] `[AX]` Add Cursor session, model, auth, and mode tests

Exit criteria:

- Cursor satisfies app `createSession` expectations
- A second send resumes the first Cursor session
- Buffered events become live at the profile acceptance marker rather than process exit
- Failed-resume attempt events never enter the accepted event stream
- Unknown-session rollover cannot occur after any event from that attempt becomes visible
- Grok models flow through discovery without special-case code

### Milestone 11: App Cursor integration

- [ ] `[APP]` Enable Cursor registry entry behind feature flag
- [ ] `[APP]` Add Cursor install and login guidance
- [ ] `[APP]` Add a dedicated precious-local encrypted agent credential store
- [ ] `[APP]` Reuse the existing AES-GCM SecretBox and file-permission pattern
- [ ] `[APP]` Add write-only Cursor API key set and clear routes
- [ ] `[APP]` Register the opened Cursor key with the runtime redactor
- [ ] `[APP]` Inject the opened key only as `CURSOR_API_KEY` in Cursor runtime context
- [ ] `[APP]` Add Cursor auth status UI
- [ ] `[APP]` Show selected command, version, protocol profile, and upgrade action
- [ ] `[APP]` Add native login and optional Cursor API key choices
- [ ] `[APP]` Add Cursor catalog and model allowlist UI
- [ ] `[APP]` Display Grok models exactly when Cursor reports them
- [ ] `[APP]` Add Cursor Agent, Plan, and Ask controls only when effective probes support them
- [ ] `[APP]` Hide unsupported permission, concurrent-send, stop-task, MCP, and catch-up controls
- [ ] `[APP]` Add Cursor resume command display
- [ ] `[APP]` Add Cursor new-chat and harness-switch tests
- [ ] `[APP]` Add old-binary upgrade-required UI test
- [ ] `[APP]` Add Cursor Grok selection integration test with fixture catalog
- [ ] `[APP]` Add sentinel tests proving the Cursor key never reaches logs, responses, SQLite, argv, or chat events

Exit criteria:

- User can choose Cursor and enable a reported Grok model
- Cursor chat runs and resumes
- No Grok harness exists anywhere in app state or UI

### Milestone 12: Executor capability cleanup

- [ ] `[APP]` Introduce harness-specific session config builders
- [ ] `[APP]` Remove unconditional Claude permission flag construction
- [ ] `[APP]` Use effective capabilities for every executor decision
- [ ] `[APP]` Make effort and variant validation capability-driven
- [ ] `[APP]` Make in-chat model, variant, effort, and mode changes independently capability-driven
- [ ] `[APP]` Start a new same-harness chat when a selection change cannot safely resume
- [ ] `[APP]` Make overlapping-send behavior capability-driven
- [ ] `[APP]` Make stop-task visibility capability-driven
- [ ] `[APP]` Make connector attachment capability-driven
- [ ] `[APP]` Make reconcile behavior capability-driven
- [ ] `[APP]` Make resume label and command registry-driven
- [ ] `[APP]` Add capability matrix tests
- [ ] `[APP]` Add maximum-versus-effective capability intersection tests

Exit criteria:

- No core executor branch assumes a two-harness world
- UI and API reject unsupported tuning explicitly
- Resume support never implies selection mutability

### Milestone 13: MCP hardening

- [ ] `[AX]` Prototype OpenCode typed MCP attachment
- [ ] `[AX]` Keep MCP secrets out of argv
- [ ] `[AX]` Add MCP health reporting
- [ ] `[AX]` Test cleanup of app-managed MCP entries
- [ ] `[AX]` Determine whether strict ambient MCP exclusion is provable
- [ ] `[AX]` Advertise strict isolation only after a proving test
- [ ] `[APP]` Enable OpenCode workspace connectors only for supported isolation level
- [ ] `[APP]` Keep Cursor app MCP disabled until an isolated configuration contract exists
- [ ] `[DOC]` Document the exact MCP security guarantees per harness

Exit criteria:

- Product wording matches tested isolation behavior
- No harness receives scoped connectors under a false strictness claim

### Milestone 14: Real-binary verification and release

- [ ] `[QA]` Install supported OpenCode binary in agentex development environment
- [ ] `[QA]` Install supported Cursor binary in agentex development environment
- [ ] `[QA]` Run OpenCode real-binary provider and model discovery test
- [ ] `[QA]` Verify the OpenCode server rejects unauthenticated health, API, and SSE requests
- [ ] `[QA]` Verify authenticated OpenCode health, API, and SSE requests succeed
- [ ] `[QA]` Verify failed OpenCode health startup kills the process
- [ ] `[QA]` Set and remove a disposable provider credential through the authenticated OpenCode 1.3.2 API
- [ ] `[QA]` Verify provider and model discovery after credential mutation use a new pool generation
- [ ] `[QA]` Run OpenCode real session and resume test
- [ ] `[QA]` Run OpenCode Allow once, Deny, and question bridge tests
- [ ] `[QA]` Verify no native OpenCode `always` response is sent
- [ ] `[QA]` Verify an approval in one app chat does not authorize another chat on the pooled project instance
- [ ] `[QA]` Verify OpenCode one-shot execution emits one terminal result after multiple steps
- [ ] `[QA]` Run OpenCode restart, backward-pagination, part-boundary, and service-checkpoint catch-up tests
- [ ] `[QA]` Inject OpenCode disconnect deletion failure and verify the saga remains safely retryable
- [ ] `[QA]` Retry the failed disconnect and verify already-absent credentials are treated as success
- [ ] `[QA]` Run Cursor real model discovery test
- [ ] `[QA]` Run Cursor real session and resume test
- [ ] `[QA]` Verify Cursor buffered events become live at the validated `system:init` marker
- [ ] `[QA]` Verify failed Cursor resume events are quarantined during rollover
- [ ] `[QA]` Verify Cursor never rolls over after attempt acceptance
- [ ] `[QA]` Run Cursor tool-correlation test
- [ ] `[QA]` Verify a Cursor-reported Grok model can execute
- [ ] `[QA]` Run full agentex suite
- [ ] `[QA]` Publish a new `@agentex/agent` version
- [ ] `[APP]` Upgrade app dependency and lockfile
- [ ] `[QA]` Run app typecheck, lint, targeted tests, and full tests
- [ ] `[QA]` Run populated-database migration smoke test
- [ ] `[QA]` Verify active-harness defaults and compatibility mirrors remain consistent
- [ ] `[QA]` Run manual settings UX pass with more than 1,000 OpenCode models
- [ ] `[QA]` Run secret redaction audit
- [ ] `[QA]` Include OpenCode server password and Basic authorization sentinels in the redaction audit
- [ ] `[QA]` Run supported, upgrade-required, degraded, and missing-binary capability passes
- [ ] `[DOC]` Update app README and onboarding help
- [ ] `[DOC]` Update agentex README capability table and changelog
- [ ] `[QA]` Enable maintainer feature flags
- [ ] `[QA]` Complete one stable maintainer cycle
- [ ] `[QA]` Enable OpenCode and Cursor by default

Exit criteria:

- Every acceptance criterion in section 19 is checked
- Both repositories are green
- OpenCode and Cursor are enabled without capability misrepresentation

## 21. Deferred follow-ups

These tasks are explicitly outside the first production release and should remain visible in backlog.

- [ ] `[AX]` Add new OpenCode credential-removal adapters only when a generated schema and fixture prove their semantics
- [ ] `[AX]` Add per-chat OpenCode server isolation if remembered approvals are required
- [ ] `[APP]` Expose remembered OpenCode approval only after isolation proves it cannot affect another app chat
- [ ] `[AX]` Reevaluate `@cursor/sdk` after its auth, billing, and stability tradeoffs change materially
- [ ] `[AX]` Investigate true OpenCode async prompt queue behavior
- [ ] `[AX]` Add native queued-message cancellation if OpenCode exposes it
- [ ] `[AX]` Add host queue cancellation for OpenCode and Cursor
- [ ] `[AX]` Add OpenCode per-task stopping if upstream exposes stable task controls
- [ ] `[AX]` Add Cursor durable transcript or export catch-up when a stable interface exists
- [ ] `[AX]` Add isolated Cursor MCP configuration
- [ ] `[APP]` Add model metadata filters for context, price, image support, and tools
- [ ] `[APP]` Add recommended model presets without auto-enabling new models
- [ ] `[APP]` Add per-workspace model allowlist overrides only if global allowlists prove insufficient
- [ ] `[APP]` Add provider-specific spend and quota views where a reliable source exists
- [ ] `[APP]` Add separate per-model tuning preference storage only if users need it
- [ ] `[APP]` Remove compatibility fields after all call sites use the registry and harness settings table

## 22. Source references

OpenCode:

- Models and variants: https://opencode.ai/docs/models/
- CLI model discovery: https://opencode.ai/docs/cli/
- Server API: https://opencode.ai/docs/server/
- Current server API and authentication: https://dev.opencode.ai/docs/server/
- Providers: https://opencode.ai/docs/providers/
- Configuration precedence: https://opencode.ai/docs/config/
- Permission documentation: https://dev.opencode.ai/docs/permissions/
- Permission implementation: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/permission/next.ts
- Permission routes: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/server/routes/permission.ts
- Question routes: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/server/routes/question.ts
- Session routes and history pagination: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/server/routes/session.ts
- Credential protocol: https://github.com/anomalyco/opencode/blob/dev/packages/protocol/src/groups/credential.ts

Cursor:

- CLI: https://cursor.com/en-US/cli
- CLI parameters: https://docs.cursor.com/en/cli/reference/parameters
- Stream JSON: https://docs.cursor.com/en/cli/reference/output-format
- Authentication: https://docs.cursor.com/en/cli/reference/authentication
- Model listing changelog: https://cursor.com/changelog/cli-jan-08-2026
- Modes changelog: https://cursor.com/changelog/cli-jan-16-2026
- SDK launch and billing: https://cursor.com/changelog/sdk-release
- SDK durable and custom stores: https://cursor.com/changelog/sdk-updates-jun-2026

Local source anchors:

- App agent selection: `src/lib/agent-options.ts`
- App model discovery: `src/lib/agent-model-discovery.ts`
- App executor adapter: `src/lib/executor/adapter.ts`
- App reconciliation: `src/lib/executor/reconcile.ts`
- App schema: `src/lib/db/schema.ts`
- Agentex OpenCode: `packages/agent/src/providers/opencode/`
- Agentex Cursor: `packages/agent/src/providers/cursor/`
- Agentex ACP base: `packages/agent/src/providers/acp/`
