# Notifications + Connectors Architecture Notes

**Status:** Recommendation / review notes  
**Date:** 2026-06-23  
**Related:** `docs/connectors-email-and-notifier-spec.md`, `docs/connectors-module-spec.md`

## Executive judgment

The right architecture is:

1. **Connectors remain the action/delivery layer.** They know how to call Telegram, Slack,
   Gmail, Outlook, etc. They should not know what a Flow notification is.
2. **Notifier lives in the app.** It decides when an app event should reach the user, which
   channels are eligible, how the event is rendered, and how delivery is retried/audited.
3. **Preference/config data can stay simple.** JSON arrays for small lists are right-sized
   for the local-first app.
4. **Delivery attempts should be durable.** A notification send should not be only a
   best-effort side effect. Add a small outbox/delivery table.

The current spec is directionally correct. The main change I recommend is not to normalize every
preference, but to persist every delivery attempt.

## Layering

The clean boundary is:

```txt
app domain event
  -> app notifier
    -> connector-backed channel adapter
      -> connector runtime action
    -> native channel adapter
      -> web push / future in-app center
```

Connectors should expose verbs such as:

- `telegram.send_message`
- `slack.post_message`
- `gmail.send_email`
- `outlook_mail.send_mail`
- future `mail.send_email`

Notifier should own:

- event catalog
- channel preferences
- channel-specific rendering
- delivery attempts
- retries
- web push subscriptions
- digest routing
- settings UI

This one-way dependency is important. The engine can spin out as a generic connector runtime, and
the app can still define opinionated product behavior like quiet hours, digests, lifecycle events,
and user notification preferences.

## Schema judgment

### Keep JSON arrays for tiny preference lists

I agree with the proposed simple schema for preferences:

- `notification_channels.events[]`
- `schedules.deliverResultTo[]`

This is the right size because:

- one local user usually has a handful of channels;
- the event catalog is a hardcoded enum, not user-generated data;
- the UI naturally wants the whole matrix at once;
- routing one event means loading maybe 1-5 enabled channels and filtering in JS;
- the app already uses JSON columns for small embedded arrays.

A join table like `notification_channel_events(channel_id, event_type)` would be more normalized,
but not obviously better. It adds write complexity, more query helpers, and more migration surface
without solving the real reliability problem.

If this becomes hosted with many users, the query still filters by one `userId`. The scaling issue
will not be "iterating five channels"; it will be delivery retries, stuck jobs, rate limits, and
provider errors. That is where the schema should be more robust.

### Use structured channel config, not a single destination string

I would change this:

```ts
destination: text()
```

to this:

```ts
config: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull().default({})
```

Reason: each channel type needs different target data.

- Telegram: `{ chatId: string | number }`
- Slack: `{ channel: string, threadTs?: string }`
- WhatsApp: `{ to: string }`
- Email: `{ to: string[], cc?: string[] }`
- Web push: probably `{}` because it fans out to subscriptions

A generic `destination` string looks simpler at first, but it will quickly turn into provider-specific
string parsing. Keep the channel row generic and let the adapter validate `config`.

### Add delivery/outbox rows

The missing piece is a durable delivery table. Without it, `notify(event)` is a fragile side effect:
if the process restarts after the event but before the send, the notification vanishes. If a provider
times out after sending, there is no clear place to mark the attempt indeterminate or retry.

Recommended table:

```ts
export const notificationDeliveries = sqliteTable('notification_deliveries', {
  id: text().primaryKey(),
  userId: text().notNull().default('local'),
  eventType: text().notNull(),
  dedupeKey: text().notNull(),
  channelId: text().notNull().references(() => notificationChannels.id, { onDelete: 'cascade' }),
  status: text({ enum: ['pending', 'sending', 'sent', 'failed', 'skipped'] }).notNull().default('pending'),
  attempts: integer().notNull().default(0),
  event: text({ mode: 'json' }).$type<NotificationEvent>().notNull(),
  rendered: text({ mode: 'json' }).$type<RenderedNotification>(),
  providerMessageId: text(),
  lastError: text(),
  nextAttemptAt: text(),
  sentAt: text(),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('uniq_notification_deliveries_dedupe_channel').on(table.dedupeKey, table.channelId),
  index('idx_notification_deliveries_user_status').on(table.userId, table.status),
  index('idx_notification_deliveries_next_attempt').on(table.status, table.nextAttemptAt),
]);
```

The unique `(dedupeKey, channelId)` matters. It lets emission points call `notify()` safely more than
once without double-sending.

## Standard notification pipeline

The standard robust pattern is:

1. **Domain event occurs.**
   Example: an execution finishes, an agent asks for input, a connector action needs approval, or a
   schedule completes.

2. **Notifier receives a presentation-neutral event.**
   Example:

   ```ts
   notify({
     type: 'execution.finished',
     userId: 'local',
     title: 'Fix auth bug',
     body: 'Tests pass. Token refresh patched.',
     url: '/executions/...',
     dedupeKey: 'execution.finished:<runId>',
   });
   ```

3. **Router loads enabled channels.**
   For matrix events, load enabled channels by `userId` and filter by `events[]`.
   For digest/binding events, use the schedule's `deliverResultTo[]`.

4. **Create delivery rows.**
   One delivery row per target channel. Use `insert or ignore` / conflict handling on
   `(dedupeKey, channelId)`.

5. **Worker processes pending deliveries.**
   This can happen inline in v1 after inserting rows, but the data model should allow a later background
   worker to pick up `pending` / `failed` rows.

6. **Renderer formats per channel.**
   Telegram can use plain text or MarkdownV2. Web push needs title/body/data URL. Email can have subject
   and body.

7. **Adapter sends.**
   Connector-backed adapters call `runtime.runAction(...)`.
   Native adapters call local app infrastructure such as `web-push`.

8. **Status is recorded.**
   Mark `sent`, `failed`, `skipped`, increment `attempts`, store `lastError`, and schedule a retry if
   appropriate.

This is the common shape used in production systems: domain event -> outbox/job -> routing -> fanout
-> provider adapter -> delivery status.

## Notification events

The proposed event catalog is good:

- `execution.needs_input`
- `execution.finished`
- `connector.approval_required`
- `schedule.run_completed`
- `deck.surfaced`

I would keep the single `EVENT_CATALOG` as the source of truth and derive the TypeScript union from
it.

The important implementation detail: do not emit from UI-only state. Emit from durable or near-durable
server-side state transitions.

Recommended emission points:

- `execution.needs_input`: after a `permission_request` or `question_request` chat event is persisted,
  not merely when in-memory pending input changes.
- `execution.finished`: from the shared run terminal path, covering manual and scheduled runs.
- `connector.approval_required`: when the connector approval policy registers a pending approval.
- `schedule.run_completed`: for orchestrator-target scheduled runs that do not already produce an
  execution-finished notification.
- `deck.surfaced`: when proactive deck logic writes a durable deck/change record.

## Trusted connector dispatch

Notifier sends are app-driven. It would be bad UX to ask the user to approve every notification that
the app itself is trying to send.

But the bypass must be narrow.

Do this:

```ts
runtime.runAction('telegram.send_message', input, {
  ownerId: userId,
  connectionId: channel.connectionId,
  caller: { type: 'app', id: 'notifier' },
});
```

Then in the host approval policy:

- allow `{ type: 'app', id: 'notifier' }` only for explicit delivery actions;
- optionally require `connectionId` to match an enabled notification channel;
- keep normal agent/MCP connector calls gated;
- audit all notifier connector calls through `onActionRun`.

Do not implement this as "all app callers bypass approval." That would be too broad.

## Channel adapter registry

Use an adapter registry in app code:

```ts
interface NotificationChannelAdapter {
  kind: NotificationChannelKind;
  validateConfig(channel: NotificationChannel): void;
  render(event: NotificationEvent, channel: NotificationChannel): RenderedNotification;
  deliver(channel: NotificationChannel, rendered: RenderedNotification): Promise<DeliveryResult>;
}
```

For connector-backed channels, make the adapter explicit:

```ts
const TELEGRAM_NOTIFICATION_ADAPTER = {
  providerId: 'telegram',
  actionId: 'telegram.send_message',
  input(channel, rendered) {
    return {
      chatId: channel.config.chatId,
      text: `${rendered.title}\n\n${rendered.body}\n${rendered.url}`,
    };
  },
};
```

Do not make notifier dynamically infer arbitrary connector tools. Notification delivery is product
infrastructure, not free-form agent behavior. It should use an allowlisted set of delivery actions.

## Web push

Web push is not a connector and should not be forced into connector abstractions.

Recommended shape:

- `web_push_subscriptions`
- VAPID keys stored in `.config`, mode `0600`
- public key route
- subscribe/unsubscribe route
- service worker in `public/`
- adapter fans out to all active subscriptions for the user
- prune subscriptions on `410` / `404`

For the channel model, one `web_push` channel can represent "all browsers for this user"; individual
browser endpoints live in `web_push_subscriptions`.

## Schedule/digest routing

Keep these separate:

- lifecycle matrix: channel owns `events[]`;
- digest delivery: schedule owns `deliverResultTo[]`.

That matches UX. A user thinks:

- "Telegram should tell me when agents need input."
- "This morning digest should go to Telegram and web push."

Those are different authoring moments. Unifying them into one subscriptions table would likely make
the code more abstract without making the product simpler.

Cleanup rule: deleting a notification channel must remove its id from all `schedules.deliverResultTo[]`.

## Email transport

The email transport section is architecturally right but should not be a notifier v1 dependency.

Generic IMAP/SMTP is not just another HTTP provider. It needs a credential-confining transport port
analogous to `ctx.http`, likely `ctx.mail`, so actions do not receive raw app passwords or OAuth tokens.

However, generic mail transport is larger than it looks:

- IMAP/SMTP endpoint discovery and manual overrides;
- TLS/STARTTLS policy;
- XOAUTH2;
- MIME parsing;
- attachment handling;
- provider-specific folder/search behavior;
- rate limits and connection lifecycle.

Ship notifier first with Telegram and web push. Use existing REST email providers where available
for sending. Treat generic IMAP/SMTP as an engine extension after the notification pipeline exists.

## Minimal v1 implementation plan

1. Add schema:
   - `notification_channels`
   - `web_push_subscriptions`
   - `notification_deliveries`
   - `schedules.deliverResultTo`

2. Add query helpers only:
   - no raw SQL in routes;
   - list channels by user;
   - insert/upsert delivery;
   - claim pending deliveries;
   - mark sent/failed;
   - cleanup channels for deleted connector connection;
   - cleanup schedule bindings for deleted notification channel.

3. Add `src/lib/notifications`:
   - `events.ts` for `EVENT_CATALOG`;
   - `types.ts`;
   - `render.ts`;
   - `notify.ts`;
   - `deliver.ts`;
   - `adapters/telegram.ts`;
   - `adapters/web-push.ts`.

4. Wire trusted connector dispatch:
   - add allowlist to `appApprovalPolicy`;
   - pass `caller: { type: 'app', id: 'notifier' }`;
   - only allow known delivery actions.

5. Wire emission points:
   - pending input after durable request event;
   - run terminal helper for both manual and scheduled runs;
   - connector approval pending registration;
   - schedule digest completion;
   - deck later.

6. Add settings UI:
   - connect/manage delivery channel;
   - configure channel `config`;
   - event matrix;
   - web push subscribe/unsubscribe.

7. Tests:
   - `notify()` creates one delivery per subscribed channel;
   - duplicate `dedupeKey` does not double-send;
   - disabled channels are skipped;
   - channel deletion cleans schedule bindings;
   - connector disconnect disables/deletes connector-backed channels;
   - notifier caller bypasses approval only for allowlisted delivery actions;
   - failed delivery records `lastError` and can retry.

## Recommended schema shape

```ts
export const notificationChannels = sqliteTable('notification_channels', {
  id: text().primaryKey(),
  userId: text().notNull().default('local'),
  kind: text({ enum: ['connector', 'web_push', 'in_app'] }).notNull(),
  providerId: text(),
  actionId: text(),
  connectionId: text(),
  config: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  events: text({ mode: 'json' }).$type<string[]>().notNull().default([]),
  enabled: integer({ mode: 'boolean' }).notNull().default(true),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_notification_channels_user_enabled').on(table.userId, table.enabled),
  index('idx_notification_channels_connection').on(table.connectionId),
]);

export const webPushSubscriptions = sqliteTable('web_push_subscriptions', {
  id: text().primaryKey(),
  userId: text().notNull().default('local'),
  endpoint: text().notNull().unique(),
  p256dh: text().notNull(),
  auth: text().notNull(),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_web_push_subscriptions_user').on(table.userId),
]);

export const notificationDeliveries = sqliteTable('notification_deliveries', {
  id: text().primaryKey(),
  userId: text().notNull().default('local'),
  eventType: text().notNull(),
  dedupeKey: text().notNull(),
  channelId: text().notNull().references(() => notificationChannels.id, { onDelete: 'cascade' }),
  status: text({ enum: ['pending', 'sending', 'sent', 'failed', 'skipped'] }).notNull().default('pending'),
  attempts: integer().notNull().default(0),
  event: text({ mode: 'json' }).$type<NotificationEvent>().notNull(),
  rendered: text({ mode: 'json' }).$type<RenderedNotification>(),
  providerMessageId: text(),
  lastError: text(),
  nextAttemptAt: text(),
  sentAt: text(),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('uniq_notification_deliveries_dedupe_channel').on(table.dedupeKey, table.channelId),
  index('idx_notification_deliveries_user_status').on(table.userId, table.status),
  index('idx_notification_deliveries_next_attempt').on(table.status, table.nextAttemptAt),
]);
```

The exact names can change. The important distinction is:

- `notification_channels` = user preference/config;
- `web_push_subscriptions` = browser endpoints;
- `notification_deliveries` = durable send attempts.

## Final recommendation

Keep the notifier simple, but make delivery durable.

Do not build a generic event bus yet. Do not normalize tiny preference lists yet. Do not make generic
IMAP/SMTP a blocker. Do not let the connector engine learn app notification concepts.

Build a small app-layer notifier with:

- direct emission points;
- JSON preference lists;
- structured channel config;
- an outbox/delivery table;
- explicit adapter registry;
- narrow trusted connector dispatch;
- web push as native app infrastructure;
- connector-backed delivery for Telegram first.

That is the right-sized architecture: simple where the data is small, durable where side effects can
fail, and cleanly layered so connectors can grow independently from app notification policy.
