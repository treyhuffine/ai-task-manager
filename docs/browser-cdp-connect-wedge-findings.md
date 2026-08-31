# Agent browser: `connectOverCDP` wedge — findings & fix options

**Status:** RESOLVED — fix options 1 & 2 implemented + regression-tested (see Resolution below). Option 3 remains gated on a protocol trace; option 1 makes the stall non-fatal regardless.
**Context:** hit during a live Medium-review run driving the `agent` profile (Brave 147 / Chrome 147, `playwright-core` 1.62.1, Node 26, macOS). The browser tools (`browser_read`/`browser_open`/`browser_act`) went unrecoverably stuck; the run was completed by bypassing Playwright with raw CDP. This doc records what broke, why, and the options.

---

## Resolution (implemented)

Confirmed the wedge with a deterministic, hermetic reproduction (no real browser): a fake CDP endpoint whose `GET /json/version` answers healthy and whose DevTools WebSocket completes its upgrade and then never sends a frame. Against it, `chromium.connectOverCDP(endpoint)` with no timeout was still pending at 3s (rides to the 30s default); with `{ timeout }` it rejected fast. That is exactly the incident symptom, so the reproduction is faithful.

Then shipped the two high-value, driver-preserving fixes:

- **Fix 1 — bounded connect + relaunch-retry (`src/lib/browser/session.ts`).** `connectOverCDP` is now wrapped by `connectWithTimeout` with a 10s `CONNECT_TIMEOUT_MS` (well under the 30s default). `openOrConnect` catches a stalled connect, relaunches the browser clean via `launch()`, and retries once; a second stall throws a clear `ActionError` instead of hanging forever. The orphan-recovery block in `launch()` was factored into a reusable `recoverProfile()` (kill tracked pid + clear port file + singleton locks), which is the teardown the relaunch depends on so the fresh instance does not just forward to the wedged one. `closeBrowser` also uses the bounded connect so a wedged browser drops straight to its pid backstop instead of hanging the close.
- **Fix 2 — liveness ping before session reuse (`src/lib/browser/runtime.ts`).** `isLive` is now async: after `browser.isConnected()` it confirms the CDP channel actually answers by racing `context.cookies()` against a 2s deadline (`respondsWithin` / `LIVENESS_PING_MS`). A half-dead transport that `isConnected()` still reports as up is dropped and reconnected instead of being handed the next call.

Regression coverage lives in `src/lib/browser/connect-wedge.test.ts` (hermetic, runs in `pnpm test`): it reproduces the stall, asserts the bounded connect surfaces it fast, and covers `respondsWithin` for the resolve / reject / never-settle cases. Verified with `pnpm ts`, `pnpm lint`, the full `pnpm test` suite, and the real-browser `pnpm test:browser` lifecycle suite.

**Deferred:** Fix 3 (reduce connect-time target surface) still needs the `DEBUG=pw:protocol` trace below to confirm the reCAPTCHA-iframe-target hypothesis before it is worth doing; fix 1 already makes a stall non-fatal. Fix 4 (raw CDP as a narrow fallback) stays available for pure request-replay jobs and was intentionally not made the main driver.

---

## TL;DR

- The **browser was healthy the whole time** — logged into Medium, reachable, `GET /json/version` on its DevTools port answered instantly via `curl`.
- What wedged was **`chromium.connectOverCDP(endpoint)`**: the WebSocket connects, then the handshake stalls and hits Playwright's 30s default timeout. Every subsequent action ate 30s and failed.
- It is **not** a Playwright-vs-raw-CDP question (`connectOverCDP` *is* the Playwright connector, and Flow already uses it). The bug is in **connect robustness + recovery wiring**, and it is fixable without changing the driver.
- Two concrete gaps: (1) no connect timeout and no relaunch-on-connect-failure, so the existing self-heal in `launch()` never triggers; (2) `isLive()` trusts `browser.isConnected()`, which lags a half-dead transport.

---

## What was observed

1. Early calls worked: an `example.com` read succeeded; a `medium.com` read failed with `page.goto: Timeout 45000ms` (navigation-level, i.e. connect had succeeded).
2. After some open/close churn and an external `kill` of a stuck Brave PID, **every** call began failing at:
   ```
   browserType.connectOverCDP: Timeout 30000ms exceeded.
     - <ws connecting> ws://127.0.0.1:65272/devtools/browser/efa8f755-...
     - <ws connected>
   ```
   The WS reached `connected`, then nothing — full 30s timeout.
3. Direct probes of that same port were instant and healthy:
   - `GET /json/version` → `Chrome/147.0.7727.117`, valid `webSocketDebuggerUrl`.
   - `GET /json/list` → a live page target on `medium.com/me/settings` (logged in) **plus a `google.com/recaptcha/enterprise/anchor` invisible-iframe target**.
4. `browser_close` reported `closed:true` (its pid backstop works), but a **fresh** launch's `connectOverCDP` then hung the same way. So the stall reproduced against a brand-new, probe-healthy browser — not just one poisoned instance.

## Reproduction of the workaround

Raw CDP (no Playwright) against the *same* port worked perfectly: a ~40-line Node script using the built-in `WebSocket` opened a target, navigated, pulled `document.innerText`, and later replayed the publication "save settings" POST for add-writers. This confirms the browser and its CDP endpoint were fully functional; only the Playwright connect path was stuck.

---

## Root-cause analysis

### Primary (confirmed): connect has no timeout and no relaunch-retry

`openOrConnect` — `src/lib/browser/session.ts:269`:

```ts
export async function openOrConnect(opts: OpenOptions = {}): Promise<AgentBrowser> {
  const endpoint = (await getRunningEndpoint(opts.profile)) ?? (await launch(opts));
  const browser = await chromium.connectOverCDP(endpoint); // no timeout, no catch
  ...
}
```

The good recovery scaffolding — `killPid`, `clearSingletonLocks`, orphan-kill — lives **inside** `launch()` (`session.ts:213`, orphan recovery at `:228-232`). But `launch()` only runs when `getRunningEndpoint()` returns `null`. In this incident the endpoint **probed fine** (`getRunningEndpoint` → `probeEndpoint` hits `/json/version`, which answered), so:

- `launch()` — and every bit of self-heal it contains — was **never reached**.
- `connectOverCDP` was called against the "healthy" endpoint and stalled for 30s with no fallback.

Result: a wedged connect is unrecoverable from inside the tool. Recovery required an **external** `kill` of the Brave process — which is exactly what happened.

### Secondary (contributing): stale-connection detection

`isLive` — `src/lib/browser/runtime.ts:114`:

```ts
function isLive(session: BrowserSession): boolean {
  if (!session.agent.browser.isConnected()) return false;
  ...
}
```

`browser.isConnected()` reflects whether the CDP transport object *thinks* it's up; it can lag a browser that has died or gone unresponsive. A cached session that is actually dead can still be handed back by `getSession()` (`runtime.ts:120`), after which the next Playwright call hangs.

### Likely trigger (unconfirmed — needs a protocol trace)

`connectOverCDP` attaches a CDP session to **every pre-existing target** during its handshake. The wedged browser had a live Medium tab whose `/json/list` included a `recaptcha/enterprise/anchor` **invisible-iframe** target. A connect that stalls while initializing an unresponsive challenge/iframe target fits the timeline precisely:

- worked at the start on blank / simple tabs;
- began stalling only after Medium tabs (with reCAPTCHA/Cloudflare targets) existed;
- reproduced against a fresh launch because the profile reopened the same Medium tab (session restore) with the same challenge target.

This is a hypothesis. Confirm with `DEBUG=pw:protocol` (below) to see which target's attach never completes.

---

## Fix options

### 1. Guard the connect + trigger the existing self-heal (highest value)

Wrap `connectOverCDP` with a short timeout; on timeout/throw, treat the endpoint as poisoned, run the same recovery `launch()` already does (kill pid, clear port file + singleton locks), relaunch, and retry **once**. Sketch:

```ts
async function connectWithTimeout(endpoint: string, ms = 8_000): Promise<Browser> {
  return await chromium.connectOverCDP(endpoint, { timeout: ms });
}

export async function openOrConnect(opts: OpenOptions = {}): Promise<AgentBrowser> {
  let endpoint = (await getRunningEndpoint(opts.profile)) ?? (await launch(opts));
  let browser: Browser;
  try {
    browser = await connectWithTimeout(endpoint);
  } catch {
    // Endpoint probed healthy but connect stalled: force a clean relaunch.
    await forceRelaunch(opts);          // kill pid + clearPortFile + clearSingletonLocks
    endpoint = await launch(opts);
    browser = await connectWithTimeout(endpoint);
  }
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  return { browser, context, page };
}
```

Notes:
- `connectOverCDP` accepts a `{ timeout }` option — set it well under the current 30s so a stall surfaces fast.
- `forceRelaunch` is mostly a refactor of the orphan-recovery block already in `launch()` (`session.ts:228-232`) into a reusable helper.
- This alone converts the 30s unrecoverable hang into a self-heal, with no driver change.

### 2. Liveness ping before reusing a cached session

In `isLive` (or `getSession`), after `browser.isConnected()`, add a cheap probe under a short race — e.g. `await Promise.race([session.agent.context.cookies(), timeout(2000)])` or `page.evaluate('1')`. If it doesn't resolve fast, drop the session and reconnect. Catches half-dead transports that `isConnected()` still reports as up.

### 3. Reduce connect-time target surface (if the reCAPTCHA hypothesis confirms)

Options, cheapest first:
- Prefer connecting and then working in a **fresh page/context** rather than depending on pre-existing tabs initializing.
- On connect, don't hard-wait on every target; tolerate a target that never settles.
- Consider closing stray/challenge tabs as part of recovery.

### 4. Keep raw CDP as a deliberate, narrow fallback

For pure request-replay jobs that need no DOM/act machinery — e.g. the add-writers "save settings" POST — a raw-CDP path (Node built-in `WebSocket` → `Target.createTarget` → `Runtime.evaluate` `fetch`) is a robust ~40-line fallback. It should stay a **fallback**, not the main driver: it cannot replace the `read.ts`/`act.ts` surface (aria snapshot with `[ref]` ids, readability text, set-of-marks screenshots, auto-wait, downloads→attachments, `context.cookies()` for the HttpOnly `xsrf`, dialog handling, tabs).

### Explicitly NOT recommended: replacing Playwright with raw CDP

That would mean reimplementing the entire read/act feature set on bare protocol. The incident is a connect-lifecycle bug, not a Playwright limitation — fix the connect path, keep the driver.

---

## How to confirm the trigger

Reproduce with a Medium tab (or any page carrying a reCAPTCHA/Cloudflare challenge iframe) already open in the profile, then attempt a connect with protocol logging:

```
DEBUG=pw:protocol node <connect-repro>   # watch which Target.attachedToTarget / setAutoAttach never completes
```

Cross-reference the stuck target id against `GET http://127.0.0.1:<port>/json/list`. If the stall aligns with the challenge iframe target, fix option 3 applies; option 1 makes it non-fatal regardless.

---

## Affected code (for the fix)

- `src/lib/browser/session.ts:269` — `openOrConnect`: add connect timeout + relaunch-retry.
- `src/lib/browser/session.ts:213-262` — `launch`: factor orphan-recovery (`:228-232`) into a reusable `forceRelaunch`.
- `src/lib/browser/runtime.ts:114-118` — `isLive`: add a liveness ping.
- `src/lib/browser/session.ts:282` — `closeBrowser`: already has a pid backstop (good); no change needed, but it's the reason the manual kill worked.

## Environment where this reproduced

- `playwright-core` 1.62.1
- Brave 147.1.89.143 (Chrome/147.0.7727.117)
- Node 26.5.0, macOS (Darwin 25.3.0)
- Single `agent` profile, headed, logged into Medium
