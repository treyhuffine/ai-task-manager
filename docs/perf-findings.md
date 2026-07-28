# Performance Findings: Complete Verified Audit

Date: 2026-07-22. Companion docs: `docs/perf-root-cause.md` (ranked diagnosis and 13-step fix plan), `docs/nextjs-route-handler-gzip-bug.md` (the upstream Next.js compression bug).

Method: empirical measurement first (curl timing matrix through the tunnel and direct to origin over Tailscale, headless browser waterfall, isolated vs concurrent tunnel throughput experiments), then a 42-agent source audit across ai-task-manager, beamd, and the yamux dependency. Every finding below survived an adversarial verification pass by an independent agent instructed to refute it. 36 findings confirmed, 0 refuted. Verifier corrections are folded into each finding, so this document states the corrected truth, not the initial claims.

Severity is contribution to user-perceived prod slowness. The app is effectively healthy in dev (5-10ms API responses at localhost). Every prod pathology is either tunnel-borne or a byte multiplier that is invisible at localhost throughput.

## Baseline measurements

| Endpoint            | Direct to origin (Tailscale) | Through beamd tunnel       |
| ------------------- | ---------------------------- | -------------------------- |
| /api/health (36B)   | 23ms                         | 0.26s to 7.0s (RTO ladder) |
| /api/tasks (976KB)  | 247ms                        | 19.0s                      |
| /api/notes (1.1MB)  | 252ms                        | 17.9s                      |
| /api/stream (311KB) | 110ms                        | 4.1 to 8.7s                |

- 253KB static chunk: 20s solo, 1.5 to 4.5s each when fetched 4x concurrently. Parallel beats serial per stream.
- Control tunnel through the same beamd edge from a healthy machine: 2.06MB/s single stream, 3.3MB/s aggregate.
- Browser on prod: root doc TTFB 4.85s, domReady 24.3s, 30 of ~40 chunks still pending at 45s.
- Idle dashboard: ~28 requests/min. First-load JS: 7.08MB raw, 2.02MB gzip, 35 chunks.

---

## A. Tunnel transport (beamd + yamux)

### A1. [CRITICAL] yamux stream window left at the 256KB default

`internal/mux/mux.go:16-22` uses `yamux.DefaultConfig()`, so `MaxStreamWindowSize` = 256KB with window grants only in 128KB quanta (grants are skipped while delta < max/2). Per-stream throughput is hard-capped at 256KB per effective RTT. The math reproduces the measurements exactly: 976KB = 256KB initial + ~6 grant cycles at the leg's ~2.9s effective RTT = 19.0s measured. Each stream carries its own independent window, which is one reason parallel transfers beat serial.

**Fix.** `cfg.MaxStreamWindowSize = 4 << 20` (4MB default, 8-16MB behind a knob, budget memory as window x max concurrent streams). Deploy edge first: the receiver's config governs advertised grants, and since the edge opens each stream before the response is written, the first window update carries a huge grant before the first response byte, so downloads are fixed by the edge alone. Ship the agent binary after for uploads (one 256KB initial-window stall remains on large request bodies until then). Interop with old peers is safe, window updates are deltas.

**Nuance from verification.** The 256KB window is the cap for transfers larger than 256KB. It is NOT the cause of sub-window pathologies: a 253KB chunk fits inside the initial window and still swung 4 to 20s. That is finding A2.

npm run status:production

**The loss source is ai-mac-mini's own link or host**, not the router or WAN uplink: a LAN peer reaches DigitalOcean at 61ms with 0% loss simultaneously, while the mini is 100% ARP/ICMP unreachable from that same LAN peer and answers Tailscale disco pongs in 0.9 to 2.1s even on the direct LAN path. The mini is on WiFi.

**Fix.** Immediate: wired ethernet on the mini (or repair the WiFi association), disable Power Nap and WiFi power save on the headless host, run mtr to 134.122.126.212 from the mini during a slow episode to confirm. Do NOT touch router SQM, the shared uplink measured clean. Permanent: QUIC for the edge-agent hop (per-stream loss recovery, PTO tail-loss probes, userspace pacing; note quic-go mainline ships Reno/Cubic, not BBR). Conn-pool striping does NOT fix the solo case, a solo transfer still rides one conn.

### A3. [HIGH] Strict-FIFO shared send queue inflates TTFB to 1-6.5s under load

Every frame from every stream (data, SYNs, window updates, pings) drains through one 64-slot sendCh FIFO and a single sendLoop (`yamux session.go:109, 478-527`). Writers block until their frame hits the wire, so each stream contributes at most one 32KB frame at a time: with ~40 concurrent page-load streams, ~1.28MB queues ahead of a new response's first byte, ~3.2s at the leg's ~400KB/s. The kernel TCP send buffer below sendLoop is a second unprioritized FIFO of the same class. Measured proof it is pure queueing: root doc TTFB 4.09s, then the 63KB body arrived in 0.13s.

**Fix.** Real: HTTP/2 or QUIC framing with fair round-robin data scheduling, plus bounded kernel socket buffers (small SO_SNDBUF or write pacing), or the kernel FIFO defeats mux-level fairness. A control-frame priority lane alone would NOT fix TTFB, a response's first byte is a data frame. Mitigations in the current stack: smaller frames (note `io.CopyBuffer` ignores its buffer when src implements WriterTo, so the backend conn must be wrapped in a bare `io.Reader` struct to actually get 16KB frames), fewer bytes overall (compression, slim DTOs), fewer requests (bundle splitting).

### A4. [HIGH] Keepalive teardown kills every tunnel on one missed pong (latent, not the measured cause)

`mux.Config` sets KeepAliveInterval 20s and ConnectionWriteTimeout 30s. One keepalive that cannot complete within 30s closes the entire yamux session, killing every in-flight request on every tunnel, followed by reconnect with backoff. Verification proved this is NOT the cause of the measured 37 to 46s outliers (those transfers completed, impossible after teardown), but it is a real all-tunnels-dead failure mode under sustained congestion, and raising the window (A1) deepens queues, making it more reachable.

**Fix.** Do not simply raise ConnectionWriteTimeout (it also bounds every data send and slows dead-link detection). Disable yamux keepalive (`EnableKeepAlive: false`) and implement N-strike liveness in the existing app-level heartbeat (`heartbeatLoop`, `client.go:639`, plus the edge watchdog), or vendor keepalive() with consecutive-miss tolerance.

### A5. [MEDIUM] Two conn.Write calls per data frame = two TLS records

sendLoop writes the 12-byte header and the body as separate Writes (`yamux session.go:488, 514`), so every data frame becomes two TLS records and typically two segments on sparse traffic. More packets on a lossy leg means more loss-lottery tickets. Window updates and pings are header-only single Writes, they are not doubled.

**Fix.** A yamux-header-aware wrapper that holds only typeData headers with Length > 0 until the following body Write (safe, sendLoop is the sole writer), or vendor yamux to assemble one buffer per frame. Do NOT use net.Buffers on a `*tls.Conn`, tls.Conn lacks writev support and degrades back to two records. Goes away for free under QUIC/h2.

### A6. [LOW] Per-write flush fragments the public h2 side for chunked bodies

The edge's `httputil.ReverseProxy` has no FlushInterval, and Go forces immediate per-Write flush whenever ContentLength is -1, which covers every chunked Next.js API response. Each backend read becomes its own h2 DATA frame + TLS record. FlushInterval genuinely cannot tune this (the -1 branch wins). Aggravating overhead, not a root cause.

**Fix.** A read-coalescing body wrapper via ModifyResponse (flush at 16KB or 20ms, immediate for text/event-stream; upgrades bypass copyResponse and need no carve-out). Fixing origin compression moots most of it by shrinking bodies to single bursts.

### A7. [HIGH] The edge never compresses identity-encoded responses

The ReverseProxy forwards backend bytes verbatim (no compression code exists in `internal/`). Combined with the Next bug (B1), 976KB rides the constrained hop where 256KB would.

**Fix.** Opt-in edge gzip in ModifyResponse: when the inbound request accepted gzip, the backend sent no Content-Encoding, and Content-Type is compressible, wrap in `gzip.Writer` (flate.BestSpeed), strip Content-Length, set Content-Encoding + Vary, skip text/event-stream and upgrades. Scope note: this helps identity-encoded responses only (~3.8x on API JSON). The already-gzipped static chunks gain nothing, their slowness is A1/A2. Defense in depth for every tunneled origin, not just Flow.

---

## B. API layer (ai-task-manager)

### B1. [CRITICAL] Route-handler JSON is never compressed (upstream Next bug, work around in-app)

Full mechanism, repro, and upstream history in `docs/nextjs-route-handler-gzip-bug.md`. Short version: Next's compression middleware is active but skips all App Router route handlers because headers arrive as arrays and its filter requires strings. No config fix exists.

**Fix.** `src/lib/api/json-response.ts`: `jsonResponse(data, request)` that stringifies, and when body > ~4KB and the request accepts gzip, returns gzipped bytes with explicit Content-Length (also kills chunked encoding) and `Vary: Accept-Encoding` on BOTH branches. Swap into the heavy GETs: tasks, notes, stream, sessions/rail, sessions/history, sessions/[id]/events, search, entity-versions, deck. Verified on Next 16: 593,781 to 4,881 bytes in the repro, ~3.8x expected on real payloads. gzipSync blocks the event loop ~10-30ms at 1MB, acceptable. File the bug upstream.

### B2. [CRITICAL] /api/tasks and /api/notes ship every column of every row

`listTasks`/`listNotes` select all columns (body, description, rawInput, aiContext, userContext, foldedHeadings) with a default limit of 10000 (`queries.ts:86, 99-111, 308, 319-327`) and the routes serialize rows verbatim. 436 tasks = 976KB (~2.2KB/row), largest single body 54KB. No task-list consumer reads `.body` (TaskRow uses it as a presence flag plus a clamped tooltip, `task-row.tsx:297-310`). Detail views already fetch `/api/tasks/:id` separately.

**Fix (with verified constraints).** New `listTaskItems`/`listNoteItems` projections wired into the two HTTP routes only:

- Tasks keep: id, timestamps, parentId, areaId, workspaceId, title, status, energy, effort, hardDeadline, reminderAt, resurfaceAfter, sortKey, blockedOn, recurrence, completedAt, lastViewedAt, contextTags, subtaskCount, subtaskPreview. MUST also keep description and outcome: `deck-container.tsx:51-54` builds deck card rationale from them, dropping them silently blanks deck cards. Replace body with a 300-char SQL excerpt + bodyLen + hasAttachments. Drop rawInput, aiContext, userContext, foldedHeadings, attachments.
- Notes keep: title, 300-char body excerpt (note-row derives display title and preview from body), url, areaId, taskId, status, lastViewedAt, timestamps. Behavior note: `promote-actions.tsx:132` searches merge targets over full note bodies client-side, either accept excerpt-only matching or move that search server-side.
- Do NOT change `listTasks`/`listNotes` signatures or the 10000 default: they back the orchestrator agent actions `list_tasks`/`list_notes` (`registry.ts:194, 266`), the public agent contract. Do NOT excerpt stream rawText: stream UI renders full rawText and promote drafts build from it, truncation would corrupt promoted bodies.

Expected: ~0.4KB/row, 976KB to ~200KB raw, ~40-60KB gzipped with B1.

### B3. [HIGH] Transcript route ships chat_events.raw, 95% of event bytes

`GET /api/sessions/:id/events` returns full rows including the raw provider payload at up to 1000 rows per page. Dev DB measurement: raw = 1,145,662,940 bytes vs content 41MB + toolInput 13MB across 222,789 events. Worst session first page: 5.47MB, 99.4% raw. The UI reads raw only for a subtype discriminator and background-task decode.

**Fix (with verified constraints).** Project raw out of the list query, add derived `rawSubtype` (`json_extract(raw,'$.subtype')`), keep raw (or the decoded payload) ONLY for background-task rows identified by `source='background_task' OR (source='system' AND (content='background_task' OR content LIKE 'task_%'))`, which retains ~1.1MB of the 1.14GB. Apply the same projection to the SSE resume path (`listChatEventsAfter` via `sessions/[id]/stream/route.ts:97`). Rewire THREE consumers: `execution-transcript.tsx:399`, `execution-event.tsx:313`, and `use-background-tasks.ts:59,145` (the original finding missed the last one, skipping it silently breaks the background-tasks bar). Add `?include=raw` or a single-event endpoint for future full-payload needs.

### B4. [HIGH] No ETag/304 on any JSON data GET while the client refetches aggressively

No data endpoint sets ETag or Cache-Control, so every refetch (focus refetch, 15s rail poll, family invalidation) re-downloads the full payload even when nothing changed.

**Fix (with verified constraints).** Build into the B1 helper: weak ETag, If-None-Match compare, 304 with empty body, `Cache-Control: private, no-cache` so the browser cache revalidates transparently under the existing plain-fetch ApiClient with zero TanStack changes. The validator MUST NOT be count + max(updated_at): `datetime('now')` has 1-second granularity, so same-second successive writes produce a false 304 that hides the newest write on the mutate-invalidate-refetch hot path. Use a monotonic in-process write counter bumped per table in the queries.ts mutation helpers (valid, the server is a single process owning the SQLite file, a restart just forces one full refetch).

### B5. [MEDIUM] Rail and session list endpoints ship full rows including a live credential

`listRailSessions`/`listHistorySessions`/`listWorkspaceExecutions` select every chat_sessions column (scratchPad markdown, externalHistoryCheckpoint) plus every executions column, and `flattenSessionExecution` (`queries.ts:2978-2999`) duplicates execution fields, including `takeoverToken` at :2996, into flattened copies alongside the nested object. The rail is polled every 15s. The orchestrator action `list_workspace_sessions` (`registry.ts:1071-1072`) returns the same full rows including takeoverToken to the agent surface. Additionally `listChatSessions` has no SQL limit and orchestrator-chat history loads every chat then slices to 50 in JS.

**Fix (with verified constraints).** RailSessionDTO keeping the rail's read set plus fields with verified consumers: agentId, externalSessionId, prNumber (orchestrator `list_executions` reads them), workspaceAttachments (rail status pills render them). ChatSearchResult extends RailSessionRow (`queries.ts:3747`), update or decouple it in the same change. Drop scratchPad, externalHistoryCheckpoint, setupScriptError bodies. Remove takeoverToken from ALL list serialization (keep on per-session GET, the takeover flow uses per-session endpoints), and slim the `list_workspace_sessions` action output. Push a limit into listChatSessions SQL.

### B6. [MEDIUM] /api/search: N+1 point lookups returning full rows for a snippet UI

The search route loops up to 100 hits doing one `db.select().get()` per hit with direct Drizzle in the handler (against the queries.ts rule) and returns complete rows (`search/route.ts:44-67`). Same rule violation in `recents/route.ts:11-38` (that one at least projects).

**Fix (with verified constraints).** `searchHydrate(hits)` in queries.ts batching with three inArray selects. Projection must include everything the overlay reads: id, entityType, title, description (`search-overlay.tsx:344-346`), createdAt (non-optional in SearchResult), status, areaId, score, hasBody boolean (`length(trim(body))>0`, line 340 branches on it), snippet (substr of body). The stream branch needs column mapping (no title/description/body/areaId): first line of rawText as title, following the COALESCE/substr pattern in recents. Drop attachments from the projection.

### B7. [LOW] /api/entity-versions returns up to 50 full body snapshots eagerly

Every note/task detail page and slideout mount fetches the full snapshot list (each snapshot embeds the entity's complete body at that point). A 20KB note edited 50 times = ~1MB response, before the user ever opens version history.

**Fix (with verified constraints).** Project the list to id, source, createdAt, entityType, entityId, summary, bodyLen. Keep id/source/createdAt/summary because `groupVersions` (`use-entity-versions.ts:45-61`) computes author-run groups from them. The cited on-demand route does not exist yet: `/api/entity-versions/[id]` only has POST revert, add a GET backed by the existing `getEntityVersion()` (`queries.ts:532`).

### B8. [LOW] Stream list carries externalPayload audit blobs

`listStream` selects all columns including externalPayload (full inbound webhook payload kept for audit/replay) while the UI renders rawText, status, media, source, outcomes, attachments. Magnitude today is unproven (local stream table empty), but it scales the hot capture surface as connectors land.

**Fix.** Exclude externalPayload (and dismissedBy/externalId) from the list projection, keep on `getStream(id)`. This also changes the orchestrator `list_stream` action output (`registry.ts:389`), do it deliberately on both surfaces with a trimmed list type rather than silently narrowing the shared type.

---

## C. Client fetching (ai-task-manager)

### C1. [CRITICAL] All three responsive layouts mount simultaneously

DashboardShell renders MobileLayout (md:hidden), TabletLayout (hidden md:flex lg:hidden), and desktop PowerRail+PanelLayout (hidden lg:flex) as always-mounted trees (`dashboard.tsx:118-136`). Genuinely duplicated network on desktop: a second EventSource to `/api/sessions/:id/stream` plus doubled per-frame invalidateRail refetch pressure, a second reconcile POST, doubled markRead mutations, and doubled `/deck` + `/deck/versions` GETs (DeckContainer uses raw api.get + useState, not TanStack, so nothing dedupes). The needs-review poll itself is a shared TanStack key, so it is coalesced, its cost is being permanently active regardless of rail state.

**Fix.** Mount exactly one layout via a matchMedia hook (useSyncExternalStore) mirroring the Tailwind breakpoints. Independently move DeckContainer's fetches into useQuery keys, which also survives breakpoint remounts (crossing a breakpoint loses local useState today).

### C2. [CRITICAL] Global staleTime 30s + refetchOnWindowFocus refetches every heavy list per alt-tab

`query-provider.tsx:12-13`. Every focus after 30s idle concurrently refires ~10 mounted queries: tasks, areas, workspaces, stream, rail, needs-review, runs-stats, user-state, day-shape, orchestrator-chat, PLUS `useSessionEvents` (`use-execution.ts:129`) which refetches the full 1000-event transcript page and is likely the single largest payload on the default dashboard. Cost: ~5 to 15s of tunnel saturation per alt-tab at measured aggregate throughput.

**Fix (with verified prerequisite).** Defaults staleTime 5min, gcTime 30min, refetchOnWindowFocus false, opting back in per endpoint where focus freshness is cheap (rail, needs-review, runs-stats, runtime-status, calendar). HARD PREREQUISITE: ship an SSE entity channel on the existing realtime bus first (publish task/note/stream change frames from the queries.ts mutation layer). Agent-side writes (orchestrator, triage, CLI/MCP) currently reach the browser ONLY via focus refetch and polls, flipping defaults alone makes agent-created entities invisible for up to 5 minutes.

### C3. [HIGH] Steady-state polling storm, ~28 req/min idle, redundant with SSE

`use-runs-stats.ts:23` (5s), needs-review (`use-workspaces.ts:57`, 5s), rail (:272, 15s), history (:288, 60s), plus execution-view polls: preview 4s or 1.5s fast mode, PR 20s, tree 30s, runtime 5s while active. The SSE layer already invalidates rail and needs-review on every meaningful edge (`use-global-session-stream.ts:16-18`), the polls are safety nets at aggressive periods. With an execution view open the total approaches 50-60 req/min. Polls are a secondary aggravator (per-stream throughput improves under concurrency), their cost is TTFB inflation and connection-slot occupancy under fan-out.

**Fix (with verified constraints).** SSE as primary, polls stretched: needs-review 5s to 60s, runs-stats 5s to 60s (or fold into the rail payload), rail 15s to 60s, PR 20s to 120s. Do NOT derive needs-review client-side from rail rows as-is, it is not semantics-preserving: needs-review LEFT JOINs executions with no workspace filter and can return sessions absent from the rail, and the morning-deck exclusion needs runs.triggerId which rail rows lack. Deriving requires extending the rail payload first. Preview status: push a frame on the existing per-session SSE channel, or 15s with the 1.5s fast window kept.

### C4. [HIGH] Broad prefix invalidations turn single events into refetch storms

Both SSE consumers invalidate the `['workspaces']` prefix on every session_updated edge (`use-session-stream.ts:63-67`, `use-global-session-stream.ts:16-18`), refetching every mounted workspace query. Every task/note/stream mutation invalidates the whole `['tasks']`/`['notes']` family, refetching all mounted filter variants (three distinct task-list keys: deck {status:active,limit:50}, task-list {status:active,orderBy:lastViewedAt}, and the shared {status:active} used by promote-actions and week-overlay). The doubled SSE consumers cost one aborted plus one completed request per edge (TanStack cancelRefetch), aborted transfers still consume tunnel bandwidth.

**Fix.** Scope SSE invalidation to `['sessions','rail']`, `['sessions','needs-review']`, and `['workspaces', workspaceId, 'sessions']` (the frame carries sessionId, the rail cache maps it to workspaceId). Safe: session-creation flows already invalidate `['workspaces']` via their mutation hooks. For entity mutations, setQueryData patching across variants or exact-key invalidation.

### C5. [MEDIUM] Waterfalls: session-open gating and the deck's serial chain

First open of a session per page load serializes GET `/api/sessions/:id`, then status/diff/tree/pr/wip fire only after scope resolves (`use-execution.ts:62-66, 241-275`), one extra 0.3-6.5s tunnel round trip. The deck serializes tasks, then `/deck`, then `/deck/versions` (`deck-container.tsx:240-255`), main content paints after 2 serial hops, versions completes the third. The deck's first hop is the filtered tasks query, not the 976KB unfiltered one.

**Fix.** Seed `['session', id]` from the rail row on navigation via setQueryData (direct in-repo precedent: `useNewExecutionChat` at `use-execution.ts:554-561` does exactly this, RailSessionRow is shape-compatible, and the seeded entry stays stale so the refresh proceeds in parallel). For the deck: return {deck, versions} in one response, or fetch them in parallel (`/deck/versions` already accepts an optional date).

---

## D. Bundle (ai-task-manager)

First-load JS: 7.08MB raw / 2.02MB gzip in 35 chunks plus 227KB CSS. Zero next/dynamic or React.lazy boundaries exist anywhere in src/components. Static chunks are already gzipped on the wire, so compression fixes do not help here, only code splitting and tunnel fixes do. The ~40-request fan-out is also what saturates the tunnel FIFO (A3) and inflates API TTFB during loads. A fresh production build (NEXT_DIST_DIR=.next-bundle-audit) reproduced identical sizes. No server-only libs (xlsx, mammoth, officeparser, sharp, unpdf) leak into client chunks.

### D1. [CRITICAL] The entire executions view (xterm + CodeMirror) in first-load JS

The 1.54MB chunk is the executions view: xterm core 345KB, plus a 986KB merged module with CodeMirror view/state/merge, language parsers, diff viewer, file tree, preview panels. Loads on first paint even when no coding session is ever opened. Import chain: `dashboard.tsx:10` imports ExecutionView, AND `mobile-layout.tsx:5` imports it again (MobileLayout is statically imported at `dashboard.tsx:19`).

**Fix.** next/dynamic({ssr:false}) at BOTH import sites, fixing only dashboard.tsx leaves a static edge that keeps the subtree in the bundle. Optional refinement: dynamic ExecutionTerminalInstance inside execution-terminal-panel.tsx and FileView/DiffView inside `file-viewer.tsx:35-36` (not viewer-area, DiffView is imported by file-viewer). Removes ~1.54MB raw / ~470KB gzip.

### D2. [CRITICAL] 457KB crypto-browserify graph pulled by a pure string formatter

`devices-section.tsx:10` imports `tokenDisplay` from `@/lib/auth/tokens`, whose module top level does `import { createHash } from 'node:crypto'`. tokenDisplay is pure string interpolation. The polyfill graph (asn1.js, bn.js twice, elliptic tables, diffie-hellman primes, readable-stream, buffer) lands in the main shell chunk. Verified by A/B build: 1,280,861 to 823,492 bytes (457KB raw, ~120-150KB gzip).

**Fix.** Move tokenDisplay and TokenEnv to a crypto-free `src/lib/auth/token-display.ts`, update the devices-section import. Guard with an ESLint no-restricted-imports rule on `@/lib/auth/tokens` from client code. Do NOT use `import 'server-only'` without verification: the package is not installed and tokens.ts is imported by `src/proxy.ts` (middleware), where the react-server condition guard may break the build.

### D3. [HIGH] Tiptap/ProseMirror stack (922KB) eager via slideouts AND composers

RichEditor (with `createLowlight(common)`, ~37 highlight.js grammars) is statically reachable via note/task slideouts (`dashboard.tsx:13-14`). Deferring RichEditor alone recovers ~300-500KB (the 289KB lowlight/markdown chunk plus RichEditor-only code) but NOT the 385KB tiptap+prosemirror core: the chat composer (`chat-input-editor.tsx:40-44`, reachable at startup via ContentPanel, ExecutionComposer, ScratchpadPane) statically imports @tiptap/react, starter-kit, core, and pm.

**Fix.** Defer RichEditor into the slideouts, trim `createLowlight(common)` to an explicit grammar list (ts/js, python, json, bash, html via hljs 'xml', css, markdown, ~100KB permanent win). Recovering the tiptap core requires also deferring the composer surfaces, optional second pass.

### D4. [HIGH] KaTeX (261KB) and mermaid (228KB) eager via streamdown plugins

`ai-elements/message.tsx:15-18` statically imports all four @streamdown plugins. Math and diagrams are rare in chat output. Scope note: this is ~489KB of a ~6.5MB eager entry, real but not the biggest lever. The 453KB parse5/micromark markdown chunk is untouched by this fix (streamdown core needs it regardless).

**Fix.** Keep cjk/code static, dynamic-import math and mermaid plugins on first occurrence of their syntax (or wrap MessageResponse in next/dynamic).

### D5. [HIGH] Full emoji-mart data JSON (433KB raw) plus picker (122KB) eager

`shared/emoji-picker.tsx:5-6` statically imports the data and Picker. Direct importers: area-create-modal.tsx:7, workspace-create-modal.tsx:9, workspace-settings-sheet.tsx:10, welcome step-areas.tsx:4. Wire cost ~126KB gzipped as two extra startup requests, parse cost the full 433KB JSON.

**Fix.** emoji-mart supports async data via the data promise prop, or next/dynamic the whole EmojiPicker behind the popover trigger (it only renders after click, low risk).

### D6. [MEDIUM] ai SDK chunk carries zod twice plus ~26-40 zod v4 locales (405KB)

`content-panel.tsx:12` imports from 'ai', whose chunk bundles zod v3 classic AND v4 core plus the full locale set. Mechanism: @ai-sdk/provider-utils statically imports both zod/v3 (its zod3-to-json-schema compat layer) and zod/v4, and `import * as z4 from "zod/v4"` + `export * as locales` defeats tree-shaking. Upgrading the app to zod@4 does NOT fix it (provider-utils still imports ./v3).

**Fix.** Turbopack resolve alias mapping the zod/v4 locales barrel to an en-only stub, an upstream issue on @ai-sdk/provider-utils to drop the client-side v3 compat path, or keep 'ai' imports out of the always-loaded chunk by code-splitting the chat surface.

### D7. [MEDIUM] Settings modal statically bundles all 10 sections, and its heavy leaves have second import paths

`settings-modal.tsx:22-31` statically imports every section though the modal starts closed. The two heavy leaves are ALSO reachable outside settings: qrcode via ExecutionView, ViewerArea, PreviewPane, OpenOnDevice (`open-on-device.tsx:19`), and connector-icon-data via MobileAgentsView, WorkspaceCreateModal, ConnectorScopePicker (`connector-scope-picker.tsx:15`).

**Fix.** Dynamic sections keyed by active SectionId (render on first visit, keep mounted), PLUS lazy-load the shared leaves themselves (dynamic 'qrcode' import inside qr-code.tsx, dynamic ConnectorLogo/icon data), which covers all present and future consumers.

### D8. [LOW] Shiki's buffer polyfill and a 254KB chunk emitted five times

The 22.7KB buffer polyfill copy in the response-rendering chunk is pulled by shiki and survives the D2 fix (which only removes the crypto-side copy). Bigger win the original finding missed: the 254,208-byte response-rendering chunk is emitted five times under different hashes for five routes (/, /task/[id], /note/[id], /playground, /dev/execution-chat), so the same ~254KB re-downloads on each route.

**Fix.** Extract it into a shared chunk, lazy-load shiki or alias out its node buffer polyfill. Also: the 112KB "polyfill chunk" flagged early in the audit is Next's own nomodule polyfill, never fetched by modern browsers. Not a problem, do not chase it.

---

## Non-findings (verified healthy)

- Server compute: all measured endpoints answer in 23-250ms at the origin, including the 976KB tasks serialization. SQLite and the query layer are not the bottleneck at current data size.
- `batchStreamOutcomes` is properly batched, no N+1.
- No server-only libraries leak into client chunks.
- Dev-mode performance: dominated by first-compile and bundle parse, not worth chasing, every fix above that matters in dev (bundle) also matters in prod.

## Interaction effects (why fix order matters)

- gzip alone: /api/tasks 19s to ~4.8s through the untouched tunnel.
- Slim DTOs alone: 19s to ~4s.
- gzip + slim DTOs: ~40-60KB on the wire, ~1s through the BROKEN tunnel. The app becomes tolerable before beamd ships anything.
- Window raise (A1) fixes multi-window transfers, but sub-window RTO outliers persist until the mini's link is fixed (A2) or QUIC lands.
- Window raise + link fix: single stream approaches the 3.3MB/s conn ceiling, which is what actually fixes static chunk loads and domReady (already gzipped, unhelped by B1).
- Bundle split cuts the request fan-out ~40 to ~10-15, draining the FIFO (A3) and dropping API TTFB during loads independent of any beamd change.
- Compression makes 304s cheaper, 304s make compression irrelevant for unchanged data. Together steady-state tunnel traffic approaches zero.
