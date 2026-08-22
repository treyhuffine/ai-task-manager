# Testing the agent browser (macOS, Chromium)

How to check the agent browser works on your machine. Written for a Chromium-family browser on a Mac (Brave, Chrome, Edge, or Chromium). Two parts: automated checks that take seconds, then a real login test that takes about five minutes.

If `flow` is not installed as a global command, run the CLI from the repo with `pnpm cli:dev` instead, for example `pnpm cli:dev browser doctor`.

## 1. Automated checks (30 seconds)

```bash
pnpm test            # unit tests: the security floor, redaction, config
pnpm test:browser    # real-browser end to end: launches Brave headless, ~5s
flow browser doctor  # confirms your browser is detected and the profile dir is writable
```

`pnpm test:browser` drives a real browser through reads, clicks, typing, dialogs, tabs, downloads, uploads, PDF, and auto-close. If it is green, the machinery works on your machine. `doctor` should list your browser (for example "Brave") and a writable profile dir.

## 2. Test your real setup (5 minutes)

This is the test that matters: does the agent read and act on a site you are logged into.

1. **Start Flow.** `pnpm dev` (or `flow start`), then open the app.
2. **Turn it on.** Settings, then Browser. Toggle it on and pick your browser (Brave).
3. **Log in once.** Click "Open to sign in" (or run `flow browser login https://SITE`). A real browser window opens. Sign into a site you actually have, a paywalled news site or blog you subscribe to is the classic test. Close the window when done. Your login is saved to a dedicated agent profile, separate from your everyday browser.
4. **Read behind the login.** Point the agent at a members-only page:
   ```bash
   flow agent browser_read https://SITE/members-only-article --mode text
   ```
   You should get the article text back, the thing a plain fetch cannot reach.
5. **Act on a page.** Get a snapshot (it lists elements with `[ref=..]` ids), then click one:
   ```bash
   flow agent browser_read https://SITE            # find a ref like e12 in the output
   flow agent browser_act --kind click --ref e12
   ```
6. **See what it did.** `flow browser status` shows whether a browser is running and the recent activity log.
7. **Kill switch.** `flow browser stop` closes it. Confirm `status` then reports "not running".

You can also do steps 4 to 6 by just asking the in-app agent in chat ("read this URL and summarize it"). The CLI is the same thing without the app.

## What good looks like, and red flags

- **Good:** text comes back on step 4, refs from a snapshot resolve when you click them, `status` shows your activity, and `stop` actually closes the browser.
- **Empty or thin snapshot** on a heavy site (canvas apps, custom widgets): the accessibility tree cannot see it. Retry with `--mode screenshot`, which returns a marked image instead.
- **A `blocked` field in the result** (login or challenge): the profile is not signed into that site, or a CAPTCHA is in the way. Log in again with `flow browser login` and retry. The agent is meant to hand this back to you, not to log in for you.
- **A browser that will not close:** `flow browser stop` is the hard stop. If a window is stuck, it force-kills it.

## Honest limits

- Verified on controlled pages and on this kind of Mac plus Chromium setup. Real, messy, logged-in sites (your specific accounts) are the one thing only you can prove, and step 2 above is how.
- The accessibility tree can be thin on canvas, closed shadow DOM, and some embedded iframes. Screenshot mode is the fallback for those.
- Linux and Windows are not verified yet.
- Security is the login scope you choose. What you log the agent profile into is its reach, so start with a low-stakes account.
