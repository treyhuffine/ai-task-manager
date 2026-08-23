---
name: {{SKILL_NAME}}
description: Use when a task needs a real web browser, reading a page a plain fetch cannot (paywalled or login-gated articles, JS-heavy pages), acting on a site (clicking, filling a form, posting), pulling a file down from a site, or checking something behind a login. Also when the user says "read this link", "log into", "download from", or "do this on the web". The agent drives a real browser using the sites the user has signed the agent browser into.
---

# Agent browser

Flow has a built-in browser the agent drives over the Chrome DevTools Protocol. It reads and acts on real web pages using the sign-ins the user set up in a dedicated agent browser profile. This is not `web_fetch`. Use it when the content needs a real, possibly logged-in, browser.

## When to use it, and when not to

- Prefer a first-party connector when one exists for the service and the job. Reading Gmail goes through the Gmail connector, not the browser. Driving a logged-in account through the browser is the last resort, for content only a rendered page exposes (a member-only article body) or a site with no connector.
- Use the browser for: reading paywalled or login-gated pages, JS-heavy pages a fetch returns empty, filling and submitting a form, posting or replying on a site, downloading a file, checking a status behind a login.

## The core loop

The browser never wants a guessed selector or a coordinate. You read a page, it hands back a labelled list of elements with stable ids, and you act on an id.

1. `browser_read(url)` navigates and returns the page. Default mode is `snapshot`, the accessibility tree with `[ref=e12]` ids on every actionable element.
2. Pick an element from the snapshot and act on its ref: `browser_act(kind: "click", ref: "e12")`, or `browser_act(kind: "type", ref: "e7", text: "...")`.
3. Every act returns the fresh page state, so you always act against what is on screen now. Re-read if the page changed a lot or a ref stops resolving.

Read modes: `snapshot` (default, to act on), `text` (a clean article body, the readability extraction), `screenshot` (a marked image for canvas, closed shadow DOM, or anything the tree cannot express), `pdf` (files the page as a Flow attachment).

Act kinds: `click`, `type`, `press`, `hover`, `select`, `scroll`, `wait`, `upload`, `back`, `forward`, `reload`, `evaluate` (JS, trusted local only). Use `browser_batch` to run a known sequence (type, type, click) in one round-trip. Pass an `idempotency_key` on an act so a retry never submits twice.

Tabs: `browser_tabs` with `list`, `select`, `close`, or `new`. A click that opens a tab auto-switches to it and the act result says so.

## Profiles and logging in

A profile is a separate signed-in identity with its own cookies. `browser_profiles` lists them, the default is shown. Pass `profile: "<name>"` on any browser action to use a different one.

Never automate a login form. If the user needs the agent signed into a site, tell them to open it and sign in once with `browser_open(url)` (a headed window they log into by hand), or the Settings "Open to sign in" button. From then on the session persists and reads work headless.

## Hand back when blocked

If a `browser_read` or `browser_act` result carries a `blocked` field (kind `login` or `challenge`), stop. Do not try to log in or solve a CAPTCHA. Tell the user what is in the way ("this page wants a login, the agent browser is not signed into it") and let them handle it out of band. This is the correct outcome, not a failure to work around.

## Files

A download the browser triggers is captured straight into Flow attachments and returned on the act result. To upload, pass a Flow attachment: `browser_act(kind: "upload", ref, attachment: "<fileName>")`.

## Safety

The user decides the agent's reach by what they log the profile into. What is signed in is what the agent, and a malicious page under prompt injection, can touch. Read within an already-signed-in site freely. Acting on the user's real accounts is acting as them, so favour reading, and hand back anything the user did not clearly ask for. `browser_status` shows what is running and the recent activity, and `browser_close` is the stop.
