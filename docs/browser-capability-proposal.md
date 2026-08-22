# Browser Control for Flow

> Proposal for giving Flow's agent a real browser it can read and act through, using the user's own logged-in sessions, as a first-class native capability. Supersedes the browser section of [agent-capabilities-openclaw-hermes.md](agent-capabilities-openclaw-hermes.md). Written after a first-hand study of OpenClaw and Hermes, a scan of the 2026 browser-agent ecosystem, and several rounds of narrowing to the smallest design that fits Flow.
>
> Status: proposed, ready to build. Date: 2026-08-21.

## 1. The goal, and the decision

Flow's thesis is to minimize the decisions and maintenance that let a system rot, and to let AI manage the rest. A browser capability that honors that is not a control panel of restrictions. It is one dedicated browser the agent uses, that the user logs into like any website, driven by two small verbs the model already knows how to use.

The decision:

> Give the agent one dedicated browser (a Chromium-family browser the user picks, running its own profile). Flow attaches to it over CDP when it is open and launches it headless when it is not. The agent reads and acts through two verbs, `browser_read` and `browser_act`. Security is the login scope the user curates, plus oversight (an audit trail and a kill switch) and a silent private-network floor. Everything else (cloud, an extension into the real browser, a delegate-the-whole-task operator) is a later adapter behind the same two verbs.

Why this shape fits the goals:

- Minimize decisions. The user's one decision is what to log the agent browser into. There is no allowlist to maintain, no per-site setup, no MCP server to wire.
- Only necessary structure. Two verbs and a read ladder, not twenty actions. The intelligence lives in the model.
- Robust and lasting. The browser is the persistent process and Flow is a thin client, so there is no daemon to leak or babysit.
- Powerful and evolvable. The two verbs are a stable contract, and new backends slot in behind them without changing what the agent sees.

## 2. The two verbs

The model never guesses selectors or coordinates. Read hands it a labeled menu of the page's elements with stable ids, and act consumes an id. Read feeds act.

### browser_read(url?, mode?, selector?, max_chars?)

Navigates if a url is given, then returns the page. Modes form a fallback ladder, tried in order for a plain read and selectable explicitly:

- `snapshot`: the accessibility tree with stable aria-ref ids. Compact, cheap, the default. Interactive and named elements come back as, for example, `- button "Submit" [ref=e12]`.
- `text`: readability-extracted article body plus scoped DOM text. This is the founding Medium job, since the tree is thin on a paywalled single-page app.
- `screenshot`: a set-of-marks image (numbered overlays on interactive elements) for canvas apps, closed shadow DOM, and anything the tree cannot express. The screenshot goes only to the agent's own vision call, never into the saved transcript.

After any navigation, read auto-attaches a fresh snapshot so the agent does not round-trip to re-read.

### browser_act(kind, ref?, text?, key?, values?, idempotency_key?)

Performs one interaction. Flat shape with a `kind` discriminator (no nested unions, which some model providers reject). `kind` is a short closed list: `click`, `type`, `press`, `select`, `scroll`, `wait`, `upload`. `ref` comes straight from the last read. Every act returns the resulting page state, so the agent always acts against what is currently on screen. Acts carry an idempotency key so a transport retry cannot submit a form twice.

### Will the model know what to put in?

Yes, and reliably. Worked example, the agent profile is logged into your retailer account and you ask it to check an order:

1. `browser_read("https://shop.example/orders")` returns `- link "Order #4821" [ref=e5]` and the order list text.
2. `browser_act(kind: "click", ref: "e5")`. The result includes a fresh snapshot with the order detail and `- text "Ships Aug 24"`.
3. The agent reads the ship date and writes it back to you as a note or a chat reply.

The model picks from the elements read showed it, the `kind` enum is obvious, and it sees the result of every step. This is the same loop the frontier models already run in Playwright MCP and in OpenClaw, so it is a well-worn path, not an interface we have to teach.

Two operational actions round it out. `browser_open()` opens the agent browser headed so a human can log in. `browser_status()` reports what is running and carries the kill switch.

## 3. The browser is the sidecar

A browser is always its own process. The persistent, stateful thing is the browser itself (its cookies, its tabs), and Flow is a client that connects to it. This is how Playwright's connectOverCDP works, how chrome-devtools-mcp autoConnect works, and how OpenClaw drives a real Brave today.

So Flow does not own a browser daemon. The rule is connect-or-launch:

- If the agent browser is already open, attach to it and drive it. This is the attended, everyday case, and it is the one that feels good in daily use.
- If nothing is open (a 6am scheduled run with no window), launch the browser headless on the agent profile for the duration of the run, then close it.

Detecting an open browser is unambiguous because Flow owns the profile. Flow always launches the agent browser (from the Settings button, `flow browser open`, or an auto-launch inside a run), starting the chosen Chromium with remote debugging pointed at the agent profile dir. Chromium writes the live port into `<profile>/DevToolsActivePort` on startup. So the check is: read `DevToolsActivePort` in the profile dir, then probe `http://127.0.0.1:<port>/json/version`. A DevTools response means a browser is open and it is definitively ours, because the port came from our own profile dir. A missing file or no response means not running (or stale, so Flow cleans it up and launches fresh). Port collisions and dev-versus-prod confusion do not arise, because `.config` and `.work` are already isolated per data root, so each instance has its own profile dir and its own `DevToolsActivePort`.

The agent rarely opens or checks explicitly. `browser_read` and `browser_act` run connect-or-launch transparently, so the browser just appears when the agent reads or acts. It calls `browser_open` only when it needs a human to see the window and log in, and `browser_status` if it wants to confirm state first.

Because Flow does not spawn or own the browser in the attended case, a dev hot-reload cannot orphan it and there is no zombie-process problem to manage. The only lifecycle logic is connect-or-launch, plus the single rule that a profile's data directory cannot be open twice at once (so a scheduled run reuses an already-open browser rather than fighting it for the lock).

Flow already ships this exact pattern for the Parakeet voice service (spawn on demand, reuse if warm, tear down on stop), so it is a known shape in the codebase, not a new concept.

## 4. One agent browser, logged in like any site

- Pick your flavor. `flow browser doctor` and a Settings dropdown list the installed Chromium-family browsers (Chrome, Brave, Edge, Chromium, plus the Playwright cache). The user picks one, it persists as `browserChromiumPath`. Brave and the rest drive by executable path. The default prefers a real installed browser over downloading Playwright's Chromium, and the download, if ever needed, is consented and lazy, never at install time.
- Log in like any website. There is no per-site login catalog. The one primitive is "open the agent browser," headed, so the user can sign into whatever they want, whenever, including 2FA, with their password manager, exactly as in a normal browser. No credentials are ever typed into Flow.
- Login needs are conversational. When a run hits a wall (the profile is not logged into a site it needs, or a session expired), the agent says so in the thread or files a plain task. The user opens the browser and signs in. Nothing to maintain, no registry, no enumerated flows. This is the anti-rot loop.
- It is a dedicated identity, not your personal browser. The agent profile is separate from the browser you use daily. That, plus what you choose to log it into, is the security boundary (section 6).

## 5. Config and storage

Reuses Flow's existing two-tier split with almost no new infrastructure.

- Non-secret flags extend `AuthConfig` and land in `.config/config.json` at 0600 via `writeAuthConfig`: `browserEnabled`, `browserChromiumPath`, `browserHeadlessDefault`, `browserIdleCloseMs`.
- The agent profile (cookies, session) lives in `.config/browser/profiles/`, which is precious-local (not synced, not lost). This is a correction from an earlier draft that put it in `.work`, which is safe-to-delete scratch and would lose your logins.
- The pidfile, socket, and the regenerable read-spill live in `.work/browser/`.
- Any real secret (a cloud key, an extension pairing secret) uses a sealed store copying the connectors recipe (a 0600 key file, `aesGcmSecretBox`, atomic write plus file lock), never `config.json`.

Two path helpers get added beside the existing ones, `getBrowserProfilesDir()` under `.config` and `getBrowserWorkDir()` under `.work`.

## 6. Security is the login scope you curate

The security model is the one you would use for a human assistant. You decide which accounts it can touch by deciding what to log the agent browser into. The agent then acts freely within that scope. Flow does not cage the agent with origin allowlists, per-action approval prompts, or cross-origin taint. Those are the human-organization scaffolding Flow exists to remove, and the profile's login scope already bounds the blast radius.

What Flow keeps, because it adds safety without restricting the agent or creating rot:

- Oversight, not restriction. A lean audit trail (which pages, which acts, which downloads) that rides the existing execution and transcript UI, and a kill switch that closes the agent browser and stops everything. These let you see and stop, they never block a capability.
- A silent private-network floor. The agent browser cannot be steered to localhost, your router admin, or a cloud metadata endpoint. This restricts nothing you would ever legitimately browse and closes the one hole unrelated to your logins.

The one honest caveat, stated so it is a knowing choice. The risk login scope does not cover is prompt injection acting within the scope. A malicious page the agent reads could try to make it act in an account the profile is logged into. The mitigation lives in your framework, it is proportional to what you log in and give write power to. A profile with a Medium subscription and a burner account is low stakes. A profile with your primary email and send access is high stakes. The real knob is which accounts you hand the agent, and the audit trail and kill switch are there to see and stop anything that goes wrong. For the day you do log in something sensitive, an opt-in "ask before acting on this site" seatbelt is available per site, off by default.

## 7. Fresh eyes: is this enough to act autonomously and replace the user's work?

The two verbs plus auto-snapshot are the right, sufficient core for reading and acting, and the model drives them fluently. But being a real asset that replaces browser work needs three more things, and they are mostly about composing with Flow's existing spine rather than adding browser surface.

1. File transfer, the highest-value addition. A person's real browser work is full of files. Download an invoice, a receipt, a report, a boarding pass. Upload a resume, a document, an image. Flow is a notes app with a first-class attachment system, so this is exactly where browser work becomes durable Flow artifacts. It fits the two verbs without a third:
   - Upload is an act kind. `browser_act(kind: "upload", ref, attachment_id)` sets a file input from a Flow attachment.
   - Download is a session behavior. When an act triggers a download, the browser layer captures the file straight into Flow's attachment store and returns the attachment id, so "download my invoice and file it" ends with a real attachment on a note. This is a small addition and it is what turns browsing into productive output.
2. Graceful handback, so autonomy never dead-ends. When the agent hits a wall it cannot pass on its own (an expired login, a 2FA prompt, a CAPTCHA, or a genuinely ambiguous choice), it must recognize it, stop cleanly, and hand back to the human, rather than looping or failing silently. The handback lands where the human will see it: a message in the active chat thread when the run is attended, or a message in the cron or trigger run's own chat when it is unattended. This is behavior plus read surfacing "this looks like a login or challenge wall," not a new verb, and it is essential for unattended runs to be trustworthy.
3. Composition with the spine it already has. Autonomy is not a special browser mode, it is Flow's existing agent loop running the two verbs inside an execution or a trigger. So the browser plugs into what Flow already owns: triggers and async agents for unattended runs, memory and skills so a recurring browser task (the weekly "check X and summarize") gets faster and more reliable over time, and tasks and chat for asking and reporting back. The browser adds reach. The spine provides the autonomy.

Deliberately deferred, because the core covers most jobs and the model is capable: multiple tabs and parallel browsing (the agent can navigate serially today), a distinct structured-extraction verb (the model structures data from a scoped read), and a delegate-the-whole-goal operator (a later opt-in escape hatch, not the default, because primitives the model drives are more auditable and controllable).

With file transfer and graceful handback added to the two verbs, and the whole thing composed with triggers, memory, and tasks, the agent can genuinely take over the recurring, mechanical browser work a person would rather not do. Read and file articles and documents, pull receipts and invoices into notes, check statuses, fill and submit routine forms, and post or reply on accounts you have chosen to entrust to it, on a schedule, reporting back and asking when it is stuck.

## 8. What OpenClaw and Hermes taught us

Where both converge, treat it as settled and adopt it: a native tool rather than MCP for the inward capability, the accessibility tree as the page model, CDP as transport, a dedicated profile with a one-time manual login, and never automating the login form.

Kept from OpenClaw: the accessibility tree with self-resolving refs, the "latency is round-trips" discipline of auto-attaching a snapshot after navigation, and the flat tool schema. Dropped from OpenClaw: the twenty-verb surface, the multi-node gateway machinery, and SSRF as the security spine.

Kept from Hermes: operational hygiene, a lean version of session cleanup and secret redaction. Dropped from Hermes: the multi-vendor cloud registry with billing, the high-level browse-agent as the default, and the general mass of a hosted product.

What neither nailed, and where Flow wins: a genuinely simple log-in-once experience with no operator setup, and a security model that is one human decision (what to log in) rather than a machine of restrictions.

## 9. Build plan

Phase 1, the core, runs on this Mac.

- `src/lib/browser/`: the CDP client (connect-or-launch), the read ladder (snapshot via aria-snapshot, text via a readability pass, screenshot via set-of-marks), the flat act dispatch with idempotency keys, and Chromium-flavor detection.
- `src/lib/orchestrator/registry.ts`: `browser_read`, `browser_act`, `browser_open`, `browser_status` as defineAction actions (Zod raw shapes, snake_case, ActionError codes, ctx.remote branching, auto-attached page state).
- `src/cli/commands/browser.ts` plus a check appended to `doctor.ts`: login, status, doctor, stop.
- `src/lib/config/paths.ts`: `getBrowserProfilesDir()` and `getBrowserWorkDir()`.
- Config fields on `AuthConfig`, and a Settings panel with the browser picker and the "open agent browser" button.
- Proof: log into Medium once, then a scheduled read returns the member-only body headless, and an interactive act loop (read, click, read) works on a logged-in account.

Phase 1.5, productive autonomy.

- Upload act kind wired to Flow attachments, and download capture into the attachment store.
- Graceful handback: login and challenge detection that files a needs-attention item into the stream and ends the run cleanly.
- The audit trail surfaced in the execution and transcript UI, and the kill switch.

Later, opt-in adapters behind the same two verbs.

- A single optional cloud backend for headless scale or stealth scraping, Steel preferred for being open source and self-hostable, never carrying the user's real cookies.
- An extension relay into the user's real all-sites browser, interactive-only, loud consent.
- A delegate-the-whole-goal operator for the genuinely long transactional tail.
- The per-site "ask before acting" seatbelt, and on macOS an optional cookie import so even the one-time login can be skipped for sites already signed into.

## 10. Open questions

- Which readability engine survives Medium's overlay and lazy body best. Decide with a real-site smoke in phase 1.
- Whether a scheduled run reuses an already-open browser or clones the profile to sidestep the single-lock rule.
- Whether download capture defaults to attaching everything or only when the task asked for a file.

---

Anchors verified against the current tree: `defineAction` at `types.ts:57`, `ctx.remote` at `registry.ts:346`, `writeAuthConfig` at `auth/config-file.ts:73`, the SecretBox recipe in `connectors/runtime.ts`, and the `.config` versus `.work` split in `config/paths.ts`. No Playwright or readability dependency exists yet, both are new.
