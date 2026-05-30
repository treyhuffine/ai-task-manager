# Async Agents V1 — Deferred Fixes & Follow-ups

> **Status.** Working notes captured after the V1 substrate shipped
> (`docs/async-agents-v1.md`). Lists items that surfaced during code
> review, with proposed shapes, file references, and risk notes so any
> of them can be picked up cleanly without re-deriving the problem.
>
> **What this doc is not.** Not a roadmap. Not a commitment. Just a
> landing pad for everything that's been triaged-not-fixed.

---

## TL;DR

Three buckets of follow-up work, ordered by impact-per-effort:

| Bucket | What | Why deferred |
|---|---|---|
| **Quick wins** | `recordSkipped` duration cosmetic, schedules-new "unsaved changes" warning, schedule detail "Reset failures" always-visible chip, schedule detail run pagination, `kindButtonCls` `aria-pressed`, webhook rotate-secret action | Pure UX polish; low risk; each ~30 min |
| **Robustness** | Tool-call cache leak (`event-hooks.ts`), schedule-edit CLI completeness, webhook secret encryption at rest, webhook replay protection | Medium risk — touches design decisions or threat-model choices |
| **Upstream** | Five proposals to `@agentex/agent` (see `docs/agentex-feedback.md`) | Owned by the SDK maintainers, not us |

The V2 candidates (heartbeat, lanes, pre-gate, connectors, goals, etc.) live in `docs/async-agents-v1.md §10`; this doc covers the V1.5 / cleanup tier instead.

---

## 1. Quick wins

These are all small, isolated changes. Pick any, ship in isolation, no dependencies on each other.

### 1.1 `recordSkipped` duration shows 0

**File**: `src/lib/runs/dispatch.ts:392–408`

```ts
function recordSkipped(args: RecordSkippedArgs): RunRecord {
  const now = new Date().toISOString();
  return createRun({
    ...,
    queuedAt: now,
    completedAt: now,   // ← same instant
  });
}
```

`durationMs` defaults to 0 for skipped runs. Visually odd in run tables that show "Duration" alongside started/completed. Cosmetic only.

**Fix**: leave `completedAt` set, but make the UI render `—` for skipped runs instead of `0ms`. Or set `durationMs: null` explicitly in `recordSkipped`.

**Risk**: trivial, UI-only.

---

### 1.2 "Unsaved changes" warning on `/schedules/new`

**File**: `src/app/schedules/new/page.tsx`

15+ fields. Clicking Cancel discards silently. Standard `useBeforeUnload` + confirm-on-Cancel handles it.

**Fix**:
```ts
useEffect(() => {
  const onUnload = (e: BeforeUnloadEvent) => {
    if (!isDirty) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', onUnload);
  return () => window.removeEventListener('beforeunload', onUnload);
}, [isDirty]);
```

Plus a confirm() on the Cancel button when dirty.

**Risk**: low. Standard pattern.

---

### 1.3 "Reset failures" chip always visible when counter > 0

**File**: `src/app/schedules/[id]/page.tsx`

Today the Reset action lives inside the red banner that only shows at `consecutiveFailures >= 3`. Users with 1 or 2 failures can't reset without forcing a third.

**Fix**: render a small "Reset failure count (2)" chip in the schedule detail header when `consecutiveFailures > 0`, regardless of the banner.

**Risk**: trivial, UI-only.

---

### 1.4 Schedule detail "Recent runs" pagination

**File**: `src/app/schedules/[id]/page.tsx` (hardcoded `limit: 20`)

For schedules that fire daily, the first 20 runs is the most recent 20 days. After that, history is invisible from the UI (still queryable via `/api/runs?scheduleId=...`).

**Fix**: add a "View all runs for this schedule →" link that navigates to `/runs?scheduleId=<id>` with the filter pre-applied. The `/runs` page already exists.

**Risk**: trivial. The runs page would need to honor the `scheduleId` query param (its `useRuns` hook already takes it).

---

### 1.5 `kindButtonCls` accessibility

**File**: `src/app/schedules/new/page.tsx`

The kind / target / policy toggles look pressed visually but don't announce state to screen readers. Add `aria-pressed={active}`.

**Fix**: one-line attribute add on each toggle button.

**Risk**: zero.

---

### 1.6 Webhook rotate-secret action

**Files**: `src/lib/orchestrator/registry.ts`, `src/lib/scheduler/webhook.ts`, schedule detail UI

If a user loses the plaintext webhook secret, they must delete and recreate the schedule. A rotate action is small additive work:

```ts
const rotate_webhook_secret_action = defineAction({
  name: 'rotate_webhook_secret',
  description: 'Generate a new webhook secret for a schedule. Returns the plaintext secret exactly once; the old secret stops working immediately.',
  params: { id: z.string().min(1) },
  mutating: true,
  handler: (_ctx, { id }) => {
    const schedule = getSchedule(id);
    if (!schedule || schedule.kind !== 'webhook') {
      throw new ActionError('not_found', 'Webhook schedule not found');
    }
    const { secret, secretHash } = generateWebhookCredentials();
    updateSchedule(id, { webhookSecretHash: secretHash });
    return { webhookSecret: secret };
  },
});
```

UI: a "Rotate secret" button on the schedule detail page that opens the same `WebhookCredentialsPanel` used on create.

**Risk**: low. The old secret stops working the moment the hash is replaced — make sure the UI's confirmation is unambiguous.

---

## 2. Robustness — medium risk

### 2.1 Tool-call name cache leak

**File**: `src/lib/runs/event-hooks.ts:127–141`

```ts
const STATE_KEY = Symbol.for('@flow/tool-call-name-cache');
const toolCallNames = ... new Map();

function registerToolCallName(toolCallId, toolName) {
  toolCallNames.set(toolCallId, toolName);  // ← unbounded
}
function consumeToolCallName(toolCallId) {
  ...
  if (name) toolCallNames.delete(toolCallId);  // ← only cleared on match
}
```

Module-scope `Map<toolCallId, toolName>`. Entries for `tool_call` events that never get a matching `tool_result` (provider crash mid-tool, subagent abort, etc.) persist for the process lifetime. Slow leak.

**Fix options** (pick one):

**A. TTL eviction.** Store `{toolName, registeredAt}` and sweep on register:
```ts
const MAX_AGE_MS = 30 * 60 * 1000;  // 30 min — longer than any real turn
function sweep() {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [id, { registeredAt }] of toolCallNames) {
    if (registeredAt < cutoff) toolCallNames.delete(id);
  }
}
```
Call `sweep()` from `registerToolCallName` (cheap O(n) every N calls).

**B. LRU cap.** Use a fixed-size LRU (e.g. 10,000 entries). When full, evict oldest. Simpler to reason about; same worst-case behavior.

**C. Wait for upstream.** Proposal #2 in `docs/agentex-feedback.md` would put `toolName` directly on `tool_result` events, killing the cache entirely. If agentex accepts that, this fix is moot.

**Recommendation**: option A with `MAX_AGE_MS = 30min`. Bounded, minimal code, matches the longest realistic turn.

**Risk**: medium. Too-short TTL prunes entries before a slow tool result lands → artifact attribution lost for that ref. 30min is conservative.

---

### 2.2 Schedule-edit CLI completeness

**File**: `src/cli/commands/schedule.ts`

Today:
```bash
flow schedule edit <name>
  --prompt <text>
  --cron <expr>
  --every <seconds>
  --timezone <tz>
  --enabled <bool>
```

Missing: `--name`, `--description`, `--concurrency`, `--catch-up`, `--active-hours`, `--model`, `--effort`, `--timeout`, `--workspace`, `--target`, `--skills`.

The `update_schedule` orchestrator action accepts most of these. Just expose them as CLI flags.

**Fix**: extend the `edit` subcommand definition with the remaining options. Map each to the action's input shape.

**Risk**: low. Additive flags. Existing scripts don't break.

---

### 2.3 Webhook secret encrypted at rest

**File**: `src/lib/scheduler/webhook.ts`

Current design (V1): client sends `X-Webhook-Secret: <plaintext>` + `X-Signature`. Server hashes the sent secret, compares to stored hash, then HMACs body with the sent secret.

Issues with the current design:
- Live secret in every request (lands in nginx/Caddy access logs)
- Standard practice stores the secret server-side and only verifies the signature

**Fix** (V2 design):

1. Add a per-install encryption key (random 32 bytes) stored in `~/.flow/keys/webhook-encryption-key` with 0600 mode. Generated on first server start.

2. At schedule create:
   ```ts
   const secret = randomBase64Url(32);
   const ciphertext = encrypt(secret, encryptionKey);  // AES-256-GCM
   // Store ciphertext in DB; plaintext shown to user once.
   ```

3. At webhook verify:
   ```ts
   const secret = decrypt(schedule.webhookSecretCiphertext, encryptionKey);
   const computed = hmac(rawBody, secret);
   if (!timingSafeEq(computed, signatureHeader)) return 401;
   ```

4. Migration: add `webhookSecretCiphertext` column, mark `webhookSecretHash` as legacy. Existing schedules with `webhookSecretHash` keep working under the old verify path until the user rotates. After a deprecation window, drop the hash column.

**Risk**: high. Breaking change for the user's webhook integrations (they no longer send `X-Webhook-Secret` — only `X-Signature`). Requires a re-roll of every webhook. Want feature parity with old design (rotate, show-once) before cutting over.

**Effort**: ~1 day to implement + migrate + document.

---

### 2.4 Webhook replay protection

**File**: `src/app/api/triggers/[public_id]/route.ts`, `src/lib/scheduler/webhook.ts`

No `X-Timestamp` check, no nonce, no per-request rate limit. An intercepted webhook request can be replayed indefinitely.

**Fix**:

1. Require `X-Timestamp` header with ISO timestamp.
2. Reject if `|now - timestamp| > 5 minutes` (clock-skew tolerance).
3. Include timestamp in the signed body: `HMAC(secret, timestamp + body)`.

**Migration**: same breaking-change concern as 2.3 — every existing webhook integration needs to add the timestamp header.

**Effort**: ~2 hours if landed with 2.3.

**Recommendation**: bundle with 2.3 in a single "Webhooks V2" milestone. Both are breaking changes; doing them separately doubles the integration churn.

---

## 3. Upstream — `@agentex/agent` proposals

Five capabilities Flow built above the SDK because the existing surface didn't cover them. Documented in full at `docs/agentex-feedback.md`.

| Proposal | Effort upstream | Flow code that goes away |
|---|---|---|
| **#1** — Per-turn `timeout` on `AgentSession.send()` | Small | `src/lib/runs/dispatch.ts:runWithTimeout` + `RunTimeoutError` (~60 LOC) |
| **#2** — `tool_result.toolName` | Small | `src/lib/runs/event-hooks.ts` cache + register/consume (~30 LOC) |
| **#3** — Subagent attribution (`agentId` on stream events, `usageByAgent` on `TurnResult`) | Medium | Subagent comment + dispatch.ts blind-sum |
| **#4** — Normalized cost (`pricingFor` / `costForUsage` exports) | Medium | `src/lib/pricing/models.{ts,json,test.ts}` (~150 LOC) |
| **#5** — `drain()` lifecycle + configurable `graceSec` | Small | Budget-driven pause work that doesn't exist yet |

**Priority** if forced to pick one: **proposal #1**. Current state — `timeoutSec` exists in `ProviderConfig` but is silently ignored by `createSession`/`send()` paths — is the worst-of-all-worlds.

**Action**: file each as a separate GitHub issue against the agentex repo, with the proposal section pasted verbatim. The doc is structured for that.

---

## 4. Spec deviations (deferred, not bugs)

These were called out in the original async-agents-v1 spec and explicitly deferred. Captured here so they don't sneak back into a V1 review.

### 4.1 Trigger badge in 4-col execution view

`docs/async-agents-v1.md §8.4` calls for a header strip on the execution view when the chat has `createdByRunId` + the run has `scheduleId`:

> "Triggered by `morning-triage` at 9:00 · next run 9:00 tomorrow"

Built `/runs` page as a substitute. The integration belongs in the in-flight `execution-view-spec.md` refactor; landing it earlier means merge conflicts.

**Where to wire it when the refactor stabilizes**: `src/components/executions/execution-view.tsx` header section. The data is already on `getChatSessionWithExecution(id)` via the join to `runs` (would need a small query addition for the schedule lookup).

### 4.2 Bundled-group unread chips

Same — collapses multiple unread runs of one schedule in the executions list:

> "morning-triage · 3 unread"

Needs the executions list to group rows by `scheduleId` and roll up unread counts. Same refactor.

---

## 5. Things explicitly kept out of scope

For posterity, the things that have been considered and intentionally NOT added to the follow-up list:

- **Heartbeat as a primitive** — V2 per `async-agents-v1.md §10`. Users wanting supervisor-pulse can simulate with a 30-min schedule.
- **Concurrency lanes** — V2. The global rate-lease is enough until real contention shows up.
- **Multi-state action protocol (`request_input`, etc.)** — V2 with autonomous loops.
- **Goals entity** — V2 with self-directed autonomy.
- **First native connector (Gmail / Linear)** — V2. Webhook intake is the V1 substrate; the polish UX comes later.
- **"Continuous chat" mode for recurring schedules** — V1 derives behavior from `kind` + `targetKind`; a `continuous_chat: boolean` column is a non-breaking V2 addition if a use case emerges.

---

## 6. Recommended landing order

If picking these up in batches:

**Batch A — UX polish (1 day total)**
- 1.1 `recordSkipped` duration cosmetic
- 1.2 Unsaved-changes warning
- 1.3 Reset failures chip
- 1.4 Run pagination link
- 1.5 `aria-pressed`
- 1.6 Webhook rotate-secret action

Low risk, isolated, each ships independently. Good batch for a quick polish PR.

**Batch B — CLI completeness (½ day)**
- 2.2 Schedule-edit CLI flags

Additive, no breaking changes. Bundle with anything from Batch A if convenient.

**Batch C — Cache hygiene (½ day)**
- 2.1 Tool-call cache TTL

Drop-in; the only risk is choosing the TTL value. 30min is recommended.

**Batch D — Webhooks V2 (1–2 days, breaking)**
- 2.3 Encrypted-at-rest secrets
- 2.4 Replay protection

Single milestone. Communicate the breaking change to anyone with live webhook integrations. Provide a migration guide.

**Batch E — Upstream (no Flow code)**
- Open agentex issues for proposals #1–#5
- When any land, delete the corresponding Flow scaffolding

---

## 7. References

- Implementation: `src/lib/{runs,scheduler,pricing,executor}/`, `src/app/{api,schedules,runs}/`
- V1 spec: `docs/async-agents-v1.md`
- Build checklist: `docs/async-agents-v1-tasks.md`
- Executions lift: `docs/executions-spec.md`
- Upstream proposals: `docs/agentex-feedback.md`
- Tests: `src/lib/runs/*.test.ts`, `src/lib/scheduler/*.test.ts`, `src/app/api/sessions/[id]/messages/route.test.ts`

---

## One-line version

> **Six quick UX polish items, four medium robustness items (one breaking webhooks change), and five upstream agentex proposals — all triaged, none blocking V1.**
