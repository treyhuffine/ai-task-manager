# Performance Root Cause: Why Flow Feels Terrible in Prod

Date: 2026-07-22. Method: empirical measurement (curl timing matrix, headless browser waterfall, tunnel throughput experiments) followed by a 42-agent adversarially-verified source audit across ai-task-manager, beamd, and tunnel-server. 36 findings confirmed, 0 refuted.

Companion docs: `docs/perf-findings.md` (every verified finding in full detail with corrections folded in), `docs/nextjs-route-handler-gzip-bug.md` (the upstream Next.js compression bug, with repro and upstream history).

## Verdict

Prod slowness is five independent factors multiplying. None of them is server compute. The origin (ai-mac-mini, port 4224) answers `/api/tasks` (976KB) in 247ms. The user waits 19 to 46 seconds because those bytes are:

1. 4x larger than necessary (API JSON is never compressed, a verified Next 16.1.6 bug)
2. 5x larger than necessary again (list endpoints ship full rows, including 54KB task bodies)
3. squeezed through a beamd tunnel whose yamux config hard-caps every stream at 256KB in flight
4. riding a single unpaced TCP connection over a pathological link on ai-mac-mini (WiFi loss producing textbook 1s/2s/7s TCP RTO ladders)
5. preceded by a 7.08MB unsplit JS bundle whose ~40 parallel chunk requests saturate the tunnel send queue and inflate every TTFB to 1 to 6.5s

Dev is essentially healthy (5 to 10ms API responses). Every prod pathology is either tunnel-borne or a byte multiplier invisible at localhost throughput. Do not chase dev-side optimizations.

## Measured evidence

| Endpoint | Direct to origin (Tailscale) | Through beamd tunnel |
|---|---|---|
| /api/health | 23ms | 260ms to 2.7s |
| /api/tasks (976KB) | 247ms (4MB/s) | 19.0s (~53KB/s) |
| /api/notes (1.1MB) | 252ms | 17.9s |
| /api/stream (311KB) | 110ms | 4.1 to 8.7s |

- A single isolated 253KB download: 20s. Four concurrent copies of the same file: 1.5 to 4.5s each. Parallel beats serial per-stream, which rules out bandwidth and implicates flow control plus loss recovery.
- Browser page load on prod: root doc TTFB 4.85s, domReady 24.3s, 30 of ~40 chunks still pending at 45s.
- Idle dashboard makes ~28 requests/min (needs-review every 5s, runs-stats 5s, rail 15s, per-workspace session polls) even though SSE already invalidates the same keys.
- A control tunnel through the same edge binary from a healthy machine sustained 2.06MB/s single-stream, 3.3MB/s aggregate. The tunnel software ceiling is fine. The mini's link and the yamux config are not.

## Root causes, ranked by contribution

1. **beamd yamux at DefaultConfig** (beamd repo). 256KB max stream window, 128KB grant quanta. 976KB = 256KB + 6 grant cycles at the leg's ~2.9s effective RTT = 19.0s, matching measurement exactly. `internal/mux/mux.go:16-22`. Additionally all traffic rides one TLS TCP conn with unpaced back-to-back frame writes (`yamux session.go:478-527`), so solo bursts on a lossy link degrade to RTO recovery. That is why parallel transfers beat solo ones.
2. **ai-mac-mini's link is sick** (infra). 100% ARP/ICMP loss from a LAN peer, Tailscale disco pongs 0.9 to 2.1s, while the same LAN and WAN uplink serve another client at 61ms with 0% loss. The mini's WiFi or host power management is the loss source that the transport amplifies. Sub-window transfers (253KB fits inside the initial window) still swinging 4 to 20s proves this is independent of the window cap.
3. **API JSON never compressed** (Next 16.1.6 bug, work around app-side). Next's compression middleware is active but skips every App Router route handler: `sendResponse` copies headers via `appendHeader`, storing Content-Type as an array, and the compression filter requires a string so it bails. Reproduced on a clean Next app with DEBUG=compression. Static files and pages use string setHeader, which is why only they gzip. Fix in-handler. 976KB gzips to 256KB.
4. **Full-row list payloads** (app). `listTasks`/`listNotes` select every column at limit 10000 (`queries.ts:86, 99-111, 308-327`) and routes serialize verbatim. No task-list consumer reads `.body` (task-row uses it as a presence flag plus clamped tooltip). Slim DTO: ~2.2KB/row collapses to ~0.4KB/row. Worse hidden case: transcript route ships `chat_events.raw`, which is 95.4% of event bytes (5.47MB on the worst first page), read only for a subtype discriminator and background-task decode.
5. **7.08MB raw / 2.02MB gzip first-load JS, zero code splitting** (app). ExecutionView (xterm + CodeMirror, 1.54MB) statically imported at `dashboard.tsx:10` and `mobile-layout.tsx:5`. A pure string formatter (`tokenDisplay`) drags a 457KB crypto-browserify graph in via `devices-section.tsx:10 -> lib/auth/tokens.ts` (node:crypto at module top level). KaTeX 261KB and mermaid 228KB eager via streamdown plugins (`message.tsx:15-18`). emoji-mart data 433KB. tiptap 922KB. Double-bundled zod 405KB.
6. **yamux strict-FIFO send queue** (beamd). One 64-slot sendCh drained by a single sendLoop, no prioritization. ~40 concurrent chunk streams queue ~1.28MB ahead of any new response's first frame. Measured: root doc TTFB 4.09s, then the 63KB body in 0.13s. Pure queueing.
7. **Client fetch architecture built for localhost** (app). All three responsive layouts mount simultaneously (CSS-hidden, `dashboard.tsx:118-136`), duplicating an SSE connection, a reconcile POST, and deck fetches. ~28 req/min idle polling redundant with SSE. Focus refetch of every mounted heavy query after 30s (`query-provider.tsx:12-13`). Whole-family invalidations refetch 3 full task-list variants per mutation. No ETag/304 anywhere. Rail poll (15s) carries full rows including scratchPad and takeoverToken.
8. **Secondary beamd inefficiencies** (hardening, not headline): two conn.Write calls per data frame (two TLS records), single-miss 20s keepalive teardown that kills all tunnels under sustained congestion (verified latent, not the cause of measured outliers).
9. **Secondary app payload leaks**: search N+1 full-row hydration, entity-versions returning 50 full body snapshots on detail-page mount, stream externalPayload blobs, takeoverToken also exposed to agents via list_workspace_sessions (security finding independent of perf).

## Fix plan, ordered

Quick wins first. Interaction effects matter: gzip + slim DTOs = ~40 to 60KB on the wire, roughly 1s through the still-broken tunnel. The app becomes tolerable before beamd ships anything.

| # | Repo | Effort | Fix | Expected |
|---|---|---|---|---|
| 1 | beamd | 1h + deploy | `cfg.MaxStreamWindowSize = 4<<20` in `internal/mux/mux.go`. Deploy edge first (fixes downloads), then agent (uploads). | /api/tasks 19s -> 2 to 5s. Ceiling 256KB/RTT -> 4MB/RTT |
| 2 | infra | hours | Wire ethernet into ai-mac-mini (or fix WiFi association), disable Power Nap / WiFi power save. mtr to 134.122.126.212 during a slow episode to confirm. Do NOT touch router SQM, the shared uplink measured clean. Add tunnel-leg RTT p50/p99 metric via yamux Ping. | Kills the 1s/2s/7s RTO ladders and 20 to 46s outliers |
| 3 | app | 2-4h | `src/lib/api/json-response.ts`: gzip when body > ~4KB and client accepts, explicit content-length, Vary on both branches. Swap into heavy GET routes (tasks, notes, stream, rail, history, events, search, entity-versions, deck). File the array-Content-Type bug upstream to Next. | 3.8x fewer bytes on every API response |
| 4 | app | 30min | Move `tokenDisplay`/`TokenEnv` to crypto-free `src/lib/auth/token-display.ts`, update devices-section import, add no-restricted-imports lint guard. | Main shell chunk 1,280,861 -> 823,492 bytes (A/B verified) |
| 5 | app | half day | Slim list DTOs for /api/tasks and /api/notes routes only. Keep description/outcome/effort (deck rationale needs them). Replace body with 300-char excerpt + bodyLen + hasAttachments. Do NOT change listTasks/listNotes signatures or the 10000 default, they back the orchestrator agent contract. | 976KB -> ~200KB raw, ~40 to 60KB gzipped |
| 6 | app | 1-2 days | Code-split: dynamic ExecutionView at BOTH import sites, lazy KaTeX/mermaid streamdown plugins, async emoji-mart data, settings sections by SectionId, defer RichEditor into slideouts, trim lowlight grammars. | First-load JS 7.08MB -> ~1.6 to 2MB raw (~70% cut) |
| 7 | app | half day | Stop shipping chat_events.raw in transcript lists. Derived rawSubtype via json_extract, keep raw only for background-task rows. Rewire execution-transcript, execution-event, AND use-background-tasks.ts (silently breaks otherwise). Same projection on SSE resume path. | Transcript pages shrink 10 to 20x |
| 8 | app | 1-2 days | Fetch hygiene: single layout via matchMedia hook, polls stretched (needs-review/runs-stats 60s, rail 60s), SSE invalidation scoped to exact keys, mutation invalidations use setQueryData patching. | Idle traffic ~28 -> ~4 req/min |
| 9 | beamd | 1 day | Edge-side opt-in gzip in ReverseProxy ModifyResponse (defense in depth for all tunneled origins). | 3.8x for any origin that fails to compress |
| 10 | app | 1 day | ETag/304 in the jsonResponse helper. Validator = monotonic in-process write counter bumped in queries.ts mutation helpers (count+max(updated_at) is UNSAFE at 1s granularity). Cache-Control: private, no-cache. | Unchanged-data refetches become ~0-byte |
| 11 | app | 2-3 days | Query default overhaul WITH prerequisite SSE entity channel (agent writes currently reach the browser only via focus refetch). Then staleTime 5min, refetchOnWindowFocus false. | Kills the 5 to 15s tunnel storm per alt-tab |
| 12 | beamd | 1-2 wks | Transport rework: QUIC (quic-go) for the edge-agent hop, or h2 + fair scheduling + bounded socket buffers. Coalesce yamux header+body writes. Replace single-miss keepalive teardown with N-strike liveness. | p99 chunk fetch 20 to 46s -> 1 to 3s regardless of link episodes |
| 13 | app | 1 day | Payload cleanup tier: RailSessionDTO dropping scratchPad and removing takeoverToken from list serialization (keep on per-session GET, also slim the list_workspace_sessions agent action), batched search hydration, entity-versions list projection + GET-by-id route, exclude stream externalPayload from lists. | Rail shrinks several-fold and stops shipping a credential every 15s |

## Corrections from adversarial verification

- The keepalive teardown is real but NOT the cause of the 37 to 46s outliers (those transfers completed, impossible after teardown). Hardening, not root cause.
- Conn-pool striping does NOT fix the solo-transfer RTO pathology. Only QUIC tail-loss probes or fixing the link cure the solo case.
- count+max(updated_at) ETag validator is unsafe at datetime('now') 1s granularity. Use a monotonic write counter.
- Long staleTime without the SSE entity channel makes agent-side writes invisible for up to 5 minutes.
- The 112KB "polyfill chunk" is Next's nomodule polyfill, never fetched by modern browsers. Not a problem.
- zod@4 upgrade does NOT fix double-zod (@ai-sdk/provider-utils imports zod/v3 regardless).
- The slim task DTO must keep description/outcome/effort (deck card rationale reads them from list rows).
