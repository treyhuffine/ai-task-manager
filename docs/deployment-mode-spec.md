# Deployment Mode: Solo vs Team

Self-contained plan for splitting Flow into two deployment modes —
**solo** (the current single-trusted-user behavior) and **team**
(multi-user shared instance) — and gating features that aren't yet
team-safe behind the mode flag.

The immediate motivation is the preview pane. The preview feature
executes user-supplied commands on the Flow host and serves the
result through a same-origin iframe, which is fine for a solo
developer running their own Flow but unsafe to expose to teammates
(see `docs/workspace-preview-spec.md` — "Trust boundary" section).
Rather than block multi-user setups entirely until we ship subdomain-
isolated previews and command sandboxing, this spec introduces a
single explicit mode switch that turns preview off in team mode and
keeps the door open for other "unsafe-in-shared-context" features to
opt out the same way.

## The architectural premise

Flow's current trust model is "the user owns the host." A single
operator runs the daemon, owns the API tokens, sets the workspace
commands, edits the cwd, reads the logs. Every authenticated request
acts with the operator's full authority.

Adding teammates without rethinking that model is unsafe: the
preview pane in particular gives any teammate code execution on the
shared host (`preview_command`) and credential exfiltration via the
iframe (`localStorage['flow.token']` is reachable by the dev app's
JavaScript since the iframe is same-origin).

Rather than retrofit per-user scoping into every surface at once, we
introduce **deployment mode** as a hard guardrail: a top-level
configuration that the daemon reads at boot and that gates feature
exposure across the UI and API. Solo mode is unchanged. Team mode is
strict-mode-by-default — features without per-user safety guarantees
are hidden and refused at the API layer.

## Goals

1. A single, explicit `mode` setting that the operator chooses at
   install/configuration time: `solo` or `team`. Default `solo`.
2. **Preview pane hidden and 403'd in team mode** — the headline
   user-visible behavior change.
3. Surface the active mode in the UI so users know what trust model
   they're inside.
4. Document the criteria a feature must meet to be team-safe, so
   future work has a clear bar.
5. Allow teams to opt back into individual features explicitly
   (`mode=team` + `allow_unsafe_preview=true`) for trusted small
   teams who understand the trade-offs. Off by default; surfaced as
   a warning when enabled.

## Non-goals (v1)

- **Per-user scoping of workspaces, sessions, logs, etc.** That's
  the long path; this spec just gates the worst offender (preview)
  behind a mode switch.
- **Subdomain-isolated previews.** Tracked in
  `docs/workspace-preview-spec.md`.
- **Sandboxed preview command execution** (Docker, per-user UID,
  etc.). Same — out of scope here, tracked in the preview spec.
- **OAuth / SSO / identity provider integration.** Mode is a
  deployment property, not a user-auth scheme.
- **Mode auto-detection** (e.g. "if we see multiple recent api_keys,
  flip to team"). Too magical, too easy to get wrong. Explicit only.
- **Runtime mode toggling.** Mode is read at server boot. Changing
  it requires editing config and restarting. Prevents an attacker
  with API access from flipping to solo to re-enable preview.

## Decisions log

| Topic                              | Decision                                                                                  |
|------------------------------------|-------------------------------------------------------------------------------------------|
| Mode values                        | `'solo' \| 'team'`. No third option in v1.                                                |
| Default                            | `'solo'` (preserves existing behavior for everyone who isn't doing something new).        |
| Where it lives                     | `config.json` at the app root: `{ "mode": "solo" \| "team" }`.                            |
| How it's set                       | Edit `config.json`, or `<cli> mode set <solo\|team>`, or `FLOW_MODE` env var.             |
| Read timing                        | Once at server boot (instrumentation), cached for the process lifetime.                   |
| Precedence                         | `FLOW_MODE` env var > `config.json` > default.                                            |
| Hot-reloadable                     | No. Restart required. Prevents privilege escalation via config write.                     |
| What's gated in team mode (v1)     | Preview pane (UI hidden) + preview API routes (403). Nothing else changes in v1.          |
| Per-feature opt-in                 | `allow_unsafe_preview: true` in config — UI shows red banner. Off by default.             |
| UI badge                           | Footer chip showing "Solo" or "Team" mode. Visible only in team mode by default.          |
| API surface                        | New `GET /api/system/mode` returns `{ mode, allow_unsafe_preview }`. Cached by the UI.    |
| Threat model document              | Inline in this spec + linked from preview spec. Don't grow a separate STRIDE doc.         |

## Architecture

### Reading the mode

`src/lib/config/mode.ts` — single-source-of-truth helper:

```ts
export type FlowMode = 'solo' | 'team';

export interface FlowModeConfig {
  mode: FlowMode;
  /** Allow individual unsafe features in team mode. v1: preview only. */
  allow_unsafe_preview: boolean;
}

export function getFlowMode(): FlowModeConfig;
```

Resolution order on first call (cached for process lifetime):

1. `FLOW_MODE` env var, if set to `solo` or `team`. (Ops-level override.)
2. `config.json` fields `mode` and `allow_unsafe_preview`.
3. Defaults: `mode='solo'`, `allow_unsafe_preview=false`.

The cache means the value is stable across requests — no fs reads
on the hot path. Restarting Flow is the supported way to change the
mode; consistent with the "no runtime toggling" decision.

### Where the gate is enforced

**Preview API routes** (`src/app/api/workspaces/[id]/preview/*` and
`src/app/preview/[workspace]/[[...path]]/route.ts`):

```ts
const { mode, allow_unsafe_preview } = getFlowMode();
if (mode === 'team' && !allow_unsafe_preview) {
  return Response.json(
    {
      error: 'preview_disabled_in_team_mode',
      message:
        'Preview is disabled in team mode because it can leak credentials between users. ' +
        'See docs/deployment-mode-spec.md.',
    },
    { status: 403 },
  );
}
```

Same check fires on `/preview/<id>/*` (the proxy) and on every
`/api/workspaces/<id>/preview/*` route. The proxy returns the
themed error page (the same one used for `preview_unauthorized` etc.)
so the iframe shows something legible if a stale tab tries to load.

**Preview UI** (`src/components/executions/viewer-area.tsx`):

The Preview tab in the right column doesn't render in team mode.
The viewer just shows Files. No tab to switch to, no preview API
calls, no settings section for `preview_command` / `preview_port_override` /
`portless_hostname` in the workspace settings sheet.

**Workspace settings** (`src/components/workspaces/workspace-settings-sheet.tsx`):

The entire "Preview" section is omitted in team mode. The columns
on `workspaces` still exist in the schema (no migration needed) —
they just stop being settable from the UI.

### Telling the client which mode it's in

`GET /api/system/mode` returns `{ mode, allow_unsafe_preview }`.
Public-ish (read-only, no secrets), but still behind the standard
bearer-token middleware — no reason to leak deployment posture to
unauthenticated probers.

`use-flow-mode` hook on the client caches this for the session
(staleTime: Infinity) and feeds it to the UI components that need
to gate themselves. Mode changes require a server restart anyway,
so caching aggressively is fine.

### UI surfacing

Footer status chip: a small "Team mode" badge next to the existing
status indicators. Tap → tooltip explaining what team mode means
and pointing at this doc. Hidden in solo mode (don't clutter the
common case).

When `allow_unsafe_preview` is on, the chip turns amber and the
tooltip explains the trade-off ("Preview is enabled despite team
mode. Don't share preview URLs with teammates.").

### CLI

`<cli> mode get` — print current effective mode and source (`env`,
`config`, or `default`).

`<cli> mode set solo|team` — write to `config.json`. Refuses if
`FLOW_MODE` env var is set (won't be effective until the env var is
cleared).

`<cli> mode set team --allow-unsafe-preview` — explicit opt-in.

## Build plan

One phase. Estimated <1 day of work, mostly plumbing.

- [ ] `src/lib/config/mode.ts` — `getFlowMode()` + cache + env/config/default resolution.
- [ ] `src/app/api/system/mode/route.ts` — return the resolved config.
- [ ] `src/hooks/use-flow-mode.ts` — TanStack Query wrapper, staleTime: Infinity.
- [ ] Gate the proxy route in `src/app/preview/[workspace]/[[...path]]/route.ts`.
- [ ] Gate every `/api/workspaces/[id]/preview/*` route.
- [ ] Hide the Preview tab in `src/components/executions/viewer-area.tsx`.
- [ ] Hide the Preview section in `src/components/workspaces/workspace-settings-sheet.tsx`.
- [ ] Footer mode chip — add to wherever the existing status row lives.
- [ ] `src/cli/commands/mode.ts` — `mode get` / `mode set` subcommands.
- [ ] Tests:
  - `mode.ts` resolution precedence (env > config > default).
  - API routes 403 in team mode.
  - UI components don't render preview-related elements when mode hook returns team.

## Files

### New

- `docs/deployment-mode-spec.md` (this doc)
- `src/lib/config/mode.ts`
- `src/app/api/system/mode/route.ts`
- `src/hooks/use-flow-mode.ts`
- `src/cli/commands/mode.ts`
- `src/components/shared/mode-badge.tsx` (footer chip)

### Modified

- `src/app/preview/[workspace]/[[...path]]/route.ts` — team-mode gate
- `src/app/api/workspaces/[id]/preview/start/route.ts` — team-mode gate
- `src/app/api/workspaces/[id]/preview/stop/route.ts` — team-mode gate
- `src/app/api/workspaces/[id]/preview/status/route.ts` — team-mode gate
- `src/app/api/workspaces/[id]/preview/logs/route.ts` — team-mode gate
- `src/app/api/workspaces/[id]/preview/refresh-token/route.ts` — team-mode gate
- `src/components/executions/viewer-area.tsx` — conditional Preview tab
- `src/components/workspaces/workspace-settings-sheet.tsx` — conditional Preview section
- Wherever the footer status row lives — add `<ModeBadge />`
- `docs/workspace-preview-spec.md` — cross-link to this spec from the trust-boundary section

## Edge cases

- **`FLOW_MODE` set to a garbage value.** Treat as default (solo) and log a warning on boot. Don't crash.
- **Mode changes while clients have stale `useFlowMode` cache.** A teammate viewing the UI when the operator restarts in a new mode sees stale state until they refresh. The API itself enforces — they can't actually execute team-gated actions even if the UI lets them try.
- **CLI runs against a host with mismatched mode.** CLI doesn't need to know the host's mode; it just calls APIs. The host is the source of truth.
- **Per-feature opt-in (`allow_unsafe_preview: true`).** Logged at boot ("⚠ team mode with allow_unsafe_preview enabled"). Footer chip turns amber. Visible enough that an operator who forgot they enabled it will notice.
- **Team mode without `allow_unsafe_preview`, workspaces have leftover preview commands.** The data is preserved (no destructive migration); it's just inert. Switching back to solo mode brings the previews back live.
- **Tests that exercise preview run in solo mode.** Test fixtures set `FLOW_MODE=solo` (or just rely on the default).

## What "team-safe" means for future features

A feature can stay enabled in team mode only if all of these hold:

1. **No code execution on the Flow host on behalf of a teammate's input.** Preview's `preview_command` and `cwd` fail this — anyone who can edit a workspace gets RCE on the daemon's host.
2. **No iframe (or anything else) that runs untrusted code on Flow's origin.** Subpath-mounted same-origin iframes give the inner code access to Flow's `localStorage` and ambient session cookie. Subdomain isolation lifts this; until then, no in-Flow iframes of arbitrary content.
3. **API responses are scoped to the requester's workspaces / sessions / files.** If feature X's endpoint returns global rows by workspace_id without checking ownership, X is not team-safe yet.
4. **Outputs (logs, transcripts, attachments) are similarly scoped.**

When (1) and (2) are addressed via subdomain isolation + command sandboxing, preview becomes a candidate for "default-enabled in team mode." Until then, the mode switch is the answer.

## Reference paths

- Single-user trust model write-up: `docs/workspace-preview-spec.md` ("Trust boundary: same-origin iframe")
- Existing bearer-auth middleware: `src/proxy.ts`
- Existing config root: `src/lib/config/paths.ts` (`getConfigPath`)
- Existing preview API gates (where the new check goes): `src/app/api/workspaces/[id]/preview/*/route.ts`
- Workspace settings sheet (where the Preview section is conditionally rendered): `src/components/workspaces/workspace-settings-sheet.tsx`
