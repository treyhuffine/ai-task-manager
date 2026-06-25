# Connectors — Email Transport & Notifier (plan)

**Status:** Planned (not built) · **Date:** 2026-06-20 (Notifier rev 2026-06-23) · **Extends:** `connectors-module-spec.md`

> **Notifier rev 2026-06-23** — folded the Codex architecture review (`notifications-architecture-thoughts-codex.md`): durable **delivery/outbox** table with `(dedupeKey, channelId)` idempotency (§2.16), **structured channel `config`** + an **adapter registry**/allowlist (§2.2/§2.17), **narrow** trusted dispatch (§2.3), and **emission from durable state** not the in-memory bus (§2.4). Validated the rest (JSON arrays, layering, digest/lifecycle split, web-push, email deferral).
>
> **Reliability tightening (2nd review, same day)** — right-sized: **fixed** the recovery gap (process all `pending`/`failed` for the event's targets, self-heals on re-fire — §2.16), **dropped `sending`** (no lease in inline v1 — §2.16/§2.14), keyed the adapter registry by **`(kind, providerId)`** (§2.17), and added the **`APP_PUBLIC_URL` deep-link policy** for external channels (§2.17). **Defined** (not built): web-push `sent`-if-≥1 (§2.15/§2.16), `connector.approval_required` best-effort (in-memory by design — §2.4). **Deferred** (over-engineering for single-user v1): per-subscription rows, retry worker+lease, DB approvals, history retention, presence-aware noise suppression (§2.11). Generic IMAP/SMTP estimate de-optimismed (§1.7).

Two related-but-distinct extensions, both deferred from the current engine but specified here so
the design is on record. They sit at **different layers** and that separation is the whole point:

1. **Email (IMAP/SMTP) transport port** — an *engine* extension (a new transport alongside HTTP).
2. **Notifier** — an *app* layer that sits **on top of** connectors (push, not pull).

---

## Part 1 — Email (IMAP/SMTP) transport port

### 1.1 Why it doesn't fit the engine today

The engine is **HTTP-only**: every action talks through `ctx.http` (`AuthedHttp`), which injects
auth and **confines the credential** — the action never sees the secret (the load-bearing rule of
the trust spine, §8). IMAP and SMTP are **socket protocols**, not HTTP: an email action must open a
TCP connection and speak the protocol, which means it needs the **raw** credential (address + app
password, or an OAuth2 XOAUTH2 token). Handing an action the raw credential would punch a hole in
confinement. So generic IMAP/SMTP is a **transport gap**, not "just another provider." (Gmail and
Outlook already cover mainstream email via their REST APIs, which fit the HTTP model.)

### 1.2 The solution: a transport port (the IMAP/SMTP analog of `ctx.http`)

Mirror exactly how HTTP works. A provider declares a **non-HTTP transport**; at call time the
runtime opens the sealed credential (as it already does for HTTP), constructs an **authed transport
client**, and injects it into `ActionContext` — e.g. `ctx.mail` — alongside (or instead of)
`ctx.http`. The client holds the credential **internally** and exposes safe verbs; the action calls
verbs, never touches the secret. **Confinement is preserved** — the action sees a port, not a key.

```ts
interface MailTransport {
  search(criteria: MailSearch): Promise<MailSummary[]>;   // IMAP SEARCH
  fetch(uid: string): Promise<MailMessage>;               // fetch + parse MIME → text
  listMailboxes(): Promise<string[]>;
  send(message: OutgoingMail): Promise<{ messageId: string }>;  // SMTP
}
// ActionContext gains an optional `mail?: MailTransport` (present iff the provider's transport is imap_smtp).
```

- Lives in a **new entrypoint** `@connectors/engine/email` with `imapflow` (IMAP) + `nodemailer`
  (SMTP) as **optional peer deps** — same discipline as the MCP SDK (`@connectors/engine/mcp`), so
  the core stays zod-only and these deps are pulled only by hosts that use email.
- The runtime grows a transport seam: a provider's strategy/transport kind selects HTTP vs mail;
  the pipeline (resolve → scope → gate → acquire creds → execute → redact → audit) is **unchanged**.

### 1.3 Auth

- **Basic** (address + app password) — the common case (Gmail/iCloud/Fastmail app passwords).
  Reuses the existing `basic` credential shape; connected via `connectDirect`.
- **OAuth2 XOAUTH2** — Gmail/Outlook IMAP over an OAuth token: reuse the existing `oauth2` strategy's
  token; the transport formats the XOAUTH2 SASL string. Connected via `beginAuth` (existing flow).

### 1.4 Server presets

Auto-detect IMAP/SMTP host+port from the email domain (`gmail.com` → `imap.gmail.com:993` /
`smtp.gmail.com:587`, iCloud, Fastmail, …), with manual override fields for custom servers. (Same
shape as the competitor's `resolve_servers`; org-disabled IMAP/app-passwords is a known caveat.)

### 1.5 The `mail` provider/toolkit

`search_messages`, `get_message` (fetch + MIME→text), `list_mailboxes`, `send_email`,
`download_attachment` (approval-gated). Send is single-shot (one SMTP connection per send); reads
flow through the same approval gate as any action.

### 1.6 What stays identical

Connection model, `SecretBox` sealing, `Redactor` confinement, the approval gate, audit
(`onActionRun`), and the connect paths (`connectDirect` for basic, `beginAuth` for XOAUTH2). **Only
the transport changes; the spine does not.**

### 1.7 Phasing & non-goals

- **Phase 1 (engine, additive — NOT a notifier-v1 dependency):** the transport seam +
  `ImapSmtpTransport` adapter + the `mail` provider/toolkit + tests against a **fake transport** (no
  real sockets, mirroring the `fakeHttp` pattern). The smoke harness extends to mail actions via the
  fake transport. (Earlier "~half a day" was optimistic — generic IMAP/SMTP carries endpoint
  discovery/overrides, TLS/STARTTLS policy, XOAUTH2, MIME parsing, attachments, provider folder/search
  quirks, and connection lifecycle. Treat it as a real engine extension *after* the notifier ships;
  use the existing REST email providers — Resend/Mailgun/Gmail/Outlook — for sending in the meantime.)
- **Non-goals:** push/IDLE (real-time inbox), rich MIME rendering, threading/conversation models,
  server-side search beyond IMAP SEARCH. Deferred behind the same seam.

---

## Part 2 — Notifier (app layer)

### 2.1 Principle: pull vs push

Connectors are the delivery **verbs** the agent/user *pulls* (`telegram.send_message`,
`slack.post_message`, `whatsapp.send_message`, the future `mail.send_email`), gated and audited.
The **Notifier** is the app's **push** layer: it decides *when* and *where* to fire those verbs in
response to app events. It **lives in the app** (`src/lib/notifications`), **not** the engine, and
depends on connectors **one-way** (notifications → connectors, never back). The engine stays
generic and spin-out-able; "notification channels / quiet hours" are app opinion, not engine
contract. (And some channels — web/native push — aren't connectors at all, which is itself proof
the Notifier must be broader than, and sit above, connectors.)

### 2.2 Model

Two distinct shapes — keep them separate (don't pre-bake rendered text into the event):

```ts
// 1. The EVENT — presentation-neutral domain data the emission point passes to notify().
interface NotificationEvent {
  type: NotificationEventType;  // from the EVENT_CATALOG (single source of truth, 2.4/2.13)
  userId: string;               // app convention: NOT NULL, default 'local' (2.13) — NOT 'ownerId'
  dedupeKey: string;            // stable per occurrence ("execution.finished:<runId>") — idempotency (2.16)
  title: string;                // headline ("Fix auth bug")
  body: string;                 // human detail ("Added token refresh, tests pass") — NOT 'summary'/'message'
  url: string;                  // deep link (/executions/<id>, /deck, the approval)
  // optional structured extras (status, executionId, …) a richer channel can format from
}

// 2. The RENDERED notification — what an adapter actually sends, formatted per channel.
interface RenderedNotification { title: string; body: string; url: string; }

type ChannelKind = 'connector' | 'web_push' | 'in_app';   // in_app deferred (2.10)
interface NotificationChannel {
  id: string;
  userId: string;               // matches executions/schedules: NOT NULL, default 'local' (2.13)
  kind: ChannelKind;
  providerId?: string;          // kind 'connector' — WHICH connector (telegram/slack/…). The actionId
                                // (telegram.send_message) lives in the adapter registry, NOT this row (2.17).
  connectionId?: string;        // kind 'connector' — the authed account to deliver through
  config: Record<string, unknown>; // STRUCTURED target, per kind — Telegram {chatId}, Slack {channel,threadTs?},
                                // email {to[],cc?}, web_push {} (fans to subscriptions). NOT a `destination` string.
  events: string[];             // JSON ARRAY column (not a join table — 2.13). The per-channel toggle list.
  enabled: boolean;
}
```

- **Adapter registry** (app code) — one adapter per `kind`; each does `validateConfig` / `render` /
  `deliver`. Connector adapters are an **allowlist** of delivery actions, never free-form connector
  tools (2.17).
- **`notify(event)`** dispatcher: resolve the user's eligible channels (matrix or binding, 2.4) →
  **create durable delivery rows** (idempotent on `(dedupeKey, channelId)`) → process them
  (inline in v1) → `render` → adapter `deliver` → record status (2.15/2.16). Not a fire-and-forget
  side effect: the attempt is persisted, so a crash or provider timeout is recoverable. (Quiet hours
  / rate-limit / a background retry worker → later.)

### 2.3 Trusted dispatch (no approval prompt) — but NARROW

App-driven notifications are **not** agent actions, so they shouldn't prompt the user to approve the
app's own send. The ConnectorChannel adapter calls:

```ts
runtime.runAction('telegram.send_message', input, {
  ownerId: userId, connectionId: channel.connectionId, caller: { type: 'app', id: 'notifier' },
});
```

The host `appApprovalPolicy` auto-allows this **narrowly**, NOT "all app callers bypass":
- only `caller.type === 'app' && caller.id === 'notifier'`,
- only for an **allowlisted set of delivery actions** (the adapter registry's actions, §2.17 — e.g.
  `telegram.send_message`), never arbitrary connector tools,
- and (defense in depth) `connectionId` should match an enabled notification channel.
- All notifier connector calls still flow through `onActionRun` audit.

Normal agent/MCP connector calls remain fully gated — that's a different caller.

### 2.4 The event catalog + where each fires

There is **no subscribe-bus**: `notify(event)` is **called directly** at emission points that already
exist in the app (the same sites that drive the realtime UI). It does **not** consume the engine's
`onActionRun` hook (that's connector *audit*, a different stream).

The event types are a **single `EVENT_CATALOG`** — the source of truth the settings UI maps over,
the `NotificationEventType` union derives from, `render()` keys off, and emission sites import. Adding
an event = one entry.

```ts
type NotificationEventType =
  | 'execution.needs_input'
  | 'execution.finished'
  | 'connector.approval_required'
  | 'schedule.run_completed'
  | 'deck.surfaced';

const EVENT_CATALOG = [
  { type: 'execution.needs_input',       label: 'Agent needs input',      routing: 'matrix',  defaultOn: true  },
  { type: 'execution.finished',          label: 'Execution finished',     routing: 'matrix',  defaultOn: true  },
  { type: 'connector.approval_required', label: 'Approval needed',        routing: 'matrix',  defaultOn: true  },
  { type: 'deck.surfaced',               label: 'Deck surfaced something', routing: 'matrix', defaultOn: true  }, // inert until the deck point is wired
  { type: 'schedule.run_completed',      label: 'Scheduled run result',   routing: 'binding', defaultOn: false }, // routed per-schedule, see below
] as const;
```

**Per-event wiring** (emission point → title / body → deep link → dedupeKey). **Emit from DURABLE
server-side state transitions, never from UI-only/in-memory state** — so a restart can't lose it and
transient UI churn can't fire it:

| type | fires at (durable transition) | title | body | deepLink | dedupeKey |
|---|---|---|---|---|---|
| `execution.needs_input` | after the `permission_request`/`question_request` **chat_event is persisted** (not the in-memory `pending_input` signal) | execution title | the agent's question/prompt | `/executions/<id>` | `…:<requestEventId>` |
| `execution.finished` | the **shared run terminal path** (covers manual AND scheduled executions) | `✅/❌ <title>` | derived `result.summary` (fallback: status) | `/executions/<id>` | `…:<runId>` |
| `connector.approval_required` | connectors `approval.ts` register-pending (`'ask'`) | `Approve <action>?` | action + target account | the pending-approvals link | `…:<approvalId>` |
| `schedule.run_completed` | `runs/dispatch.ts` terminal, **orchestrator-target runs only** (execution-target → `execution.finished`, §2.8) | schedule name | run summary (for a digest, the produced content, §2.9) | `/schedules/<id>` | `…:<runId>` |
| `deck.surfaced` | when proactive-deck logic writes a **durable deck/change record** (**pending** that work, §2.11) | `New on your deck` | what surfaced | `/deck` | `…:<deckChangeId>` |

The `dedupeKey` makes each emission point safe to fire more than once (reconcile replays, retries,
restarts) — `notify()` dedupes on `(dedupeKey, channelId)` (§2.16).

**Durability caveat — `connector.approval_required` is best-effort/transient.** Connector approval
pending state is **in-memory** by design (`approval.ts`, single-process). So this event can't be
emitted from a durable transition like the others — and it doesn't need to be: if the process dies,
the pending approval vanishes too (the agent re-requests on retry), so a lost notification is
*consistent* with the lost state. Treat it as best-effort. Making approvals DB-backed is a separate
engine/host concern, not a notifier v1 task.

**Two routing modes** (this is the "keep lifecycle vs digest separate" decision made concrete):
- **`matrix`** — routed by the per-channel `events[]` toggles (§2.7). The ambient lifecycle events.
- **`binding`** — `schedule.run_completed` is routed by the **schedule's** `deliverResultTo[]`
  (§2.9), **not** the channel matrix. You opt a *specific* scheduled job into notifying; you don't
  broadcast every orchestrator run to all channels. So it does **not** appear in the channel
  event-toggle UI — it appears as "deliver result to […]" on the schedule/digest.

### 2.5 Connection vs Channel (the bit that blurs)

A Telegram **connection** = "I have an authed bot" — reusable; the agent can message any chat with
it. A Telegram **channel** = "…and notifications go to `chat_id` X for these events." The channel
binding + prefs are **app state** (app DB), not engine state. The engine stores connections; it
never hears the word "channel." Destination discovery for Telegram/WhatsApp: the user messages the
bot once → `get_updates` reveals the `chat_id` → pin it as the channel destination.

### 2.6 Separate UX

The **Connect** surface ("link your accounts") is distinct from **Notifications settings** ("how
should the app reach you" — pick channel, set destination, toggle events, quiet hours).

### 2.7 The three axes (design lock, 2026-06-22)

The model resolves into **three independent axes**:

1. **Trigger** — what fires a notification. Two classes:
   - **(A) System/lifecycle events** (reactive): `execution.needs_input`, `execution.finished`,
     `connector.approval_required`, `schedule.run_completed` (orchestrator-target runs only — see
     2.8), `deck.surfaced`.
   - **(B) Custom digests** (proactive, user-defined): "summarize my unread emails every morning" —
     a *schedule + prompt + delivery binding* whose **content is the point** (see 2.9).
2. **Channel** — where it goes: `connector` (Telegram first), `web_push`, `in_app` (deferred).
3. **Routing** — which triggers → which channels: the **events × channels matrix**. Each channel
   subscribes to a set of event types (per-channel toggles); `notify(event)` **fans out** to every
   enabled channel subscribed to it. One event can hit Telegram + web push at once.

**Enrichment, every event:** a `deepLink` (e.g. `/executions/<id>`, `/deck`, the approval) rendered
per channel (Telegram markdown link; web push `data.url` → `notificationclick`; in-app clickable),
and a short **summary** — `execution.finished` carries the derived `result.summary` + final status
("✅ Fix auth bug — Added token refresh, tests pass"), falling back to title+status.

### 2.8 schedule.run_completed vs execution.finished (no double-notify)

A fired schedule → a `run` (the `runs` table) → either an **execution** (harness) or an
**orchestrator turn**. Rule: **`execution.finished` covers ALL executions** (scheduled or ad-hoc;
payload tags the triggering schedule when applicable); **`schedule.run_completed` fires ONLY for
runs that did not spawn an execution** (orchestrator turns). Every completed unit notifies exactly
once. Emission points: execution-completion site, `runs/dispatch.ts` run-completion.

### 2.9 Custom digests (class B)

A digest = a `schedule` (cron) + a prompt + a `deliver_result_to: channelId[]` binding. It runs as a
scheduled orchestrator turn that uses connectors (Gmail, Calendar, …) + the agent to produce a
summary; the Notifier delivers that summary as the notification body. This is `schedule.run_completed`
with **intentional content** — same plumbing, different intent + authoring ("Scheduled digests"
builder: prompt + cadence + channels). It's where connectors + schedules + notifier compose.

### 2.10 In-app = notification center (deferred), not the power rail

The power rail already surfaces executions live, so the in-app channel must NOT re-render execution
completions. Its role (deferred past v1): a durable **notification center / bell** — the
cross-cutting log of everything (approvals, digests, deck items, history). The rail stays the live
execution affordance; the bell is the unified inbox.

### 2.11 v1 scope (locked)

**In:** lifecycle events (needs-input, finished, approval, schedule.run_completed) + **deck.surfaced**
+ **custom scheduled digests** (2.9); channels **Telegram (ConnectorChannel) + web push**; the
events×channels **matrix** with per-channel toggles; **deep links** + **summaries**; a durable
**delivery/outbox table** with `(dedupeKey, channelId)` idempotency, processed inline (2.16);
**structured channel `config`** + an **adapter registry** with an allowlisted delivery-action set
(2.17); **narrow** trusted dispatch (2.3); a **Notifications settings** surface (separate from Connect).

**Web push infra:** `web-push` dep + a VAPID keypair (generated once, stored in `.config`, `0600`,
public key to the client); a service worker in `public/` (`push` → showNotification,
`notificationclick` → deep link); a `web_push_subscriptions` table + store route + client subscribe;
a `WebPushChannel` adapter that fans out and prunes expired (410/404) subscriptions.

**Deferred (with their seam noted):**
- background **retry worker** + `sending`/lease columns (v1 sends inline + self-heals on re-fire, §2.16);
- per-subscription web-push delivery rows (`targetKey`) — v1 is `sent`-if-≥1 (§2.16, finding #4);
- DB-backed connector approvals — v1 `connector.approval_required` is best-effort (§2.4, finding #5);
- **delivery history retention** — the cascade-on-channel-delete is fine while there's no history
  consumer; when the in-app center (§2.10) is built it picks its model (nullable `channelId` +
  `set null` + a `channelSnapshot`, or a separate immutable log) (finding #7);
- **presence-aware noise suppression** ("don't notify `execution.finished` for a session you're
  actively viewing") — needs presence tracking; v1 noise control is the per-channel toggle (finding #8);
- in-app notification center (2.10); quiet hours / rate-limit prefs; WhatsApp/Slack channels (the
  adapter registry is generic — config, not code).

**Deck caveat:** `deck.surfaced` is designed in v1, but its emission point is the proactive-deck
cron/first-look (in-flight); wire it when that lands, or interim "deck surfaced something new" diff.

### 2.12 Build phases

1. **Core + Telegram** — `notification_channels` + `notification_deliveries` tables + queries; the
   `EVENT_CATALOG`; `notify()` (route → create delivery rows idempotently → process inline → status);
   the adapter registry + `ConnectorChannel` (Telegram); narrow the approval allowlist to the notifier
   caller + delivery actions; wire emission points (needs-input, finished, approval,
   schedule.run_completed) from durable state; tests.
2. **Web push** — the infra above.
3. **Custom digests** — the `deliver_result_to` binding on schedules + the "Scheduled digests"
   authoring UX + result-delivery on `schedule.run_completed`.
4. **Deck** — `deck.surfaced` emission + event (when the proactive-deck point exists).
5. **Notifications settings UI** — manage channels + the matrix; (folds in across phases).

### 2.13 Data model & routing (decisions)

**`userId`, not `ownerId`, NOT NULL, default `'local'`.** The app already standardizes this on
`agents`, `executions`, `chat_sessions`, `schedules` (`userId: text().notNull().default('local')`,
no FK, no `users` table). Notifier tables MATCH that — do not invent `ownerId`/`ownerUserId` or a
nullable column. The `'local'` sentinel + missing FK is an **app-wide** seam, not a notifier choice;
the honest fix (a real `users` table → real ids → FK, possibly a rename) is **one holistic migration
when auth/multi-user lands**, across all five tables together. The engine keeps its own `ownerId`
(its spin-out contract); at delivery the notifier maps `userId → runAction`'s `ownerId` (both
`'local'` today). The `NotificationEvent.userId` carries the same value.

**`events[]` is a JSON array column, not a join table.** Tiny dataset (one user, ~5 channels, ~6
fixed event types), event types are a hardcoded enum (nothing to FK), and it matches the app's
existing `Attachment[]`-as-JSON-column idiom. A `channel_id × event_type` join table is
over-normalization here. (If per-event metadata — e.g. per-event quiet hours — is ever needed,
promote then; cheap migration.)

**Routing flow (start from the event, filter the few channels — in JS):**
`notify(event)` → load `WHERE userId = ? AND enabled = true` (indexed) → keep channels whose
`events[]` includes `event.type` → `render` → fan out. O(channels)≈5; the iteration is the normal
pub/sub shape, not a smell.

**Turn-off semantics.** Remove a channel = delete the row (events live on the row, so they vanish;
no dangling refs; `notify()` simply finds no match). Toggle an event off on one channel = drop it
from that channel's array; off *completely* = drop it everywhere → zero subscribers → no-op
("global off" is emergent, no special flag). A true mute-and-restore switch would be a small
per-user `mutedEvents` set checked first in `notify()` — deferred.

**Two cascades.** (1) Deleting a *connection* (Connect surface) must disable/delete the
`notification_channels` pointing at it (`deleteChannelsForConnection`, app-level cleanup in the
disconnect path), so channels never aim at a dead account. (2) Deleting a *channel* must scrub its id
from every `schedules.deliverResultTo[]` (`removeChannelFromScheduleBindings`), so no digest points at
a deleted channel. (`notification_deliveries` rows FK-cascade on channel delete automatically.)

**One catalog as source of truth.** The event types live in a single `EVENT_CATALOG` — **the literal
is in §2.4** (type union + per-event wiring table + routing mode). The settings UI MAPS over it
(doesn't hardcode the list), the `NotificationEventType` union derives from it, the renderer keys off
`type`, and emission sites use its constants — so adding an event is one entry, not four edits.

**Lifecycle toggles vs digest delivery — keep them separate.** Lifecycle routing lives as
`channel.events[]` (channel owns its events); digest routing lives as `schedule.deliverResultTo[]`
(schedule owns its channels). Different direction, same spirit; unifying them into one `subscriptions`
table doesn't simplify (the UX splits them anyway) — that'd be over-engineering.

### 2.14 Schema & migrations

Three new tables + one column, all matching the app's existing conventions (`id text primaryKey`
filled with `uuidv7()` in `queries.ts`; `userId text NOT NULL DEFAULT 'local'`; `text(datetime('now'))`
timestamps; `text({mode:'json'})` arrays; `integer({mode:'boolean'})`). Drizzle, in `schema.ts`:

```ts
export const notificationChannels = sqliteTable('notification_channels', {
  id: text().primaryKey(),
  userId: text().notNull().default('local'),
  kind: text({ enum: ['connector', 'web_push', 'in_app'] }).notNull(),
  providerId: text(),              // kind 'connector' — telegram/slack/… (actionId is in the registry, §2.17)
  connectionId: text(),            // engine connection id (kind 'connector'). NO Drizzle FK — the
                                   // connection lives in the engine's store (.config/connectors),
                                   // not this DB; cascade-on-disconnect is app-level (§2.13).
  config: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}), // structured
                                   // target per kind: Telegram {chatId}, Slack {channel,…}, web_push {} (§2.2)
  events: text({ mode: 'json' }).$type<string[]>().notNull().default([]),  // matrix toggle list (§2.4)
  enabled: integer({ mode: 'boolean' }).notNull().default(true),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_notification_channels_user_enabled').on(t.userId, t.enabled),
  index('idx_notification_channels_connection').on(t.connectionId),  // for the disconnect cascade
]);

export const webPushSubscriptions = sqliteTable('web_push_subscriptions', {
  id: text().primaryKey(),
  userId: text().notNull().default('local'),
  endpoint: text().notNull().unique(),   // one row per browser endpoint
  p256dh: text().notNull(),
  auth: text().notNull(),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
}, (t) => [index('idx_web_push_subscriptions_user').on(t.userId)]);

// Durable send attempts (the outbox, §2.16). Distinct from channels (config) + subscriptions (endpoints).
export const notificationDeliveries = sqliteTable('notification_deliveries', {
  id: text().primaryKey(),
  userId: text().notNull().default('local'),
  eventType: text().notNull(),
  dedupeKey: text().notNull(),           // from the event; idempotency across re-fires (§2.4)
  channelId: text().notNull().references(() => notificationChannels.id, { onDelete: 'cascade' }),
  // No 'sending' in v1 (inline single-process → no lease needed; add it + lease cols with the worker, §2.16).
  // One row per channel: web_push fans to all subscriptions in deliver() (sent if ≥1 reached); a per-
  // subscription `targetKey` + a (dedupeKey,channelId,targetKey) index is the deferred seam (§2.16, finding #4).
  status: text({ enum: ['pending', 'sent', 'failed', 'skipped'] }).notNull().default('pending'),
  attempts: integer().notNull().default(0),
  event: text({ mode: 'json' }).$type<NotificationEvent>().notNull(),     // for re-render / retry / history
  rendered: text({ mode: 'json' }).$type<RenderedNotification>(),
  providerMessageId: text(),             // e.g. Telegram message_id, for later correlation
  lastError: text(),
  nextAttemptAt: text(),                 // set by a FUTURE retry worker (not v1)
  sentAt: text(),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
}, (t) => [
  uniqueIndex('uniq_notification_deliveries_dedupe_channel').on(t.dedupeKey, t.channelId), // idempotency
  index('idx_notification_deliveries_user_status').on(t.userId, t.status),
  index('idx_notification_deliveries_next_attempt').on(t.status, t.nextAttemptAt),         // future worker
]);

// + one column on the existing `schedules` table (digest binding, §2.9):
//   deliverResultTo: text({ mode: 'json' }).$type<string[]>().notNull().default([]),  // channel ids
```

The tables map to three distinct concerns: `notification_channels` = user preference/config;
`web_push_subscriptions` = browser endpoints; `notification_deliveries` = durable send attempts.

Types derive from the schema (`src/db/types.ts`); all access via `queries.ts` helpers (no raw SQL in
routes): channels CRUD + `listNotificationChannels(userId)`; `deleteChannelsForConnection(connectionId)`
(disconnect cascade) and `removeChannelFromScheduleBindings(channelId)` (channel-delete cascade, §2.13);
delivery helpers `upsertDelivery` (insert-or-ignore on `(dedupeKey, channelId)`), `claimPendingDeliveries`,
`markDelivery(sent|failed|skipped, …)`; web-push sub CRUD. Migration workflow per repo norms: edit
`schema.ts` → `pnpm db:generate` → apply via `pnpm db:push` / dev-server auto-migrate (never hand-edit
the journal or apply via `sqlite3`).

### 2.15 Data flow (end to end)

**Lifecycle event (matrix), through the outbox:**
1. An emission point (§2.4) builds `NotificationEvent { type, userId, dedupeKey, title, body, url }` → `notify(event)`.
2. **Route:** load `listNotificationChannels(userId)` `WHERE enabled` → keep those whose `events[]` includes `event.type`.
3. **Persist intent:** `upsertDelivery` one `notification_deliveries` row per target channel — insert-or-ignore on `(dedupeKey, channelId)`, so a re-fire creates nothing new (idempotency, §2.16).
4. **Process** (inline in v1): select **all `pending`/`failed`** rows for this event's targets (not just rows inserted this call — self-heals a crash-stranded row on re-fire, §2.16) → `resolveAdapter(channel)` → `render(event, channel)` → `deliver(channel, rendered)`.
5. **Adapters:** *ConnectorChannel* → `runtime.runAction(<allowlisted action>, input, { caller: {type:'app',id:'notifier'} })` (§2.3), with `render` prefixing `APP_PUBLIC_URL` for the phone-reachable link (§2.17); *WebPushChannel* → `web-push.sendNotification` to each of the user's subscriptions, pruning 410/404.
6. **Record:** mark the delivery `sent` (+`providerMessageId`) / `failed` (+`lastError`, `attempts++`). Web push = **`sent` if ≥1 subscription accepted**, else `failed` (per-subscription rows deferred, §2.16). Errors never throw back into the emitting path; a `failed` row is recoverable on the next re-fire.

**Digest (binding):** scheduler fires a digest schedule → orchestrator run (connectors + agent) → `runs/dispatch.ts` terminal of an orchestrator-target run → `notify({ type:'schedule.run_completed', body: summary, dedupeKey:'…:<runId>' })`, routed to the schedule's `deliverResultTo[]` (NOT the matrix). Same outbox → render → adapter path.

**Setup / config:**
- *Telegram channel:* pick connection → discover `chat_id` (message bot → `telegram.get_updates`, or paste) → choose events → insert a `connector` channel row (`providerId:'telegram'`, `config:{chatId}`).
- *Web push:* client requests permission → subscribes via the service worker (VAPID public key) → POST subscription → insert a `web_push_subscriptions` row + ensure a `web_push` channel with chosen events.
- *Digest:* create a `schedules` row (cron + prompt, `targetKind:'orchestrator'`) + set `deliverResultTo`.
- *Disconnect a connection:* the Connect disconnect path calls `deleteChannelsForConnection(connectionId)` (§2.13).
- *Delete a channel:* `removeChannelFromScheduleBindings(channelId)` scrubs it from every `schedules.deliverResultTo[]` (§2.13).

### 2.16 Delivery durability & idempotency (the outbox)

`notify()` is **not** a fire-and-forget side effect — it persists a `notification_deliveries` row per
target before sending. Why this small table earns its place even local-first:
- **Idempotency:** the unique `(dedupeKey, channelId)` lets emission points fire more than once safely
  — and ours genuinely can (reconcile replays JSONL, a run terminal can be reached twice, the process
  can restart between event and send). Without it, a replay double-pings your phone.
- **Recoverability:** a provider timeout or a crash leaves a `pending`/`failed` row, not a silently
  lost notification.
- **History substrate:** the deferred in-app notification center (§2.10) reads straight from this table.

**Processing (v1, inline, single-process):** after `upsertDelivery` (insert-or-ignore), `notify()`
**selects and processes ALL `status IN ('pending','failed')` rows for this event's targets** — NOT
just rows it inserted this call. This is the recovery fix: a row stranded `pending` by a crash is
retried on the next re-fire of that event, so inline processing self-heals without a background
worker. (The `nextAttemptAt`/`failed` columns are the seam a future worker uses to retry *without* a
re-fire — deferred.)

**No `sending` state in v1.** Inline single-process delivery goes straight `pending → sent | failed`.
A `sending` state only earns its keep with concurrent workers claiming rows — and then it needs real
lease columns (`lockedAt`/`claimId`/stale-reset) or a crash strands rows in `sending` forever. So
`sending` + lease land *with* the worker, not before (avoids a stuck-row footgun for zero v1 benefit).

This mirrors the connectors engine's own bar (retry-safe, audited, indeterminate-aware) — a pure
fire-and-forget notifier would be the one un-durable link. Right-sized: a table + inline self-healing
send, no daemon, no lease.

### 2.17 Adapter registry & the delivery allowlist

One **registry** in app code, **keyed by `(kind, providerId)`** — NOT by `kind` alone, since
`kind: 'connector'` spans Telegram / Slack / WhatsApp (they need different actions + input shapes).
`web_push`/`in_app` key on `kind` (no providerId).

```ts
interface NotificationChannelAdapter {
  kind: ChannelKind;
  providerId?: string;                                       // connector adapters only
  validateConfig(channel: NotificationChannel): void;        // e.g. Telegram requires config.chatId
  render(event: NotificationEvent, channel: NotificationChannel): RenderedNotification;
  deliver(channel: NotificationChannel, rendered: RenderedNotification): Promise<DeliveryResult>;
}
// resolveAdapter(channel) → registry[channel.kind === 'connector' ? `connector:${channel.providerId}` : channel.kind]
```

Connector-backed adapters are an **allowlist**, declared explicitly — the notifier NEVER infers
arbitrary connector tools (delivery is product infrastructure, not free-form agent behavior):

```ts
const TELEGRAM_NOTIFICATION_ADAPTER = {
  kind: 'connector', providerId: 'telegram', actionId: 'telegram.send_message',
  input: (channel, r) => ({ chatId: channel.config.chatId, text: `${r.title}\n\n${r.body}\n${r.url}` }),
};
```

The `actionId` lives here (the registry), not on the channel row — single source of truth, and it IS
the allowlist the narrow approval bypass (§2.3) checks against.

**Deep-link base URL (`render`).** `NotificationEvent.url` is a relative app path (`/executions/<id>`).
`render()` resolves it for the channel: `web_push`/`in_app` keep it relative (same-origin); **external
channels (Telegram, email) prefix `APP_PUBLIC_URL`** — an externally reachable base (env, or derived
from the beamd remote tunnel, see [[project_preview_system]]). When no public URL is configured
(local-only, no remote access), external renders **omit the link** (the title+body still deliver)
rather than ship a dead `/executions/…` a phone can't open.

---

**Net:** Email is an **engine transport port** (a credential-confining IMAP/SMTP analog of
`ctx.http`); the Notifier is an **app push layer** that reuses connector verbs through a trusted
caller. Different layers, one-way dependency, each shippable on its own.
