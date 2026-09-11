# Schema column defaults: audit and cleanup guide

> **OUTCOME (2026-09-10): executed, via a migration-baseline squash instead of
> Phase B.** The 18-migration chain was replaced by a single regenerated
> `drizzle/0000` baseline, and EVERY policy default below was physically
> dropped from `schema.ts` — including the NOT NULL status enums this doc
> originally recommended keeping as inert backstops. That recommendation only
> existed because dropping a default on a live table needs a rowid-safe column
> swap per column; a fresh baseline has no such constraint, so the end state
> is fully clean: structural defaults only (timestamps, `[]`/`{}`, `0`,
> `userId 'local'`, `description ''`). In a same-day follow-up ALL NINE
> boolean defaults were dropped as well (state flags → write-time `?? value`
> in creators; `voiceAutoSend` → nullable + read-time `?? true`;
> `workspaces.isGit` → required fact, no fallback), so the schema now carries
> ZERO boolean defaults. The four `user_state`
> policy columns (`workdayStart/End`, `voiceModel`, `orchestratorMode`) became
> nullable with app-level resolvers. Creator inputs re-optionalize the policy
> fields via `PolicyOptional` in `src/db/types.ts`. Existing data was carried
> into a rebuilt DB (permission modes remapped in-flight) by
> `personal/schema-rebuild/rebuild-db.ts`; old migrations are preserved in git
> history and `personal/schema-rebuild/drizzle-pre-squash/`. The line numbers
> and "current state" claims below describe the PRE-squash schema — read the
> rest of this doc as the historical analysis and inventory.

A complete inventory of every `.default(...)` in `src/lib/db/schema.ts`, sorted
into what to keep and what to reconsider before launch. The goal is to stop the
schema from silently encoding product decisions that you will later want to
change.

## The principle

A DB default is fine when it encodes a **structural invariant**, a value that is
true by construction and will never need to change:

- Timestamps (`(datetime('now'))`) and primary keys
- Empty collections (`[]`, `{}`)
- Zero counters and accumulators (`0`)
- Boolean flags with an obvious off/on resting state
- The single-user `userId 'local'` sentinel (local-first invariant)

A DB default is a **trap** when it encodes a **policy**, a business or product
choice that is plausible to change: an entity's initial status, a mode, a
provider/model id, a working-hours window, a routing policy. Two problems:

1. **It splits the source of truth.** The real decision now lives in two places
   (the schema and the query layer), and they can drift.
2. **It is expensive to change later.** SQLite cannot `ALTER` a column default
   (no `SET`/`DROP DEFAULT`). Changing or removing one on a populated table
   forces a full-table rebuild, which reassigns rowids and desyncs any
   external-content FTS5 index keyed by rowid (`tasks_fts`, `notes_fts`,
   `stream_fts`). See `CLAUDE.md` and `drizzle/0016_lyrical_network.sql`.

The convention: **policy lives in the query layer** (as `createTask` sets
`status: 'todo'`). If a NOT NULL column is forced to keep a default for
insert-safety, keep it equal to the query-layer value and treat it as inert.

> **Data note (corrected).** An earlier draft claimed that because you are the
> only user you can just `db:reset`. That was wrong: "only user" is not "no
> data" — the real prod DB holds hundreds of live `chat_sessions` (476 at review
> time, every one `permission_mode='bypass'`). A `db:reset` would destroy that
> session history, and a plain schema change with no data remap breaks every
> existing row. But the decision (per the app owner) is to NOT add a drizzle
> migration for this: only ONE thing actually has to touch the DB — a one-time
> data remap — which is run as raw SQL (see "Applying the rename without a
> migration" below). The DB column default is left inert, and the formal schema
> reconciliation is folded into a single pre-launch pass, not a piecemeal
> migration now.

## Verdict legend

- **KEEP** structural invariant, leave as is.
- **INERT** policy, but the query layer already sets it, so the DB default is a
  redundant backstop. Fine to leave (understood as inert), no behavior rides on
  it.
- **ACT** policy AND the DB default is load-bearing (a creator can omit the
  field and fall through to the schema value). Move the decision into the query
  layer.
- **RETHINK** the default *value itself* is questionable, not just its location.

---

## KEEP: structural defaults (fine as they are)

These are the timestamps, keys, empty collections, counters, and flags. No
action needed.

### Timestamps (shared `timestamps` spread + explicit ones)
- `*.createdAt`, `*.updatedAt` `(datetime('now'))` (schema.ts:47, 50)
- `taskCompletions.completedAt` (500), `chatSessions.startedAt` (1265),
  `runs.queuedAt` (1840) `(datetime('now'))`

### Empty JSON collections (`[]` / `{}`)
- `agentHarnessSettings.enabledModels` (134), `.customModels` (141)
- `*.attachments` on areas/stream/tasks/decks/workspaces/executions/chatEvents/notes (180, 234, 441, 725, 1365, 1477)
- `tasks.contextTags` (437), `.foldedHeadings` (442); `notes.foldedHeadings` (1478), `.contextTags` (1482); `stream`/`decks` contextTags (581)
- `decks.items` (583), `.alternatives` (584), `.changes` (606), `.calendarSnapshot` (611)
- `workspaces.connectorScopes` (743), `executions.previewUrls` (966)
- `triggers.deliverResultTo` (1759), `notificationChannels.events` (1946)
- `agents.config` (865), `notificationChannels.config` (1944) `{}`

### Zero counters / accumulators (`0`)
- `areas.sortOrder` (186); `triagePasses.itemsSeen/autoApplied/proposed` (321-323)
- `tasks.statusChangedCount` (462), `.timesDeferred` (473)
- `workspaces.position` (761), `referenceFolders.position` (823), `chatRefs.position` (1600)
- `externalSessionImports.syncOffset` (1313), `chatEvents.sourcePartIndex` (1359)
- `entityProjectionState.sourceRevision/linksProjectedRevision` (1557-1558)
- `runs.consecutiveFailures` (1750), token/cost counters (1850-1854)
- `notificationDeliveries.attempts` (1984), `skillUsage.useCount/score` (2019, 2021)

### Boolean flags
- `userState.voiceAutoSend` true (97), `workspaces.isGit` false (727),
  `.collapsed` false (762), `.skipLiveConfirm` false (769), `.browserEnabled` true (774)
- `previewTargets.pinned` false (1112), `chatRefs.hydrate` true (1601),
  `triggers.enabled` true (1637), `notificationChannels.enabled` true (1947)

### Local-first sentinels
- `userId 'local'` on agents (860), executions (891), chatSessions (1140),
  triggers (1634), notificationChannels (1932), webPushSubscriptions (1960),
  notificationDeliveries (1973). Structural given single-tenant local-first.
- `userState.description` `''` (96)

---

## Policy defaults (verified against the query layer)

Every one of these is NOT NULL, so removing the default outright is not clean
(SQLite cannot drop a default without a full-table rebuild). The fix is to make
the query layer authoritative and treat the DB default as an inert backstop
equal to that value.

### INERT: query layer already sets it (leave as inert backstop)

Verified in `src/lib/db/queries.ts`. No behavior rides on the DB default.

| Table.column | schema.ts | Default | Where set in query layer |
|---|---|---|---|
| `tasks.status` | 458 | `todo` | `createTask` (`status: input.status ?? 'todo'`, ~636) |
| `notes.status` | 1481 | `active` | `createNote` (~1870) |
| `areas.status` | 185 | `active` | `createArea` (~3527) |
| `stream.status` | 227 | `pending` | `streamInsertValues` (2189) |
| `stream.source` | 200 | `capture` | `streamInsertValues` (2188) |
| `chatSessions.status` | 1149 | `active` | `createChatSession` (5268), `createExecutionWithChat` (5487) |
| `executions.status` | 970 | `active` | `createExecution` (4705), `createExecutionWithChat` (5472) |
| `workspaces.status` | 777 | `active` | `createWorkspace` (4193) |
| `agents.status` | 868 | `active` | `createAgent` (4625) |
| `triagePasses.status` | 318 | `running` | `beginStreamSweep` (hardcoded 2434) |
| `apiKeys.deviceType` | 691 | `other` | `createApiKey` (`?? 'other'`, 4045) |
| `taskStatusChanges.actorSource` | 551 | `human` | insert (`meta?.source ?? 'human'`, 978) |
| `executionReviews.actorSource` | 1047 | `human` | insert (`?? 'human'`, 1533/1589) |
| `entityVersions.source` | 1412 | `human` | insert (2023 / `?? 'human'` 2034) |
| `chatRefs.createdBy` | 1604 | `user` | wrapper (`args.createdBy ?? 'user'`, 6643) |

> Sub-note on `actorSource`/`source`/`createdBy`: these ARE set, but via a code
> `?? 'human'`/`?? 'user'` fallback. That still silently guesses authorship when
> a caller forgets the field. Consider making the param required so an agent
> write can never be mislabeled as human. Low risk, worth a look.

### ACT: the DB default is load-bearing (move the decision)

Verified: these creators spread `...input` and never set the field, so the
schema default is the real source of truth today. These are the actual targets.

| Table.column | schema.ts | Default | Enum | Note |
|---|---|---|---|---|
| `chatSessions.permissionMode` | 1237 | `bypass` | bypass/default/accept_edits/plan | Neither session creator sets it. See design note below. |
| `stream.media` | 204 | `text` | text/voice/image | `streamInsertValues` sets source+status but not this. On the FTS-backed `stream` table. |
| `stream.origin` | 208 | `internal` | internal/webhook/api | Same. On the FTS-backed `stream` table. |
| `decks.origin` | 603 | `manual` | morning/first_open/midday/manual | `createDeckVersion` spreads `...input`; a caller that omits `origin` silently becomes `manual`. |
| `triggers.concurrencyPolicy` | 1692 | `coalesce_if_active` | skip_if_running/coalesce_if_active/allow_concurrent | `createTrigger` spreads `...input`. Routing policy encoded in schema. |
| `triggers.catchUpPolicy` | 1706 | `skip_missed` | skip_missed/run_all | Same. |
| `runs.status` | 1832 | `queued` | queued/running/... | `createRun` spreads `...input`. Initial state is genuinely invariant (a run always starts queued), so lower risk, but still belongs in the creator for consistency. |
| `externalSessionImports.status` | 1320 | `importing` | importing/current/... | `createExternalSessionImport` spreads `...input`. Same invariant-initial-state reasoning as runs. |
| `notificationDeliveries.status` | 1983 | `pending` | pending/sent/failed/skipped | Insert spreads `...input`. Same. |

The bottom three (`runs`, `imports`, `notificationDeliveries`) are load-bearing
but the value is a true initial-state invariant, so they are the lowest-priority
of this group. The top ones (`permissionMode`, `stream.media/origin`,
`decks.origin`, the trigger policies) encode a *choice* and are the real
cleanup.

---

## RETHINK: default values that are questionable on their own

Not just misplaced, but the value itself is brittle or surprising.

| Table.column | schema.ts | Default | Why it is a problem |
|---|---|---|---|
| `userState.voiceModel` | 98 | `'local/parakeet-tdt-0.6b-v3'` | A concrete model id frozen into the schema. Model names churn constantly. This is the textbook policy-that-will-change. Resolve from the STT provider config at read time, not a schema literal. |
| `userState.orchestratorMode` | 113 | `'legacy'` | A brand-new install defaulting to `legacy` is almost certainly wrong for a fresh user. Confirm the intended initial mode and default a new row to that, not the migration-era fallback. |
| `apiKeys.env` | 697 | `'live'` | Defaulting an environment/key to `live` rather than `test` is the less-safe direction. A forgotten field silently mints a live-scoped record. Consider defaulting to `test`, or requiring it. |
| `userState.workdayStart/End` | 90, 91 | `'09:00'`/`'18:00'` | Working-hours policy baked into the schema. Fine as a seeded app default, but it is a product decision, not an invariant. Move to app/config seed. |
| `triggers.timezone` | 1674 | `'UTC'` | Reasonable fallback, but a scheduling policy. Prefer resolving from user state at trigger-create time. |
| `triggers.maxCatchUpRuns` | 1707 | `3` | A tunable policy number sitting in the schema. Low urgency, but belongs with the other trigger policy in the query/config layer. |
| `workspaces.remoteName` | 729 | `'origin'` | Sensible git convention, borderline structural. Leave unless you support non-`origin` remotes as a first-class choice. |
| `workspaces.filesToCopy` | 737 | `['.env*']` | A policy list, but a reasonable seed. Borderline. Leave unless it becomes user-configurable. |

---

## Special case: `permissionMode`, naming, and the harness boundary

> **Status: DONE.** This section captures the analysis that motivated the rename
> and harness split; all of it has shipped. The vocabulary is now
> `auto_all | auto_edits | ask | plan`, defined once in
> `src/lib/permissions/modes.ts` and translated per-harness in
> `src/lib/executor/permission-map.ts`. The subsections below are written in the
> pre-change present tense to preserve the reasoning; read them as "why," not
> "todo."

### Where the enum lived before this change

The set of permission modes was declared in **five** places, none of them a
single source of truth:

1. `db/types.ts` `PERMISSION_MODES = ['bypass','default','accept_edits','plan']`
2. `schema.ts` inline `enum: [...]` on `permissionMode`
3. `schema.ts` inline `enum: [...]` again on `prePlanMode`
4. `permission-modes.ts` `PERMISSION_MODE_META` (display labels/colors, keyed by mode)
5. `adapter.ts` `claudePermissionFlag` switch (the Claude translation)

The fix (shipped): a single exported tuple `PERMISSION_MODES` in
`src/lib/permissions/modes.ts`, imported by the schema (both `permissionMode`
and `prePlanMode`) and re-exported from `@/db/types`; `PERMISSION_MODE_META`
stays the display layer keyed off it; the Claude translation moved to
`permission-map.ts`.

### The old names were Claude Code's flag tokens, not app concepts

`bypass/default/accept_edits/plan` mirrored Claude's `--permission-mode` flags:

```
bypass       -> null  (+ skipPermissions, i.e. --dangerously-skip-permissions)
default      -> 'default'
accept_edits -> 'acceptEdits'
plan         -> 'plan'
```

Problems: `default` does not mean "the default mode" (`bypass` is), and the
vocabulary does not generalize to Codex or opencode.

### Proposed app-native vocabulary

The bare token does not have to carry the whole spec (its canonical meaning
lives in the meta record with a doc comment per value), but it should not be
actively misleading either. Suggested:

| App mode | Meaning | Was |
|---|---|---|
| `auto_all` | Agent runs every tool with no prompts. | `bypass` |
| `auto_edits` | Auto-allow file writes in the workspace. Prompt for shell, network, and everything else. | `accept_edits` |
| `ask` | Prompt before every mutating tool (edits, shell, network). Reads run free. | `default` |
| `plan` | Read-only. Agent proposes a plan and makes no changes. | `plan` |

Naming principle: the `auto_` prefix marks *what scope is auto-approved*, and
there are two such scopes (`auto_all`, `auto_edits`), so the bare `auto` from the
first draft was wrong. It reads as a third sibling when it is really the
"everything" end of that axis. Promote it to `auto_all` so the two automatic
modes are parallel. `ask` and `plan` stay single words on purpose: neither has a
sibling to disambiguate against (there is no "ask edits only" mode), so a
qualifier would be noise. If you would rather every token be fully
self-describing, `auto_all | auto_edits | ask_all | plan` is the maximally
explicit variant. Either way, define them once:

```
// src/lib/permissions/modes.ts (single source of truth)
export const PERMISSION_MODES = ['auto_all', 'auto_edits', 'ask', 'plan'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
// PERMISSION_MODE_META (labels + one-line description per value) moves here too.
```

### The harness boundary: app side vs agentex

Inspected against `~/code/agentex/packages/agent/src/types.ts`. Agentex's
`ProviderConfig` already owns **generic, cross-provider** permission primitives,
and each provider adapter translates them to native flags:

- `skipPermissions?: boolean` (types.ts:695). Claude skips prompts, cursor maps
  it to `--force` (`providers/cursor/execute.ts:104`). This is a real abstraction.
- `planMode?: boolean` (types.ts:758), documented verbatim as "the cross-provider
  read-only abstraction," honored where `capabilities.planMode` is true (claude,
  codex).
- Supporting knobs: `unattendedPermissionPolicy` (674), `allowedTools` /
  `disallowedTools` (713, 718), and `modeId` + `listModes()` (744) for
  provider-defined operating modes (codex collaboration modes, copilot
  allow-all/agent/plan).

So the app's four modes already land like this:

| App mode | How it reaches the harness today | Coupled to Claude? |
|---|---|---|
| `auto_all` (`bypass`) | `config.skipPermissions = true` (adapter.ts:993) | No, generic |
| `plan` | `config.planMode = true` (adapter.ts:1008) | No, generic |
| `ask` (`default`) | `extraArgs.push('--permission-mode','default')` (996) | **Yes, raw Claude flag** |
| `auto_edits` (`accept_edits`) | `extraArgs.push('--permission-mode','acceptEdits')` (996) | **Yes, raw Claude flag** |

So the honest answer to "does mapping need to happen in agentex or is it all app
side": **two of the four already go through agentex's generic abstractions.** The
only Claude-coupled piece is the two middle rungs (`ask`, `auto_edits`), which
the app expresses as raw `--permission-mode` flags because agentex has no generic
concept for "ask before each mutation" or "auto-approve edits only."

- **App-side interim (no agentex release):** centralize the two `extraArgs`
  strings in one `permission-map.ts` keyed by provider. Small, keeps the Claude
  flag names in this repo for now.
- **Agentex-side (recommended, and the natural fit):** add the two missing rungs
  to agentex alongside `skipPermissions`/`planMode`, either as a narrow
  `autoEdits?: boolean` or a normalized `permissionMode` enum on `ProviderConfig`,
  and let each provider translate (claude → `--permission-mode acceptEdits`, codex
  → its permission profile, etc). Then this repo maps its four app modes onto
  agentex's generic surface once and holds zero Claude flag strings. This mirrors
  how `skipPermissions` and `planMode` already work, so it is a continuation of
  agentex's existing design, not a new pattern.

Recommendation: extend agentex with the two middle rungs so all four modes ride
generic abstractions, and reduce this repo to an app-enum -> agentex-config map.
Use the app-side `permission-map.ts` only if you want to ship the rename before
cutting an agentex release.

### Is "auto is the default" a separate task?

No. Auto was already the effective default (the old DB default was `bypass` and
every fallback resolved to it), so the work was mechanical: rename
`bypass -> auto_all`, and set it explicitly in the query-layer creators
(`createChatSession`, `createExecutionWithChat`, `createChatForFire`,
external-agent import) via the shared `DEFAULT_PERMISSION_MODE` constant. The DB
column default is left as the (now inert) old value; nothing reads it, since the
query layer always sets the mode.

---

## Cleanup pass: two phases

**Phase A** is the app-code work plus ONE required DB touch: a one-time **data
remap** of existing rows (they hold the old vocabulary). Per the app owner's
call, this is run as **raw SQL, not a drizzle migration** — see "Applying the
rename without a migration" below. Everything else in Phase A is pure query-layer
code that leaves the existing DB defaults inert (nothing to apply).

**Phase B** is the optional remainder: physically dropping the now-inert policy
defaults from `schema.ts` (voiceModel, workday, timezone, env, the status/authorship
enums) AND reconciling the `permission_mode` default. It is schema hygiene, not
correctness, and it is deferred to a single pre-launch pass rather than a
piecemeal migration now.

### Phase A — app code + a one-time data remap (raw SQL)

| # | Change | Status |
|---|---|---|
| 1 | Permission-mode enum → single tuple `src/lib/permissions/modes.ts`, re-exported from `@/db/types`; type stays schema-derived | DONE |
| 2 | Rename to `auto_all \| auto_edits \| ask \| plan`; set explicitly in `createChatSession` + `createExecutionWithChat` | DONE |
| 3 | `--permission-mode` construction moved to `src/lib/executor/permission-map.ts` (app-side interim); per-provider supported-modes matrix consolidated there too (`supportedPermissionModes`), used by the composer + PATCH route | DONE |
| 3b | Loud `default:` guard in `claudePermissionFlag` turns any un-remapped straggler into a visible error. DB column default left inert (no swap). Data remap is manual SQL (below), run by the owner | CODE DONE / SQL PENDING (owner-run) |
| 4 | `stream.media` / `stream.origin` set in `streamInsertValues` | DONE |
| 5 | `decks.origin`, `triggers.concurrencyPolicy` / `catchUpPolicy` / `timezone` set in creators | DONE |
| 6 | `runs.status`, `externalSessionImports.status`, `notificationDeliveries.status` set in creators | DONE |
| 7a | `voiceModel`, `workdayStart/End`, `orchestratorMode` — already app-resolved (`resolveVoiceModel`, `getWorkdayBounds`, `resolveOrchestratorMode`) | NO ACTION (pre-existing) |
| 8a | `apiKeys.env` — `createApiKey` now defers to `getTokenEnv()` (env-aware) instead of hardcoding `'live'`, fixing test-env mislabeling; explicit `input.env` still wins | DONE |
| 9 | `source` / `actorSource` / `createdBy` now REQUIRED on `updateTask`, `updateNote`, `transitionTask`, `completeTask`, `reviewExecutionOutput`, `acceptOutputAndCompleteTask`, `materializeEventRefs`, `pinSessionRef`; internal `?? 'human'` / `?? 'user'` fallbacks removed | DONE |

Verification for the DONE rows: `pnpm ts` clean, ESLint on changed files clean
(one pre-existing unrelated warning), 373 tests green across
db/executor/stream/run/import/dev/sessions. The remap SQL below was verified in
isolation against a scratch SQLite DB (remap correct on both columns, new rows
default `auto_all`, NOT NULL preserved, indexes intact).

Deferred (from code review, not blocking, need a product call):

- **Orchestrator-posted message authorship.** `send_session_message` posts
  through `POST /sessions/:id/messages`, which hard-codes the event as
  `role: 'user'` and now `createdBy: 'user'`. So when the orchestrator (an agent)
  injects a message, its entity refs are recorded as user-authored. This predates
  the rename (the route always assumed a human poster) and fixing it means
  threading a real author/source through the route + `send_session_message`
  without breaking the "agent sees it as a user turn" harness semantics. Left for
  a deliberate decision.
- **Registry actor attribution is self-inconsistent.** `lifecycleActor` tags
  local-CLI actions `'human'` while `update_note` hard-codes `'ai'`. Pre-existing.
  Worth reconciling alongside the messages-route authorship above, since both are
  about "who is the agent surface's actor."

Resolved decisions:

- **`apiKeys.env`**: the code already answered it. `generateToken`'s own default
  is `getTokenEnv()` (returns `'test'` only under `AUTH_TOKEN_ENV=test`, else
  `'live'`), and `createApiKey` was overriding it with a hardcoded `?? 'live'` —
  a latent bug that mislabels keys minted in a test environment. Fixed by
  deferring to `getTokenEnv()`. Production behavior is unchanged (still `'live'`
  normally); an explicit `input.env` still wins.
- **Item 9**: done. Only 4 production call sites actually omitted authorship
  (the `tasks`/`notes` PATCH routes → `human`, and the `messages`/`references`
  session routes → `user`); the compiler proved every other production caller
  already passed it. 43 test call sites were updated (no test asserts on the
  actor, so `source: 'human'` is a safe fill). Out of scope: `stream.dismissedBy`
  (`queries.ts:2846`) keeps a `?? 'user'` last-resort in a preserve-existing
  chain — it is a dismissal actor, not one of item 9's columns, and not a
  mislabel risk. Left as-is deliberately.

### Applying the rename without a migration

No drizzle migration is added for the permission-mode rename (owner's call). The
ONLY thing that must touch the DB is a one-time value remap of existing rows, run
as raw SQL directly against the DB. Run it ONCE per DB (dev, and prod at deploy),
and run it BEFORE booting this branch against that DB — otherwise the composer
throws on the old `bypass` rows (`PERMISSION_MODE_META['bypass']` no longer
exists).

```sql
-- Remap chat_sessions to the app-native permission vocabulary.
-- Rowid-safe (plain UPDATE), so no FTS index is disturbed. Idempotent:
-- re-running is a no-op once values are already remapped.
UPDATE chat_sessions SET permission_mode = CASE permission_mode
  WHEN 'bypass'       THEN 'auto_all'
  WHEN 'default'      THEN 'ask'
  WHEN 'accept_edits' THEN 'auto_edits'
  ELSE permission_mode
END;

UPDATE chat_sessions SET pre_plan_mode = CASE pre_plan_mode
  WHEN 'bypass'       THEN 'auto_all'
  WHEN 'default'      THEN 'ask'
  WHEN 'accept_edits' THEN 'auto_edits'
  ELSE pre_plan_mode
END
WHERE pre_plan_mode IS NOT NULL;
```

What is deliberately NOT done here: the `chat_sessions.permission_mode` column
DEFAULT is left at its old value (`'bypass'`). It is inert — every insert path
sets the mode explicitly in the query layer, so the default never fires, and the
loud `default:` guard in `claudePermissionFlag` would surface any straggler.
Reconciling that default is deferred to the single pre-launch pass (Phase B).

Note on drizzle bookkeeping: because `schema.ts` now declares `.default('auto_all')`
while the snapshot still records `'bypass'`, `pnpm db:generate` will report a
pending default change. That is expected and harmless — the boot-time migrator
only runs journaled migrations (none new), so nothing auto-applies. It gets
resolved when Phase B runs.

### Phase B — schema hygiene (SUPERSEDED by the baseline squash, see OUTCOME at top)

Edits to `schema.ts` that drop the now-inert policy literals AND reconcile the
`permission_mode` default. Optional for correctness (Phase A already behaves
correctly). When you do run it, it is a hand-rolled migration, NOT a `db:reset`
(the real DB has data).

The `permission_mode` default reconciliation (`bypass` -> `auto_all`) belongs
here: a rowid-safe column swap per the `drizzle/0016` doctrine, batched with the
other default drops below.

To do in the pass — remove the now-inert policy literals from `schema.ts`:

- Value-y brittle defaults (the ones this whole doc is about): `voiceModel`
  (make nullable, drop default — `resolveVoiceModel(null)` already handles it),
  `workdayStart` / `workdayEnd` (drop defaults; `getWorkdayBounds` covers),
  `triggers.timezone` (drop default; `createTrigger` now covers),
  `orchestratorMode` (set default `'harness_mcp'` or drop; `resolveOrchestratorMode`
  covers), `apiKeys.env` (now inert — `createApiKey` defers to `getTokenEnv()` —
  so drop the schema default, or set it to `getTokenEnv()`'s baseline `'live'`).
- Status/policy enums now set in the query layer: `stream.media/origin`,
  `decks.origin`, `triggers.concurrencyPolicy/catchUpPolicy`, `runs.status`,
  `externalSessionImports.status`, `notificationDeliveries.status`.
- Authorship defaults (item 9 has landed): `taskStatusChanges.actorSource`,
  `executionReviews.actorSource`, `entityVersions.source`, `chatRefs.createdBy`
  are all now supplied by the query layer, so their DB defaults are inert.

Per-column judgment for the NOT NULL enums: the sanctioned end-state in
`CLAUDE.md` is to KEEP a NOT NULL policy default as an inert backstop rather than
remove it (SQLite cannot drop a default without a rowid-safe column swap). Each
removal you do want ships as a hand-rolled rowid-safe swap in the migration (the
`drizzle/0016` pattern — never accept drizzle's table rebuild), and any raw
insert path that bypasses the query layer must already supply the value.
Recommendation: drop the brittle value-y ones (`voiceModel`, workday, timezone,
`env`) — they are the point of the exercise; keep the high-traffic status enums
inert (low value, real risk). `permission_mode`'s default is reconciled here too
(swap `bypass` -> `auto_all`), or kept inert if you prefer.

Apply: `pnpm db:generate`, hand-edit the generated SQL into rowid-safe column
swaps per `drizzle/0016` (add plain-UPDATE data remaps where a value also
changes), then `pnpm db:migrate`. Never `db:reset` against the real DB.
