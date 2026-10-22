# Subscription usage

The top bar's gauge icon opens Usage, showing account allowances reported by subscription harnesses. The trigger has no visible text label, so it does not read as a heading for neighboring status indicators. Its accessible name and the card heading identify it as Usage. Each independent allowance keeps its own percentage and reset time. Usage is shared by chats on the same home and account. A connected device can use a different login, so its allowances do not appear here.

With warnings enabled, each provider approaching a limit appears beside Usage as a compact stack: a 12px brand mark above a 10px percentage. Amber starts at 80%, red at 90% or confirmed enforcement. The badge represents the fullest current allowance, with confirmed enforcement taking priority. The card names the affected window, including model-specific windows. Independent percentages are never combined.

The Codex mark uses the same blue-purple brand color as the model selector in both themes, resolved from the shared harness logo data. Near-black brand marks use the theme foreground. A provider blocking without a measured percentage shows an exclamation instead of an invented percentage. Optional extra usage and credit balances do not independently trigger warnings. A full allowance is distinct from confirmed blocking because credits may allow work to continue.

## Refresh behavior

- `useHarnessRateLimits` reads the cached snapshot every two minutes while the page is visible. It refreshes immediately when the page becomes visible again. Hidden pages do not poll.
- A stale snapshot requests a sessionless provider read. The server shares in-flight work and enforces a two-minute cooldown per harness across tabs, including failed attempts. A recent chat observation also satisfies that cooldown.
- `recordRateLimits` publishes `rate_limits_updated` through the existing page stream. The client coalesces a burst into one cache refresh. Usage does not open a separate stream or scan transcripts.
- The local runner reports account telemetry through its optional sink observer. The Home's sink records and publishes it. Device journals omit that observer, so another device's account limits are not forwarded to this Home and workers do not import its realtime bus.
- Opening Usage enables reads even when warnings are disabled. Disabling warnings and closing the card stops that client's polling.
- Reads start no conversation and consume no model prompt. Provider failures retain the last reported values for inspection. Header warnings require an observation less than ten minutes old, checked per allowance rather than per provider.
- A timer clears a badge when its allowance resets or its observation expires, without waiting for another provider read. Previously confirmed enforcement with a past reset cannot keep a warning visible.

## Preference and interaction

“Show usage warnings” is one home-level preference, available in the card and Settings > AI > Usage & budget. `user_state.usage_warnings` is nullable, with no database default. Readers resolve null to on. Changes use the existing optimistic user-state mutation, including rollback on failed saves.

Hover previews the card, click or tap pins it, a second click closes it, and Escape dismisses it. Enter opens the card from the keyboard. The trigger's accessible name describes each warning's provider, allowance, percentage, status and reset. Explicit status text and numeric percentages supplement the colors.

## Verification

`RI_USAGE_BROWSER_TEST=1 pnpm exec vitest run src/components/dashboard/rate-limits-pill.browser.test.ts` covers light and dark rendering, compact sizing, keyboard and pinned interaction, foreground polling, visibility resume, live updates, preference persistence and reset expiry. Display tests cover warning thresholds, stale measurements, model-specific scopes, missing percentages and optional extra usage. The API tests cover nullable preference updates and validation.
