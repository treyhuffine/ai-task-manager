# Internal UI API migration to tRPC

The browser's default [WebSocket transport](./trpc-websocket-trial.md) uses the same
router and cache layer, including typed terminal output subscriptions. HTTP
remains available for rollback and fallback. CLI, worker and external adapters retain their existing
protocol contracts.

Completed October 3, 2026. The migration started from main `11baca63` and
replaces every internal TypeScript UI JSON call with a server-inferred tRPC
procedure. There are 356 procedures, covering all application JSON domains.
The route inventory accounts for all 312 API route files: 258 shared-operation
paths, 13 core entity paths and 41 explicit protocol boundaries (the 41st,
`/sessions/[id]/reply-image`, came after: image bytes for an `<img>`).

## Architecture

Ri uses tRPC 11.19.0 with the official `@trpc/tanstack-react-query` integration.
TanStack Query owns caching, deduplication, retries, optimistic updates and
background reconciliation. `AppRouter`, `RouterInputs` and `RouterOutputs`
derive from the server. Entity write validators derive from Drizzle through
drizzle-zod, with explicit validators for hydrated JSON columns. Mutable inputs
exclude IDs, timestamps and lifecycle bookkeeping. Existing Zod 3 domain
validators use a typed Zod 4 bridge rather than an unvalidated JSON input.

The endpoint is `/api/trpc/[trpc]`, served by Next's Node-runtime fetch adapter.
`src/lib/trpc/router.ts` defines core entity procedures and composes the other
domains from `src/lib/trpc/operation-router.ts`. Procedures call the query
layer or typed operations in `src/lib/server/operations/`. Those operations
contain the domain behavior previously owned by route handlers. They return
plain typed success data or a structured refusal, and never call an HTTP
handler or make an HTTP request to Ri itself.

Public REST routes remain thin compatibility adapters over the same operations.
They preserve existing statuses, body limits and supported input normalization.
Both transports validate inputs before effects. Remote worker and private
service successes have schema validation at their boundary, so an unchecked
remote JSON body does not become the client contract. Refusals preserve their
original status, machine code, message, details and recovery body through the
tRPC error formatter.

Over HTTP every procedure is its own request (`httpLink`), as the REST API
was. A slow procedure never holds another's response, each call is its own row
and timing in the network tab, and calls with custom authorization or device
headers send them on their own request only. HTTP/2 to the public edge
multiplexes the requests. Until 2026-10-05 the client used `httpBatchLink`,
whose batch answered only when its slowest procedure did, and whose mutation
batch a drain admitted only when every procedure in it was a save.

If request count ever matters more than that, `httpBatchStreamLink` keeps
batching but streams each result as it finishes. Before switching, check that
the edge passes a streamed body through unbuffered (otherwise it behaves like
`httpBatchLink`), keep mutations on `httpLink` so a save never shares a
drain-gated batch, and accept that streamed bodies skip the app-side gzip.
Existing compression wraps large JSON responses. Attention reads keep the
200-ID limit per procedure, with larger boards split into bounded calls under
one TanStack query key.

The shared HTTP client supplies cookie/Bearer authentication, pairing recovery,
API protocol metadata and Home reachability reporting. The proxy authenticates
requests, rejects unsupported API protocols, checks cookie mutation origins,
and restricts worker/session tokens. Procedures require an authenticated viewer
key from that proxy. Signed caller headers, request signals, device placement,
owner checks, host-only controls and capability checks reach the domain
operations unchanged. Development procedures also enforce their production
gate inside the operation.

Both the service HTTP boundary and procedure middleware respect maintenance.
Reads and ordinary task/note/area saves may finish while draining. A mutation
request gets the save exception only when every path in it is a recognized
update procedure, which with `httpLink` is the one it carries. New work is refused during drain, and offline maintenance refuses
all procedures. Accepted work holds an activity lease until it finishes.
Pre-adapter authentication, protocol, maintenance and gateway failures retain
their HTTP status so document saves keep the correct recovery and retry policy.

## Migrated domains

- Tasks, notes and areas, including lifecycle commands, ordering, counts,
  deadlines, attention, execution summaries and continuation targets.
- Entity links, titles, versions and briefs, search, recents, stream capture
  metadata and triage, deck generation/settings, calendar and user state.
- Chats, executions, agent workspaces, references, previews, terminals,
  filesystem operations, worktrees, git and GitHub operations. Approval,
  conflict, delivery and lifecycle contracts remain intact.
- Harness management and authentication, model settings, skills and plugins,
  imports, triggers, runs and notification management.
- Device pairing metadata, keys, associations and native capabilities,
  service/Home settings, onboarding, browser management and development tools.

No internal UI JSON migration stages remain. The public adapters are retained
for external callers rather than duplicated implementations. No database
schema migration is required.

## Client caching and optimistic updates

Use `trpc.tasks.list.queryOptions(filter)` with `useQuery` and the procedure's
`mutationOptions` or `mutationKey` with `useMutation`. Existing domain hooks
remain the interface for guarded lifecycle changes and document autosaves.
Imperative API helpers call `trpcClient` directly, and their contracts infer
from the router instead of handwritten response types.

Core cache operations use `entityKeys` in `src/lib/query/entity-keys.ts`, which
delegates to tRPC's key factories. List/detail procedures are classified
explicitly so aggregate arrays cannot be mistaken for entity lists. Other
domains retain the shared query keys consumed by their hooks, components and
live-event invalidation. A cache key need not change to use a typed transport.

Task/note/area mutations preserve optimistic partial merges, rollback,
body-to-excerpt projection, detail seeding, non-optimistic list creation,
recurring completion handling and background settle. Server body echoes never
replace an open editor's live body. Reconnects and agent turn edges refresh
lists and aggregates while sparing open document bodies. Mutations carrying
unacknowledged typed input retain `meta: { carriesInput: true }` and the existing
unload guard. Failed autosaves keep drafts, including newer edits made while
an earlier save is in flight.

## Intentional HTTP and realtime boundaries

The explicit exceptions are protocols rather than application JSON consumers:

- Multipart attachments, image/audio capture and transcription uploads, file
  downloads and byte responses.
- Cookie session bootstrap, health/version discovery and device connection
  negotiation that must work before the typed viewer client is available.
- OAuth callbacks and event delivery, webhooks, MCP transports and public
  orchestrator action calls.
- Native desktop IPC, worker enrollment, grants, heartbeat, command/event
  delivery and worker byte streams.
- Live page/chat SSE, external terminal SSE compatibility and the playground's model stream.
- App package upload/download bytes, signed CLI forwarding at
  `/chat-sources/action` and `/local-apps/action`, the app process's versioned
  capability broker, and the backup CLI's pause/resume lease. App and source
  UI operations use the typed `localApps` and `chatSources` routers.

The exact route allowlist lives in
`src/lib/trpc/migration-coverage.test.ts`. Adding an application JSON route
requires a typed procedure. The coverage test rejects uncovered routes,
internal REST JSON calls and transport options that silently discard query
inputs. It also checks that domain operations do not import HTTP handlers or
perform raw database writes.

The multiplexed SSE stream continues to carry live chat and global events.
Browser terminals use an independent WS-only client for control, input and typed
output, even when ordinary API calls use HTTP. Terminal REST/SSE remains an
external compatibility protocol for execution and agent terminals, with no
browser terminal fallback. Home's own terminal (`home.terminals*`, output base
`/home`) is tRPC only, with no REST adapter. The browser's default WebSocket transport is
documented separately with loopback measurements and reconnect/replay behavior.
This migration does not claim that tRPC or WebSockets inherently
reduces latency.

React Native can share the TypeScript router contract. Configure
`createAppTRPCClient` with an absolute Home URL and an `ApiClient` token source,
and use the same TanStack Query behavior. A Swift/Kotlin client would need an
explicit language-neutral contract. Existing public protocols and shared
domain operations preserve that option.

## Verification

The integration suite uses a disposable Home, real SQLite queries, the auth
proxy and the tRPC fetch adapter. It covers compact list DTOs, verbatim bodies,
batching, bounded attention reads, nullable patches, write validation,
lifecycle conflicts/replay, recurring completion, deletion, scoped callers,
host-only controls and drain/offline admission. It also exercises workspace
updates, chat/scratchpad reads and writes, references, devices, integration
preferences, service settings and Home identity.

Cache and draft regressions cover optimistic edits/removal/rollback, lane
movement, aggregate isolation, body projection, refused/temporary saves and
typing during in-flight saves. Operation adapter tests cover defaulted query
forwarding, malformed JSON, UTF-8 body limits, native validators, remote output
validation and preservation of signed request metadata.

Production smoke testing also exposed an existing asynchronous embedding race
on overlapping saves. Metadata and vector writes now commit together, check
the current entity text and preserve their row ID during concurrent first
writes. Delayed responses cannot replace a newer edit or resurrect deleted
content. Backfill uses the same writer, and optional provider failures are
reported without rejecting a successful entity save. Eight SQLite regression
tests cover these behaviors, rollback and empty-document cleanup.

Final checks:

- Full regression suite: 5,034 tests passed, 35 skipped, across 513 passing and
  two skipped test files. Existing automated browser regressions passed.
- `pnpm ts`, production `pnpm build` and CLI/service `pnpm cli:build` passed.
- Authenticated smoke checks against the running production build and an
  isolated Home passed: nine batched domains, task create/read/update/delete,
  verbatim body persistence, compact list projection and public REST parity.
- Changed-file lint reports eight existing React-hook errors and 14 warnings.
  The errors were confirmed on the unchanged pre-migration versions. There are
  no new lint errors. Production builds retain existing broad file-tracing
  warnings in attachment saving and service environment discovery.

A manual visual smoke check could not run because this session's browser
control was unavailable. No production Home or user browser state was changed.

References: [TanStack integration](https://trpc.io/docs/client/tanstack-react-query/setup),
[fetch adapter](https://trpc.io/docs/server/adapters/fetch),
[error formatting](https://trpc.io/docs/server/error-formatting).
