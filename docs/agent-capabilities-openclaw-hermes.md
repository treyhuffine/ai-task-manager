# Agent Capabilities: Browser Bake-In and a Native Capability Roadmap

> Source study of two vendored runtimes, OpenClaw (`examples/openclaw`) and Hermes (`examples/hermes-agent`), and a proposal for what Flow should adopt. Includes a full ranked and tagged catalog of everything both runtimes give their agent, including the items we recommend skipping.
>
> Status: Draft, 2026-08-20. Author: orchestrator session.

## Contents

1. Purpose
2. How OpenClaw and Hermes actually work
3. Proposal A: Browser as a first-class Flow capability
4. Proposal B: Capability roadmap for Flow
5. Full capability catalog (ranked and tagged)
6. Architectural principle to carry across all of these
7. Open questions and next steps

---

## 1. Purpose

Flow needs to give its agents real-world reach (read a paywalled article, push a reminder to the user, turn a PDF into a note) without turning every new capability into a bespoke script. This doc does two things:

- Proposes a concrete design for baking **browser control** into Flow as a first-class, batteries-included capability, portable across machines and backends.
- Surveys **every native capability** OpenClaw and Hermes ship, ranks each for a personal tasks and notes assistant, and tags what to build, what we already have, and what to skip.

The context that triggered this: the `medium-review` workflow needs to read Medium article bodies, which are member-only. A plain HTTP fetch returns 403. OpenClaw solves this by driving a logged-in Chromium. That single need generalizes into a capability strategy.

---

## 2. How OpenClaw and Hermes actually work

A correction worth stating up front, because it changes the design.

**Neither runtime talks to the browser (or most tools) over MCP.** Both implement capabilities as **native agent tools** that call the underlying system directly, and both put swappable backends behind a single tool via a **provider or adapter registry**.

- OpenClaw: native tools live in `src/agents/tools/` and are catalogued in `src/agents/tool-catalog.ts`. Extra capabilities are plugins under `extensions/<name>/` with a manifest. The browser tool (`extensions/browser/src/browser-tool.ts`) drives Chromium over the Chrome DevTools Protocol (CDP). Its `status` reports `transport: cdp`. It only consumes an MCP for one narrow backend mode (attach to an already-open Chrome via Chrome DevTools MCP).
- Hermes: native Python tools in `tools/*.py` self-register into a tool registry, catalogued in `toolsets.py`. Swappable backends sit behind provider registries such as `agent/web_search_provider.py`, `agent/memory_provider.py`, `agent/tts_provider.py`, and `agent/browser_provider.py`. Hermes has a separate `mcp_serve.py` that exposes its whole toolset over MCP to external clients, which is an outbound integration surface, not how it drives anything.

**Implication for Flow.** MCP is the right layer for handing capability to an outside agent (Claude Code, Codex). For capability we own inside Flow, the correct pattern mirrors the two runtimes: a native capability with a small stable tool surface, swappable backends behind an adapter registry, and configuration that lives in the app. MCP stays available as an optional export, off by default, for the case where someone wants to drive Flow from an external agent.

Every proposal below follows that same shape.

---

## 3. Proposal A: Browser as a first-class Flow capability

### 3.1 Capability interface

One stable tool surface, named the same way both runtimes converge on, so agents never care which backend runs underneath.

- `browser__navigate(url)` returns a snapshot
- `browser__snapshot(full?)` returns the accessibility tree with element refs
- `browser__act(ref, op, text?)` performs click, type, or select
- `browser__read(url?)` returns readable text or markdown. This is the 80 percent case (read this article) and should be the default the agent reaches for
- `browser__screenshot(...)` returns pixels or a vision description
- `browser__cdp(method, params)` is a raw escape hatch

### 3.2 Backend adapters

Selected by config, with `auto` as the default.

- `cdp`: Flow-native, Playwright `connectOverCDP(cdpUrl)` against any Chromium launched with `--remote-debugging-port`. Zero dependency on another runtime.
- `openclaw`: shell or loopback to `openclaw browser ... --json`, auto-detected via `openclaw browser status`.
- `hermes`: its CDP endpoint, Browserbase, or Camofox backend.
- `browserbase` (or Steel): a cloud browser, for headless Flow deployments (triggers, servers, no local display).

`auto` detection order: a running OpenClaw browser, then a running Hermes browser, then an env-provided CDP url, then a cloud backend if keys are present, then launch a managed Chromium.

### 3.3 Config in the app (batteries included)

Browser is a built-in capability, on by default with auto-detection. Configuration surfaces in a Settings panel and persists to Flow config, the same way other settings land in a file. The user should never wire up an MCP server or edit JSON by hand. The only human action is a **Log in to a site** button.

```yaml
# persisted to Flow config. The Settings panel is the friendly front end
browser:
  backend: auto            # auto | cdp | openclaw | hermes | browserbase
  profile: flow            # dedicated user-data-dir, never the personal profile
  allowPrivateUrls: false  # SSRF fail-closed, matches OpenClaw's default
  allowedOrigins: [medium.com]   # navigation allowlist for unattended runs
```

### 3.4 One-time login

Both runtimes agree: the human logs in once into a dedicated profile, and the agent never automates login (automated logins trip anti-bot defenses and can lock the account). Flow wraps this as `flow browser login <url>`, which opens the dedicated profile headful so the user signs in once. The session persists in that profile's user-data-dir.

### 3.5 Security defaults

- Dedicated, loopback-only profile. Never the personal browser profile. Driving a logged-in browser means acting as the user, so scope profiles per use case (a `medium` profile signed into only Medium).
- SSRF fail-closed for private networks. `allowPrivateUrls` is opt-in.
- Reads run ungated. `act` and navigation to non-allowlisted origins route through Flow's existing approval gate, the same one connector mutations use.

### 3.6 Portability (a `flow browser doctor` checklist)

Encode the cross-platform gotchas so they stop being tribal knowledge.

- macOS: autodetects Brave and Chrome. Works out of the box (verified on the current host, Brave live on CDP port 18800).
- Linux: avoid snap Chromium (it breaks process spawning). Need X11 or Wayland, or run headless with Xvfb. Set `noSandbox`. Clear stale `Singleton*` lock files left by crashed sessions.
- Windows and WSL2: launch Chrome on Windows with `--remote-debugging-port=9222` and a non-default `--user-data-dir` (Chrome 136 and later ignore debug flags on the default data dir). Point `cdpUrl` at the Windows address reachable from WSL2, not localhost. Watch for IPv4 versus IPv6 portproxy conflicts.

### 3.7 Suggested build path

- MVP, works on the current Mac today: the `cdp` adapter plus the `browser` config block plus `flow browser login` and `flow browser doctor` plus the rewritten `medium-review` skill. It attaches to the live OpenClaw Brave on port 18800 or launches its own Chromium. No other runtime required.
- Then: the `openclaw` and `hermes` adapters (auto-detect) and a `browserbase` adapter so scheduled and headless Flow runs can browse too.

---

## 4. Proposal B: Capability roadmap for Flow

Ranked recommendations, derived from where OpenClaw and Hermes both ship a capability natively and both rank it a top differentiator. Full per-item detail and every skipped item are in section 5.

**Legend for verdict tags** (used here and in the catalog):

- **BUILD**: implement now. Convergent across both runtimes, strong fit, and a genuine gap in Flow.
- **STRONG**: high value, but more effort or partial overlap with what Flow has.
- **LATER**: situational or a future capture source.
- **HAVE**: Flow already has an equivalent. Do not rebuild. Convergence validates the existing design.
- **SKIP**: present in one or both runtimes, but off-thesis for a tasks and notes app.

### Tier 1, BUILD

1. **Proactive notifications plus send-and-wait.** Push a reminder, digest, or decision to the user's channel (Telegram, Slack, iMessage, ntfy), and support send-and-wait so triage and approvals can happen off-app from a trigger fire. Both runtimes rank this number one or two. Flow already has the transports via connectors, but the agent is still reactive. This is the single biggest lever, and it lines up with the existing `notifications-architecture-thoughts-codex.md` and `deck-proactive-spec.md`.
2. **Capture and enrichment pipeline.** `web_fetch` plus readability, `summarize` (URL, YouTube, podcast, PDF), and `document-extract` or `vision_analyze` over uploaded attachments. Flow has a stream inbox and attachments but no way to turn a link or a PDF into a clean note or task. Highest-fit gap for a notes app, and it pairs with the browser capability for paywalled reads.
3. **Structured ask (`clarify` or `ask_user`).** A native batched multiple-choice question rendered in the app, distinct from the permission gate. Low effort, high leverage for deck picks and triage without freeform back-and-forth.

### Tier 2, STRONG

4. **Inward subagent orchestration** (`delegate_task` plus `execute_code`). Flow has executions for code. The same idea aimed at the brain enables bulk operations (parallel re-triage of the stream, batch enrich many tasks) with less context bloat.
5. **MCP client host plus propose-MCP** (mcporter, `setup_mcp`, optional-mcps). Let users attach any external tool (Notion, Linear, Asana) at runtime instead of hand-writing each connector. An extensibility multiplier both runtimes lean on.
6. **Knowledge-vault memory** (memory-wiki, auto-capture and auto-recall). The richer version of `MEMORY.md`: a linked, auto-curated knowledge base with pre-reply recall. Flow already has the vector substrate.

### Tier 3, LATER

7. **Meeting capture.** Meet or Teams bot join, then transcript, then notes and action items. High value, heavy build. A capture source for later.
8. **TTS spoken briefings.** Read the day's deck aloud. Flow already has STT for the other direction.
9. **Task-app import.** One-time or ongoing pull from Things, Apple Reminders, Notion, or Trello into Flow.

### SKIP for Flow

Desktop and computer-use control, mobile-UI control, smart home (Hue, Sonos, Home Assistant), image, video, and music generation, phone calls, and the twenty-plus chat-platform host adapters. Flow is not a chatbot host. It wants to notify, not to be Telegram.

### What Flow already has (HAVE)

Do not rebuild these. Convergence with both runtimes is a good sign the existing design is right.

- Scheduling, via triggers (both call it cron or cronjob, their number one)
- Propose-for-approval loop, via `propose_stream_triage` and the deck (their `suggest_task` and `dismiss_task`)
- Task list, via tasks (their `todo`)
- Durable memory, via `MEMORY.md` plus vector search
- Session recall, via `search_sessions` (their `session_search`)
- Delegated coding work, via executions and workspaces (their `coding-agent` and `delegate_task`)
- Voice capture, via Parakeet STT

---

## 5. Full capability catalog (ranked and tagged)

Every distinct native capability across both runtimes, grouped by theme, each tagged with a **Source** and a **Verdict**. Large families of interchangeable backends (chat channels, search providers, media generators, smart-home controllers) are listed as one grouped row that names the members, rather than one row per backend, to keep the list usable while staying complete. Model-provider plugins (Anthropic, OpenAI, Google, and roughly 55 others) are backends, not agent capabilities, and are excluded.

**Source tags**: `OC` OpenClaw, `HM` Hermes, `OC+HM` both.
**Verdict tags**: `BUILD`, `STRONG`, `LATER`, `HAVE`, `SKIP` (defined in section 4).

Within each theme the rows are ordered by verdict priority (BUILD, then STRONG, then LATER, then HAVE, then SKIP).

### Web, search, research

| Capability | Source | Verdict | What the agent can do | Flow note |
|---|---|---|---|---|
| web_fetch / web_extract | OC+HM | BUILD | Fetch clean markdown or text (and PDFs) from URLs, no summarization | Core of the capture pipeline |
| web-readability | OC | BUILD | Extract readable article content from fetched HTML | Same pipeline |
| summarize | OC | BUILD | URL, YouTube, podcast, or PDF to summary or transcript | Feeds notes |
| web_search | OC+HM | STRONG | Search the web, with site and filetype operators | Backends are adapters: brave, exa, duckduckgo, searxng, perplexity, parallel, tavily, firecrawl |
| blogwatcher | OC | LATER | Monitor RSS or Atom feeds | Capture source |
| weather, goplaces | OC | SKIP | Weather lookups, Google Places | Off-thesis |
| x_search | OC+HM | SKIP | Read-only search of X posts and threads | Niche |

### Comms, notifications, messaging

| Capability | Source | Verdict | What the agent can do | Flow note |
|---|---|---|---|---|
| Proactive message send | OC+HM | BUILD | Send a message or media to the user on their channel | The notify capability |
| Send-and-wait (conversations_turn, messages_send export) | OC+HM | BUILD | Send and block for a correlated reply | Off-app triage and approvals |
| ask_user / clarify | OC+HM | BUILD | Ask a single or multi-select or open question, batchable | Deck and triage decisions |
| Channel adapters (delivery) | OC+HM | STRONG | Deliver via Telegram, Slack, Discord, Signal, iMessage, ntfy, SMS, WhatsApp, Matrix, Teams | Use as notify backends only |
| Mail (gog Gmail, himalaya IMAP) | OC | HAVE | Read and send mail | Covered by connectors |
| Meeting bots (Meet, Teams, Zoom join and transcript) | OC+HM | LATER | Join a meeting as a guest and transcribe | Capture source |
| Voice-call, phone (Twilio, Telnyx, Plivo) | OC | SKIP | Place phone calls | Off-thesis |
| Channel adapters (as host) | OC+HM | SKIP | Be a full chat presence on 25-plus platforms | Flow is not a chatbot host |
| discord_admin, yb_ Yuanbao | HM | SKIP | Server moderation, Tencent Yuanbao groups | Off-thesis |

### Scheduling, automation, triggers

| Capability | Source | Verdict | What the agent can do | Flow note |
|---|---|---|---|---|
| webhooks (inbound) | OC | STRONG | Authenticated inbound webhooks that trigger jobs | External event triggers |
| cron / cronjob | OC+HM | HAVE | Schedule reminders and recurring runs in fresh sessions | Triggers |
| TaskFlow durable jobs | OC | HAVE | Multi-step background jobs with persisted state and waits | Executions and async agents |
| suggest_task / dismiss_task | OC | HAVE | Propose follow-up work for approval, withdraw a suggestion | Stream triage proposals |
| heartbeat_respond | OC | HAVE | Post-turn heartbeat handling | Trigger internals |

### Memory, knowledge, planning

| Capability | Source | Verdict | What the agent can do | Flow note |
|---|---|---|---|---|
| memory-wiki (knowledge vault) | OC | STRONG | Persistent linked wiki, Obsidian-friendly | Upgrade over MEMORY.md |
| active-memory (auto-recall or capture) | OC | STRONG | Bounded pre-reply retrieval and cross-session remember | Same theme |
| skills authoring at runtime (skill_workshop, skill_manage) | OC+HM | STRONG | Discover, load, and author reusable skills | Flow has skills, not runtime authoring |
| memory_search, store, recall | OC+HM | HAVE | Semantic search and read of memory | MEMORY.md plus vector |
| session_search | OC+HM | HAVE | Full-text search over past sessions | search_sessions |
| todo | HM | HAVE | Per-session multi-step task list | Tasks |
| goals (get, create, update) | OC | HAVE | Thread-level goals | Tasks and outcomes |
| Note-vault connectors (notion, obsidian, apple-notes, bear) | OC | LATER | Read and write external note vaults | Import path |

### Code, shell, execution, sandboxes

| Capability | Source | Verdict | What the agent can do | Flow note |
|---|---|---|---|---|
| execute_code | OC+HM | STRONG | Run a script that calls agent tools, batch and reduce | Inward orchestration |
| delegate_task, subagents | OC+HM | STRONG | Spawn isolated subagents, single or parallel | Bulk ops over the brain |
| lobster, llm-task (typed workflows) | OC | LATER | Resumable workflow pipelines with approvals | Structured automations |
| exec, terminal, process | OC+HM | HAVE | Run shell, manage background processes | Executions and workspaces |
| coding-agent delegation (Codex, Claude Code, OpenCode) | OC | HAVE | Delegate coding work to background workers | Executions |
| Sandboxes (crabbox, openshell, mxc) | OC | SKIP | Cloud or OS-level sandboxed execution | Flow uses workspaces |
| tokenjuice, dev-debug skills | OC | SKIP | Result compaction, node and python debuggers, tmux | Infra |

### Files, storage, documents

| Capability | Source | Verdict | What the agent can do | Flow note |
|---|---|---|---|---|
| document-extract | OC | BUILD | Extract text and page images from attachments | Attachments to notes |
| vision on documents | OC+HM | BUILD | Read image-based documents | Same pipeline |
| read, write, edit, patch, search_files | OC+HM | HAVE | File CRUD and ripgrep search | Harness file tools, notes are the store |
| diffs viewer, file-transfer | OC | SKIP | Read-only diff render, node file transfer | Infra |
| feishu_doc, feishu_drive | HM | SKIP | Read and comment on Feishu or Lark docs | Off-thesis |

### Media, image, vision, audio

| Capability | Source | Verdict | What the agent can do | Flow note |
|---|---|---|---|---|
| vision_analyze, view_image | OC+HM | BUILD | Analyze images | For attachments and capture |
| tts, text_to_speech | OC+HM | LATER | Convert text to a voice message | Spoken briefings |
| STT, voice mode, wake word | OC+HM | HAVE | Speech input and transcription | Parakeet |
| image_generate | OC+HM | SKIP | Text-to-image and image edit | Off-thesis |
| video_generate, music_generate | OC+HM | SKIP | Text-to-video, text-to-music | Off-thesis |
| Media skills (meme-maker, gifgrep, diagram-maker, nano-pdf, video-frames, songsee, camsnap) | OC | SKIP | Assorted media authoring and capture | diagram-maker is a possible LATER |

### Integrations and extensibility

| Capability | Source | Verdict | What the agent can do | Flow note |
|---|---|---|---|---|
| MCP client host (mcporter, setup_mcp, dynamic tools) | OC+HM | STRONG | Load any external MCP server's tools at runtime | Bring-your-own tools |
| Optional MCPs (Notion, Linear, Asana, Airtable, Jira, Figma, Stripe, Sentry, and more) | HM | STRONG | One-enable connectors to popular products | Two-way integration |
| clawhub, skill-creator | OC | LATER | Search, install, and publish skills | Skill marketplace |
| Task-app connectors (apple-reminders, things-mac, trello) | OC | LATER | Read and write external task managers | Import path |
| github, gh-issues | OC | HAVE | Issues, PRs, CI, spawn fix agents | Executions and connectors |
| Google Workspace (gog) | OC | HAVE | Gmail, Calendar, Drive, Sheets, Docs | Connectors |
| migrate-claude, migrate-hermes, gateway config | OC | SKIP | Import from other agents, read gateway config | Infra |
| oracle, model-usage, ordercli, gemini, open-prose | OC | SKIP | Second-model review, cost logs, food ordering, misc | Off-thesis (oracle is a possible LATER) |

### Sessions and multi-agent coordination

| Capability | Source | Verdict | What the agent can do | Flow note |
|---|---|---|---|---|
| sessions, agents_wait, subagents | OC | HAVE | Manage, search, spawn, and collect sessions | Executions oversight |
| structured_output | OC | HAVE | Return typed structured results | Harness feature |
| kanban, workboard | OC+HM | SKIP | Agent-owned task or issue board for workers | Tasks and executions already cover this |

### System, OS, and device control

| Capability | Source | Verdict | What the agent can do | Flow note |
|---|---|---|---|---|
| computer, computer_use | OC+HM | SKIP | Control a desktop by screenshots and clicks | Off-thesis |
| mobile_ui | OC | SKIP | Observe and control an Android app | Off-thesis |
| screen, nodes, device-pair, bonjour | OC | SKIP | Drive the operator UI, pair devices, mDNS | Infra |
| Smart home (openhue, sonos, blucli, spotify, eightsleep, Home Assistant) | OC+HM | SKIP | Control lights, speakers, and IoT | Off-thesis |

### UI and presentation surfaces

| Capability | Source | Verdict | What the agent can do | Flow note |
|---|---|---|---|---|
| progress_card, show_widget | OC | LATER | Maintain a progress card and interactive widgets | A pattern Flow could borrow for the deck |
| dashboard, portal, canvas | OC | SKIP | Arrange a session dashboard, expose local apps, control macOS panels | Runtime-specific UI |
| Desktop-GUI tools (preview, terminal, tour, apply_layout, project) | HM | SKIP | Drive in-app panes, narrate tours, rearrange the desktop | Their desktop app only |

### Security, secrets, sandbox, policy

| Capability | Source | Verdict | What the agent can do | Flow note |
|---|---|---|---|---|
| Secret brokers (1Password, HashiCorp Vault) | OC | LATER | Resolve secret refs with an approval policy and audit log | Useful for connector credentials |
| Approval and guardrails (dangerous-tools, url and path safety, injection patterns) | OC+HM | HAVE | Gate risky tool calls and unsafe URLs | Approval gate |
| healthcheck | OC | SKIP | Audit and harden a host | Off-thesis |

---

## 6. Architectural principle to carry across all of these

Every capability above, if built, should follow the same shape, which is the shape both runtimes already use and the one we agreed for the browser:

1. A small, stable, native tool surface, named for what it does, not for the backend.
2. Swappable backends behind an adapter or provider registry.
3. Configuration in the app Settings, persisted to a Flow config file, with sensible auto-detecting defaults so it is batteries-included.
4. Mutations and outward actions through the existing approval gate.
5. MCP as an optional outward export, off by default, for driving Flow from an external agent.

This keeps the surface the agent sees small and stable while the backends underneath change (local versus cloud browser, one search provider versus another, one notify channel versus another).

---

## 7. Open questions and next steps

- Which Tier 1 capability lands first, notify or capture. Notify aligns with existing proactive-deck specs. Capture has the tightest fit with notes and attachments.
- Whether the browser MVP ships as its own change before the wider capability work, so `medium-review` can run end to end.
- Whether notify reuses the existing connector transports directly, or introduces a thin notify capability that treats connectors as adapters (recommended, for the send-and-wait semantics).
- How runtime detection should behave when both OpenClaw and Hermes are present on a host.

Suggested first change: the browser MVP from section 3.7 (the `cdp` adapter, the Settings-backed config block, `flow browser login` and `doctor`, and the rewritten `medium-review` skill), on a branch, as the reference implementation of the pattern in section 6.
