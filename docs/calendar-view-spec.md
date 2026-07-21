# Calendar View — Spec

Status: **built, then retrenched same day** (2026-07-20, see Retrenchment below) · Builds on `docs/deck-proactive-spec.md` (Phase 2/3 calendar seam, shipped) · Supersedes the `Calendar` "Coming soon" placeholder tab

## Goal

Make the day visible without leaving the app. The user should never open Google
Calendar or Outlook just to answer "what does my day look like," "when is my
next thing," or "where does this task fit."

This is **not** a calendar app. It is the render layer over the day model the
deck already computes: external commitments are the skeleton, free gaps are the
negative space, and the deck's slotted tasks are poured into the gaps. The deck
stays the source of truth for priority. The calendar surface is its projection
into time.

One shared day model, rendered at three densities:

1. **HUD next-boundary button** — ambient awareness on every screen, including
   ExecutionView.
2. **Day-shape strip in the deck** — the day at a glance while planning.
3. **Calendar tab** — the full companion panel: hour-axis day view (default)
   plus a week capacity view. Sits side by side with the deck via the existing
   split panels.

## Principles (decided)

1. **Render time like a calendar, manage it like Flow.** Hour-as-vertical-axis
   is the familiar encoding people already read fluently — keep it. What we do
   NOT build is event-management chrome (create/edit/RSVP UI, drag-to-create).
   Event management stays conversational (later phase, out of scope here).
2. **Only commitments are solid.** External events render solid and can reject
   a drop. AI-slotted tasks render as translucent ghosts, never masquerade as
   events, never produce conflict errors against each other, and never nag on
   overrun. When reality diverges, the plan re-pours quietly (reconcile already
   does this).
3. **Empty gaps are slack, and slack is a feature.** The AI never auto-fills
   every gap. Gap-filling is suggestion-weight: offered on demand, one tap to
   accept, dismiss leaves the gap free.
4. **User placement is expensive to move.** A slot the user set by hand
   (`slotSource: 'user'`) survives regeneration and is the last candidate for a
   reconcile bump. External reality can still override it, but always narrated,
   never silently.
5. **Honest degradation.** "Calendar broken" must never render as "day is
   free." Every surface distinguishes: no provider connected, connected but
   errored, connected and stale, connected and empty. Data carries `asOf`.
6. **No guilt.** No utilization scores, no "productive hours" metrics, no month
   view. Week view answers exactly one question: where does the week not fit.

## Current state (grounded, verified 2026-07-19)

- **Connector toolkits** — `packages/connectors/src/providers/google/calendar.ts`
  (`google_calendar`: `list_calendars`, `list_events` with `timeMin`/`timeMax`,
  `get_event`, `create_event`, `update_event`, `delete_event`) and
  `packages/connectors/src/providers/microsoft/calendar.ts` (`outlook_calendar`:
  `list_events` — **no time-range params, hits `/me/events`**, plus event CRUD).
  Google's `eventSummary` returns only `{id, summary, start, end, status,
  htmlLink}` — no transparency, attendees, location, or hangoutLink. Outlook's
  returns `{id, subject, start, end, location, webLink}` and Graph dateTimes
  come back **without offset** (UTC by default).
- **Deck calendar seam** — `src/lib/deck/calendar.ts`: provider registry
  (`setCalendarProvider`/`hasCalendarProvider`/`getCalendarEventsForDay`) +
  pure gap math (`computeFreeGaps`, `availableMinutes`, `formatGap`,
  `minutesToLabel`, `formatMinutes`, `parseHhMm`). Fully tested.
- **Live wiring** — `src/lib/deck/calendar-connector.ts`:
  `ensureCalendarProvider()` registers a **Google-only** day-fetcher
  (first Google connection, `primary` calendar). Skips all-day + cancelled.
  Documented v1 gap at lines 89–91: **declined and free-transparency events
  still count as busy**. Registered at boot (`instrumentation.ts:161`) and in
  the CLI subprocess by the deck actions (`registry.ts` `regenerate_deck` /
  `reconcile_deck`).
- **Deck consumption** — `src/lib/ai/generate-deck.ts:293-306` computes
  `timeContext` (workday from `user_state.workdayStart/End`, defaults
  09:00/18:00, schema.ts:87-88); inline `get_day_shape` AI-SDK tool at :332.
  `src/lib/deck/reconcile-external.ts` diffs live calendar vs
  `decks.calendarSnapshot` (schema.ts:498) and bumps from the end of the item
  list. `DEFAULT_TASK_MINUTES` fallback lives there.
- **Types** — `CalendarBlock {start, end, title, source}` (schema.ts:556).
  `DeckItem` already has `slotStart/slotEnd/slotReason` + `source: 'ai'|'user'`
  (membership provenance, schema.ts). Client mirror `DeckItem` in
  `src/types/dashboard.ts:82-100`. `DeckChange.kind` enum:
  `carried|deferred|dropped|added|reordered|bumped`.
- **UI shell** — two resizable tabbed panels (`panel-layout.tsx`,
  `content-panel.tsx`). `MORE_TABS` already contains
  `{id: 'calendar', label: 'Calendar', icon: Calendar}` (content-panel.tsx:81)
  rendering the `MoreTabContent` "Coming soon" placeholder (:942). Palette
  navigation: adding a `go-<tab>` command to `PALETTE_COMMANDS` auto-routes via
  `handleNavigate(cmd.id.replace('go-', ''))` (search-overlay.tsx:135) — no
  switch to edit. `TopHud` (`top-hud.tsx`) hosts live pills
  (`RailStatusPills`, `BudgetWarningPill`). `DeckDayBar`
  (`deck-day-bar.tsx`) is a stats strip (Add task / N done / habits), not a
  timeline. Deck renders slot pills only (`deck-stack.tsx:312-320`).
- **Data fetching** — hooks use TanStack Query + the `api` client
  (`src/lib/api/client.ts`), e.g. `src/hooks/use-morning-deck.ts`.
  `DeckContainer` does **not** use TanStack Query — local state + raw
  `api.get('/deck')` (deck-container.tsx:247) and
  `api.patch('/deck/'+id, {items, alternatives})` for reorder (:171).
  Cross-surface sync must therefore be explicit (CustomEvent, see 3.2).
- **Orchestrator** — `update_deck` action exists (items/alternatives/framing).
  **No `get_day_shape` action** — agents outside deck generation must read raw
  connector events and do their own free/busy math, which the deck prompt
  itself forbids ("never do free/busy math yourself").
- **Tests** — vitest (`pnpm test`), colocated `*.test.ts`
  (`src/lib/deck/calendar.test.ts` is the pattern).

## Target model

### A. The day-shape service (one source of truth)

New module `src/lib/calendar/` — the normalized read layer. The deck seam's
pure math stays in `src/lib/deck/calendar.ts` (imported, not duplicated).

**`CalendarEvent`** (new, `src/lib/calendar/types.ts` — plain TS types, no DB
table, so they do not belong in `src/db/types.ts`):

```ts
export interface CalendarEvent {
  id: string;                       // provider event id
  providerId: 'google' | 'microsoft';
  connectionId: string;
  title: string;                    // fallback 'Busy'
  start: string;                    // ISO 8601 instant (with offset or Z)
  end: string;
  allDay: boolean;
  location: string | null;
  joinUrl: string | null;           // hangoutLink / onlineMeeting.joinUrl
  sourceUrl: string | null;         // htmlLink / webLink ("open in source")
  rsvp: 'accepted' | 'declined' | 'tentative' | 'needs_action' | null;
  transparency: 'busy' | 'free';
  countsAsBusy: boolean;            // derived, see below
}
```

**`countsAsBusy`** (pure, `src/lib/calendar/events.ts`):
`!allDay && !cancelled && transparency === 'busy' && rsvp !== 'declined'`.
Tentative counts busy. Normalization: Google `transparency: 'transparent'` →
`'free'`; Outlook `showAs` `'free' | 'workingElsewhere'` → `'free'`, everything
else (`busy`, `tentative`, `oof`, `unknown`) → `'busy'`. Google rsvp = the
`self: true` attendee's `responseStatus` (`needsAction` → `needs_action`), null
when no attendees. Outlook rsvp from `responseStatus.response`
(`organizer` → `accepted`, `tentativelyAccepted` → `tentative`,
`notResponded`/`none` → `needs_action`).

**Service** (`src/lib/calendar/service.ts`):

```ts
getCalendarRange(opts: { start: string; days: number; fresh?: boolean }):
  Promise<CalendarRangeResult>
```

- Fetches every connected `google` + `microsoft` connection (all of them, not
  just the first), `primary` calendar / default calendar only (multi-calendar
  selection is deferred, see Deferred).
- Google: one `list_events` call per connection spanning the whole range
  (`timeMin` = local `start` 00:00 as ISO, `timeMax` = start + days,
  `maxResults: 250`, `singleEvents: true` already set by the toolkit).
- Outlook: `list_events` with the new `startDateTime`/`endDateTime` params
  (see task 0.2) which route to `/me/calendarView` so recurrences expand.
- Merge, sort by start, normalize to `CalendarEvent[]`.
- Per-day derivation: split into `allDay` vs timed; busy blocks =
  `events.filter(e => e.countsAsBusy)` mapped to `CalendarBlock` and run
  through the existing `computeFreeGaps` / `availableMinutes` with
  `user_state` workday bounds.
- **Status** (`CalendarReadStatus`): `no_providers` (zero google/microsoft
  connections) · `ok` (all connection fetches succeeded) · `degraded` (some
  succeeded) · `error` (all failed). Per-connection detail in `providers[]`.
  **`degraded`/`error` days still return whatever events were fetched — the UI
  must show the warning, never a silently thinner day.**
- **Cache**: module-level in-process `Map` keyed `${start}:${days}` →
  `{result, fetchedAt}`, TTL **60s**. `fresh: true` bypasses and overwrites.
  No background polling anywhere server-side. `asOf` = fetch wall-clock ISO.

**Result shape** (also the API route response):

```ts
interface CalendarRangeResult {
  status: 'ok' | 'no_providers' | 'degraded' | 'error';
  asOf: string;
  workday: { start: string; end: string };       // 'HH:MM'
  providers: Array<{ providerId: string; connectionId: string;
                     ok: boolean; detail?: string }>;
  days: Array<{
    date: string;                                 // YYYY-MM-DD (server-local)
    allDay: CalendarEvent[];
    events: CalendarEvent[];                      // timed, sorted by start
    gaps: Array<{ startMinute: number; endMinute: number; minutes: number }>;
    freeMinutes: number;
    largestGapMinutes: number;
    busyMinutes: number;                          // within workday bounds
  }>;
}
```

Timezone rule: local-first — the server and user share a machine, so
server-local day boundaries (`todayLocalDate()` pattern) are the user's day.
Events carry real instants; the client renders in browser tz.

**API route**: `GET /api/calendar?start=YYYY-MM-DD&days=N` (N clamped 1–14,
default 1, `start` defaults to today; `&fresh=1` busts the cache). Same
Bearer-auth middleware as every `/api` route; client always uses the `api`
client. No new query functions in `queries.ts` — this route reads connectors,
not SQLite, so the queries-layer rule doesn't apply.

**Orchestrator action** `get_day_shape` (registry.ts, non-mutating):

```
params: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          days: z.number().int().min(1).max(7).optional() }
```

Handler dynamic-imports the service (same lazy pattern as
`calendar-connector.ts` — never static-import the connectors runtime), calls
`getCalendarRange`, returns the agent-trimmed shape:

```ts
{ status, asOf, workday: 'HH:MM-HH:MM',
  days: [{ date,
    allDay: [{ title, start, end }],
    busy:   [{ title, start, end, source }],
    freeGaps: string[],            // formatGap() strings
    freeMinutes, largestGapMinutes }] }
```

Description: `"The user's day shape for a date or range: calendar commitments,
free gaps, and free minutes, already computed. Use this for anything about
time or availability. Never compute free/busy from raw calendar events
yourself."`

**Deck seam rewire**: `ensureCalendarProvider()` in
`src/lib/deck/calendar-connector.ts` now registers
`(date) => getCalendarRange({start: date, days: 1})` mapped to busy
`CalendarBlock[]`. Deck generation and reconcile are **untouched** — they keep
consuming `getCalendarEventsForDay`. This single change gives the deck:
Outlook, multi-connection merge, the declined/free fix, and the 60s cache.

### B. Surfaces

#### B1. HUD next-boundary button (`HudDayButton`)

Mounted in `top-hud.tsx` immediately after `<RailStatusPills />`. Desktop and
tablet only (mobile gets the strip + tab). Hidden entirely when
`status === 'no_providers'`.

Label logic (from today's day shape, timed `countsAsBusy` events only,
evaluated client-side, re-evaluated on a 30s local timer):

| State | Label (copy is exact, no em dashes, no semicolons) |
|---|---|
| An event is ongoing (`start ≤ now < end`) | `{title} ends {h:mm}` |
| Next event starts within 90 min | `{title} in {N}m` |
| Next event later today | `{title} at {h:mm}` |
| No events left today, some earlier | `Nothing else scheduled today` |
| No timed events today | `Nothing scheduled today` |
| `status === 'error'` | `Calendar unreachable` |

Title truncated to 24 chars with ellipsis. When next event starts in ≤ 10 min,
the label takes the same warning treatment as `BudgetWarningPill`. When
`asOf` is older than 15 min, show a small stale dot on the button, tooltip
`As of {h:mm}`.

Click opens **`HudDayPeek`** — a Radix Popover (~340px wide): the compact
`DayShapeStrip` (B2, same component), then today's agenda list (all-day chips
on top, then timed events with time, title, and a `Join` button when `joinUrl`
exists), then a footer row: summary text
(`{freeMinutes formatted} open · largest gap {largest}`) and an
`Open calendar` link → `setPanelTab('a', 'calendar')` and close. The peek
respects the plan-layer toggle (shows slotted tasks interleaved as ghost rows
when on).

#### B2. Day-shape strip (`DayShapeStrip`)

Rendered by `DeckDayBar` as a second row under the existing controls row (own
`border-b border-border/50`). Props: `items: DeckItem[]` (today's active deck
items, passed from `DeckContainer.plan.items`). Fetches its own day shape via
`useDayShape(today, 1)`. Hidden when `status === 'no_providers'` **and** no
item has a slot.

Rendering — one proportional horizontal track, height 16px, spanning workday
bounds (events outside bounds clamp to the edge with a 2px overflow notch):

- Busy blocks: solid `bg-muted-foreground/25 rounded-[3px]`, tooltip
  `{title} · {h:mm} to {h:mm}`.
- Slotted tasks (plan layer on): `bg-primary/25 border border-dashed
  border-primary/50 rounded-[3px]`, tooltip `{task title} · {slot times}`.
- Gaps: track background; gaps ≥ 45 min get a centered `{Nh Nm}` label at
  `text-[9px] text-muted-foreground/60` (skip labels that don't fit).
- Now line: 1px `bg-primary` full height with a 3px dot on top, only when
  today is within workday bounds.
- Right of the track, one summary line `text-[10px] text-muted-foreground`:
  `{free} open · largest {largest} · next {h:mm}` (omit `next` segment when no
  upcoming event).

Click anywhere on the strip → `setPanelTab` of the **other** panel (the panel
not hosting this deck) to `'calendar'`, so deck and calendar end up side by
side. Fallback if the deck's panel is unknowable: `setPanelTab('b',
'calendar')`.

#### B3. Calendar tab (`CalendarPanel`)

Replaces the placeholder branch in `content-panel.tsx` (`activeTab ===
'calendar'` currently falls into `MoreTabContent`). Mobile: same component via
the existing mobile More surface — add `calendar` to the mobile More entries
(day view only on `<md`, the week toggle hides).

**Header row** (matches existing panel-header idiom): `‹` `Today` `›` date
nav, current date label (`Fri, Jul 24` / `Jul 21 to 27` in week mode),
segmented `Day | Week` control, plan-layer eye toggle (Lucide `Eye`/`EyeOff`,
tooltip `Show planned tasks` / `Hide planned tasks`), refresh button (tooltip
`Updated {h:mm}`, click = `fresh` refetch), and a stale/degraded indicator dot
reusing the same rules as the HUD button. Plan-layer state persists to
`localStorage['flow.calendar.showPlanLayer']`, default `true`, shared by all
surfaces.

**Empty state** (`status === 'no_providers'`): centered `Calendar` icon +
`Connect your calendar` + `See your day here and let the deck plan around it`
+ button `Open connector settings` → `openSettings('connectors')`.

**Day view** (`DayView`, the default):

- Vertical hour axis. Visible range = `min(workdayStart, earliest event start)`
  floored to the hour → `max(workdayEnd, latest event end)` ceiled to the
  hour; never smaller than the workday. **48px per hour.** Hour gridlines
  `border-border/40`, hour labels `text-[9px] text-muted-foreground/60` in a
  40px gutter.
- All-day row pinned above the axis: chips with title (+ `{n} more` collapse
  past 3).
- Timed events: absolutely positioned solid cards (`bg-muted`,
  `border-border`, title + time, `Video` icon when `joinUrl`). Overlaps use
  greedy column packing (pure helper, max 3 columns, then a `+N` chip that
  opens a popover listing the rest). Events where `countsAsBusy === false`
  (declined / free) render at 40% opacity with strikethrough title — visible
  but explicitly not blocking.
- Click event → **`EventPopover`**: title, time range, calendar attribution
  (`Google · you@…` best effort from connection metadata), location line,
  primary button `Join` (when `joinUrl`), secondary `Open in {Google
  Calendar|Outlook}` (`sourceUrl`). Read-only. No edit affordances.
- Plan layer (toggle on): today's slotted deck items as ghost blocks
  (`bg-primary/10 border border-dashed border-primary/50 text-primary`,
  task title + slot time). Click ghost → **`SlotPopover`**: task title
  (click-through opens the task slideout), `slotReason`, actions `Focus` ·
  `Done` · `Not today` · `Clear slot` (each reuses the deck's existing
  action semantics, see 3.2).
- Gaps ≥ 30 min (plan layer on, today only): on hover show a right-aligned
  ghost affordance `Fill · {Nh Nm}` → **`GapFillPopover`** (3.4).
- Now line across the full width (today only), auto-scroll on mount so now
  sits at 1/3 viewport height.
- Non-today dates: no now line, no gap-fill, plan layer renders nothing
  (slots exist only on today's deck).

**Week view** (`WeekView`):

- 7 columns, **Monday start**, fetched as one `days=7` range. Today
  highlighted. Each day cell: date header, a horizontal capacity bar within
  workday bounds (busy solid, planned `bg-primary/25` today only, remainder
  open), `{free} open` + `largest {Nh}` labels, and — today only — an amber
  `Over capacity` tag when the sum of active deck items' `estimatedMinutes`
  (fallback `DEFAULT_TASK_MINUTES`) exceeds `freeMinutes`.
- Click a day → switches to Day view of that date.
- No hour grid in week view in this spec (deferred, cheap later — same data,
  same components).

### C. Placement interactions (plan layer)

#### Slot provenance

`DeckItem` gains `slotSource?: 'ai' | 'user' | null` (JSON column type change,
**no migration needed**). Generation post-processing stamps `'ai'` on every
model-produced slot. All placement interactions below write `'user'`.

`DeckChange.kind` gains `'unslotted'` (additive union member): membership
kept, slot cleared. Copy in the change brief: `The time you set for {title}
was cleared. {reason}`.

#### Deterministic protection rules (code, not prompt-hope)

1. **Generation** (`generate-deck.ts`): after structured output, run
   `restoreUserSlots(newItems, prevActiveItems, busyBlocks)` (new pure fn):
   for every new item whose taskId had a `slotSource: 'user'` slot on the
   previous active deck for the same `forDate`, if that slot does not overlap
   any current busy block → copy the slot + `slotSource: 'user'` onto the new
   item, overriding whatever the model produced. If it now overlaps → leave
   the model's slot (or null) and append a `DeckChange {kind: 'unslotted',
   source: 'calendar'}`.
2. **Reconcile** (`reconcile-external.ts`): the bump loop currently pops from
   the end. Change victim selection to two passes: first pass pops from the
   end **skipping** `slotSource === 'user'` items; if still over capacity,
   second pass may bump user-slotted items with `needsDecision: true`,
   `magnitude: 'major'`.
3. **Reconcile overlap**: when a newly appeared busy block overlaps a
   `slotSource: 'user'` slot, clear the slot fields (keep the item), append
   `DeckChange {kind: 'unslotted', source: 'calendar', reason: 'A meeting
   landed on the time you set for {title}'}` routed through the change router
   like any other change.

#### Gap fill (suggestion-weight)

`GapFillPopover`: candidates = today's active deck items with no slot, whose
`estimatedMinutes` (fallback `DEFAULT_TASK_MINUTES`, exported from
`reconcile-external.ts`) ≤ gap minutes, in deck order, top 3. Each row: task
title + `{est}m`. Header: `Fits this {Nh Nm} gap`. Tap a row → slot it:
`slotStart` = gap start, `slotEnd` = start + estimate, `slotSource: 'user'`,
`slotReason: 'You placed this'`. Empty candidates → `Nothing on the deck fits
this gap`. Dismissal does nothing. No auto-fill anywhere.

#### Drag (within the calendar panel only)

DndContext local to `CalendarPanel` (cross-panel drag from the deck list is
deferred — dnd-kit contexts don't span the panel trees).

- **`UnslottedTray`**: collapsible bottom tray in Day view (today), listing
  active deck items without slots as small draggable chips (`{title} ·
  {est}m`). Hidden when empty or plan layer off.
- Drag chip onto the axis → ghost preview snapped to **15-min** increments.
  Drop writes the slot (`slotSource: 'user'`, duration = estimate,
  `slotReason: 'You placed this'`).
- Existing ghost slots are draggable the same way (move = keep duration,
  `slotSource` becomes `'user'`).
- **Drop rejection**: only when the proposed interval overlaps a
  `countsAsBusy` event — show not-allowed cursor + the ghost turns
  `border-destructive/50`. Task-over-task overlap is allowed (soft). Drops
  may extend past `workdayEnd` (your evening, your call) but not before
  `workdayStart` of the rendered range.

#### Persistence + cross-surface sync

All slot mutations go through the existing deck update path:
`api.patch('/deck/' + deckId, { items })` with the full recomputed items
array (identical to the reorder path at deck-container.tsx:171 — no new
route). Toast with `Undo` restores the previous items array (one-shot,
client-held).

Because `DeckContainer` holds local state (no shared query cache), define one
CustomEvent: **`flow:deck-changed`**. `CalendarPanel` dispatches it after any
slot write. `DeckContainer` listens and re-runs its `GET /deck` load.
`DeckContainer` also dispatches it after its own mutations (done, reorder,
regenerate, revert) and `CalendarPanel`'s TanStack `['deck', 'active']` query
invalidates on it. Idempotent GETs, no echo loop.

`CalendarPanel` reads the deck via TanStack Query key `['deck', 'active']`,
`queryFn: api.get('/deck')` — the server's proactive ensure makes this safe.

### D. Client data hook

`src/hooks/use-day-shape.ts`:

```ts
useDayShape(start: string, days: number)  // TanStack Query
// key: ['calendar', start, days]
// queryFn: api.get('/calendar', {query: {start, days}})
// staleTime 60_000 · refetchInterval 300_000 · refetchOnWindowFocus true
useRefreshDayShape()                       // fetch with fresh=1 → invalidate ['calendar']
```

The HUD's 30s label tick is a local `setInterval` re-render against cached
data, not a refetch.

### E. Visual language (tokens only, per design-token rule)

| Element | Treatment |
|---|---|
| Commitment (busy) | solid `bg-muted` card, `border-border`, `text-foreground` |
| Commitment (declined / free) | same at 40% opacity, line-through title |
| AI/user slot (ghost) | `bg-primary/10`, `border border-dashed border-primary/50`, `text-primary` |
| Strip busy segment | `bg-muted-foreground/25` |
| Strip slot segment | `bg-primary/25` + dashed border |
| Gap | negative space + muted duration label |
| Now line | 1px `bg-primary` + dot |
| Over capacity / imminent | same treatment family as `BudgetWarningPill` |
| Stale / degraded | small dot + tooltip, `text-muted-foreground` |

All user-facing copy in this feature: **no em dashes, no semicolons** (site
copy rule), no hardcoded product or user names (open-source rule).

## Decisions (resolved here so implementation has zero ambiguity)

- Hour height **48px**, snap **15 min**, week starts **Monday**.
- Plan layer default **on**, persisted at `flow.calendar.showPlanLayer`,
  shared across tab, strip, and peek.
- Gap-fill affordance threshold **30 min**, strip gap label threshold
  **45 min**, candidate count **3**.
- HUD imminent threshold **10 min**, stale threshold **15 min**, label tick
  **30s**, HUD truncation **24 chars**.
- Cache TTL **60s** server-side; client staleTime 60s, refetchInterval 5 min,
  refetch on focus. No server-side polling loop.
- Primary calendars only, **all** connected Google + Microsoft connections.
- Tentative counts busy. Declined, transparent, `workingElsewhere`, all-day do
  not.
- No new global hotkey (⌘K letters are contested) — palette command only.
- Read-only: no event create/edit/delete UI anywhere in this spec.
- `GET /api/calendar` reads connectors directly (no `queries.ts` involvement,
  no new tables, no migrations — the only schema-file edits are JSON-column
  **type** additions: `DeckItem.slotSource`, `DeckChange.kind 'unslotted'`).

## Explicitly deferred (decided out, pointers for later)

- **Rhythms (terrain layer)** — user/AI-declared recurring typed blocks
  ("mornings = deep work", "Tue/Thu 2-4 = Project X") with `prefer | protect`
  strength: background washes in the day view, slotting guidance in
  generation, AI-proposed from observed patterns. Needs its own spec + a real
  table (with `...timestamps`). The three-rung ladder ends in calendar
  write-back: prefer (guides AI) → protect (refuses AI slotting) → published
  (real event, protects from humans).
- **Write-back** (`Protect this time`, event creation via chat/NL using the
  existing `create_event` connector actions). Separate trust decision.
- **Cross-panel drag** (deck list → calendar) — needs a dashboard-level
  DndContext refactor.
- **Multi-calendar selection** (non-primary calendars via `list_calendars`) —
  settings UI, connector param plumb-through.
- **Week hour grid, month view** — month is decided against, not just
  deferred.
- **`calendar_events` mirror table** — only when one of: week-instant/offline,
  event embeddings/search, stream ingestion, or meeting-derived prep tasks
  with provenance becomes real.
- **Meeting prep/follow-up task suggestions** — deck-proactive-spec Phase 4.

---

## Task list

Tags: `[new]` net-new · `[reuse]` extends existing · `[ui]` front-end ·
`[conn]` connectors package. Every task ends with `pnpm ts` clean; test tasks
run `pnpm test`. Order within a phase is the dependency order.

### Phase 0 — Day-shape service + agent parity (foundation, no UI)

- [x] **0.1** `[conn]` Enrich `google_calendar` event output: extend `RawEvent`
  + `eventSummary` in `packages/connectors/src/providers/google/calendar.ts`
  with `transparency`, `location`, `hangoutLink`,
  `conferenceData.entryPoints[]` (first `video` uri), and the `self: true`
  attendee's `responseStatus`. Output gains `{transparency?, location?,
  joinUrl?, responseStatus?}`. Additive only — existing consumers unaffected.
  Update the connectors package tests' fixtures.
- [x] **0.2** `[conn]` Range + enrichment for `outlook_calendar.list_events`
  (`packages/connectors/src/providers/microsoft/calendar.ts`): add optional
  `startDateTime`/`endDateTime` inputs; when present, hit
  `/me/calendarView?startDateTime=&endDateTime=` (expands recurrences) instead
  of `/me/events`; `$select` adds `isAllDay,showAs,responseStatus,isCancelled,
  onlineMeeting,isOnlineMeeting`. Output gains `{isAllDay?, showAs?,
  responseStatus?, joinUrl?, isCancelled?}`. Graph returns UTC-naive
  dateTimes — normalize by appending `Z` when `timeZone === 'UTC'` so `start`/
  `end` are real instants. Keep the no-param behavior working (back-compat).
- [x] **0.3** `[new]` `src/lib/calendar/types.ts` + `src/lib/calendar/events.ts`:
  `CalendarEvent`, `CalendarRangeResult`, provider-raw → normalized mappers
  (`normalizeGoogleEvent`, `normalizeOutlookEvent`), `countsAsBusy`,
  `eventToBlock`. Pure. Colocated `events.test.ts` covering the full
  countsAsBusy matrix (declined, transparent, workingElsewhere, tentative,
  oof, cancelled, all-day, no-attendees) and both mappers from captured
  fixture JSON.
- [x] **0.4** `[new]` `src/lib/calendar/service.ts`: `getCalendarRange` per §A —
  all google+microsoft connections via the connectors runtime (lazy dynamic
  import, same pattern as `calendar-connector.ts`), merge/sort/normalize,
  per-day shape via `computeFreeGaps`/`availableMinutes` (imported from
  `@/lib/deck/calendar`) + `user_state` workday bounds, status semantics
  (`no_providers | ok | degraded | error`), 60s TTL map cache with `fresh`
  bypass, `asOf`. Colocated `service.test.ts` with a mocked runtime: merge
  across providers, each status case, cache hit/expiry/fresh.
- [x] **0.5** `[reuse]` Rewire the deck seam: `src/lib/deck/calendar-connector.ts`
  `ensureCalendarProvider()` now registers
  `getCalendarRange({start: date, days: 1})` → `days[0].events.filter(countsAsBusy)`
  → `CalendarBlock[]`. Delete `fetchGoogleCalendarDay` + the v1-gap comment
  (the gap is fixed). Update `calendar-connector.test.ts`. Acceptance: deck
  generation/reconcile now see Outlook + multi-connection + declined-fixed
  data with zero changes to `generate-deck.ts`/`reconcile-external.ts`.
- [x] **0.6** `[new]` Route `src/app/api/calendar/route.ts`: `GET` per §A
  (`start` default today, `days` clamp 1–14, `fresh=1`). Returns
  `CalendarRangeResult` as JSON. Error envelope shape matches sibling routes.
- [x] **0.7** `[new]` Orchestrator action `get_day_shape` in
  `src/lib/orchestrator/registry.ts` (place beside the deck actions):
  params/return/description exactly per §A, non-mutating, lazy service
  import. Acceptance: `<cli> agent get_day_shape --date 2026-07-20` returns
  gaps identical to what deck generation logs for the same date; visible via
  both CLI and MCP transport.
- [x] **0.8** `[reuse]` Extend `deckItemShape` in `registry.ts` (:811) with
  `slotStart`/`slotEnd`/`slotReason`/`slotSource` (optional/nullable,
  camelCase — the shape mirrors the DB JSON, per the existing `taskId`/
  `continuityContext` fields). This also fixes a latent bug: `update_deck`
  currently **strips slot fields** on any items round-trip because the shape
  omits them.
- [x] **0.9** `[reuse]` Schema types (`src/lib/db/schema.ts`):
  `DeckItem.slotSource?: 'ai' | 'user' | null` + `'unslotted'` added to
  `DeckChange.kind`. Mirror both in `src/types/dashboard.ts` (`DeckItem`,
  `DeckChangeView`) and hydration in `deck-container.tsx` (slot field mapping
  ~:87). JSON-column type-only change — assert no drizzle migration is
  generated (`pnpm db:generate` produces nothing).

### Phase 1 — Ambient surfaces

- [x] **1.1** `[new]` `src/hooks/use-day-shape.ts` per §D.
- [x] **1.2** `[new]` `src/lib/calendar/layout.ts`: pure view math —
  `minuteToY(min, pxPerHour)`, `packColumns(events)` (greedy interval
  packing, max 3 + overflow), `clampToWorkday`, `stripSegments(day, items,
  showPlan)` returning `{kind: 'busy'|'slot', startPct, widthPct, label}[]`.
  Colocated `layout.test.ts` (overlap packing, clamping, percentage math).
- [x] **1.3** `[new]` `[ui]` `src/components/calendar/day-shape-strip.tsx` per
  §B2, consuming `stripSegments`. Tooltips via the app's existing tooltip
  primitive.
- [x] **1.4** `[reuse]` `[ui]` Mount the strip: `DeckDayBar` gains
  `items: DeckItem[]` prop (from `DeckContainer` `plan.items`), renders
  `DayShapeStrip` as its second row. Hidden per §B2 rules.
- [x] **1.5** `[new]` `[ui]` `src/components/calendar/hud-day-button.tsx` +
  `hud-day-peek.tsx` per §B1 (label state machine as a pure exported
  `hudLabel(day, now)` with its own test file). Mount in `top-hud.tsx` after
  `RailStatusPills`.
- [x] **1.6** `[reuse]` Palette command in `src/constants/commands.ts`:
  `{ id: 'go-calendar', label: 'Go to Calendar', keywords: 'navigate calendar
  day week schedule meetings agenda', icon: 'Calendar', group: 'navigate' }`.
  No other wiring needed (`handleNavigate` derives the tab from the id).

### Phase 2 — Calendar tab

- [x] **2.1** `[new]` `[ui]` `src/components/calendar/calendar-panel.tsx`:
  header (date nav, Day|Week segmented, plan-layer eye toggle persisted to
  `flow.calendar.showPlanLayer`, refresh + `Updated {h:mm}` tooltip,
  stale/degraded dot), empty state with `openSettings('connectors')`, view
  switching. Deck data via TanStack `['deck', 'active']`.
- [x] **2.2** `[reuse]` `[ui]` `content-panel.tsx`: route `activeTab ===
  'calendar'` to `CalendarPanel` instead of `MoreTabContent`. Add the
  calendar entry to the mobile More surface (same component, week toggle
  hidden `<md`).
- [x] **2.3** `[new]` `[ui]` `day-view.tsx` + `all-day-row.tsx` + `now-line.tsx`
  per §B3: 48px hours, dynamic bounds, gridlines, packed event cards,
  declined/free at 40% + strikethrough, auto-scroll to now, plan-layer
  ghosts.
- [x] **2.4** `[new]` `[ui]` `event-popover.tsx`: attribution, location,
  `Join` (joinUrl), `Open in {provider}` (sourceUrl). Read-only.
- [x] **2.5** `[new]` `[ui]` `week-view.tsx` per §B3: Monday grid, capacity
  bars, `Over capacity` (today, deck estimates vs freeMinutes), click-through
  to Day.
- [x] **2.6** `[ui]` Strip click-through (§B2) → other-panel `'calendar'`.
- [x] **2.7** Manual QA pass on both themes and both panels (deck A + calendar
  B side by side, calendar solo, mobile More → calendar). Verify degraded
  state by revoking a token mid-session: day must render partial data + dot,
  never an empty-clean day.

### Phase 3 — Placement (plan layer interactions)

- [x] **3.1** `[reuse]` Export `DEFAULT_TASK_MINUTES` from
  `src/lib/deck/reconcile-external.ts`.
- [x] **3.2** `[new]` `[ui]` Slot mutation plumbing in `calendar-panel.tsx`:
  recompute-items + `api.patch('/deck/' + deckId, {items})`, one-shot `Undo`
  toast, dispatch `flow:deck-changed`. `DeckContainer`: listen →
  re-run the `GET /deck` load; dispatch the same event after its own
  mutations. `CalendarPanel` invalidates `['deck', 'active']` on it.
- [x] **3.3** `[new]` `[ui]` `slot-popover.tsx`: `Focus` · `Done` ·
  `Not today` · `Clear slot` (reuse deck action handlers' API calls, then
  `flow:deck-changed`).
- [x] **3.4** `[new]` `[ui]` `gap-fill-popover.tsx` per §C (threshold 30m,
  top 3 by deck order, copy as specified).
- [x] **3.5** `[new]` `[ui]` `unslotted-tray.tsx` + drag-to-slot within
  `CalendarPanel` (dnd-kit local context, 15-min snap, reject only
  `countsAsBusy` overlap, ghost move re-stamps `slotSource: 'user'`).
- [x] **3.6** `[reuse]` `restoreUserSlots(newItems, prevItems, busyBlocks)`
  pure fn in `src/lib/ai/generate-deck.ts` (stamp `'ai'` on model slots,
  restore non-overlapping user slots, emit `unslotted` changes for
  overlapped ones) — unit test as a pure function.
- [x] **3.7** `[reuse]` Reconcile rules in `reconcile-external.ts`: two-pass
  victim selection (skip user-slotted first, escalate if forced) + overlap →
  clear slot + `unslotted` change (copy: `A meeting landed on the time you
  set for {title}`). Extend `reconcile-external.test.ts` with: user slot
  survives a bump round, user slot bumped only when nothing else remains,
  overlap clears with narrated change.
- [x] **3.8** `[reuse]` `[ui]` `deck-change-brief.tsx`: render the
  `unslotted` kind (`The time you set for {title} was cleared. {reason}`).

### Ship checklist

- [x] `pnpm ts` and `pnpm test` clean, `pnpm smoke:boot` still resolves (new
  lazy imports must not drag the connectors runtime into the CLI boot graph).
- [x] `pnpm build` clean.
- [x] Deck regen on a calendar-connected day: slots render in strip, tab, and
  pills consistently, `get_day_shape` (orchestrator) matches the tab's gaps.
- [x] Kill network → HUD shows `Calendar unreachable`, tab shows stale dot,
  strip keeps last data. Reconnect → refresh recovers. *(Verified at the unit
  level: service status matrix + degraded-day tests; hudLabel error state
  test. Live pull-the-cable pass still worth one manual check.)*
- [x] Drag a task onto 2pm, regenerate the deck → the 2pm slot survives.
  Add a fake 2pm meeting, reconcile → slot cleared with a narrated change in
  the brief and the bumped/changes surfaces. *(Slot survival + overlap-clear
  verified by slot-provenance + reconcile tests against a real SQLite deck;
  placement + clear + undo verified live in the browser. The drag gesture
  itself can't be driven headless — one manual drag recommended.)*

---

## Retrenchment (2026-07-20, decided with Trey the same day the build shipped)

**Decision: the deck never goes on the calendar.** The placement layer (plan
ghosts, drag-to-slot, gap-fill placement, slot provenance, per-item
`slotStart/slotEnd/slotReason/slotSource`, the `unslotted` change kind) and
`tasks.estimatedMinutes` were removed within hours of shipping, deliberately.
This section records why, so future readers know it was a cut, not a gap.

**Why.**
1. **A slotted task is a fake event.** It looks like a commitment, behaves
   like a guess, and goes stale by mid-morning. The honest resolutions for a
   task's relationship with time are: soft → it lives in the ranked stack;
   hard → it becomes a real calendar event (future write-back). A shadow
   layer of dashed maybe-blocks is neither.
2. **Minute estimates are numeric scoring**, the exact judgment class
   `ux-first-principles.md` already killed `importance` and `rank_score`
   over. Estimates get falsified visibly every day and each miss debits
   trust from the whole deck. Empirically the field was unused (0 of 37
   active tasks had one), so all "time math" was a hardcoded 30 or model
   invention rendered with confident pixels.
3. **Seen with real data, the ghosts read as noise** — the generator slotted
   nearly every deck item across the day, exactly the auto-scheduling
   behavior (Motion/Reclaim) this product defines itself against.

**What replaced it.**
- **Effort bands** (`src/lib/deck/effort.ts`): the categorical `effort`
  label maps to deliberately rough minutes (trivial 15 → epic 240) for the
  two places that need fit math (deck sizing context, reconcile bumping).
  Copy says "roughly" because it is.
- **The pairing line** (`src/lib/calendar/pairing.ts`, rendered in the day
  strip): a pure code rule matching the current free stretch to the top deck
  task whose energy suits it ("4h clear until 6:00 PM · good window for X").
  No LLM at runtime, no durations, re-derived from the clock on every
  render — nothing can go stale.
- **Generation sizes, never schedules**: the deck prompt keeps the day-shape
  context for choosing how MUCH fits, and is now explicitly forbidden from
  assigning times.

**What survived unchanged** (the deterministic majority of the build): the
day-shape service, connectors enrichment, `get_day_shape` agent action, HUD
next-boundary button + peek, day strip (commitments + gaps + now line), day
view, week capacity view, mobile, reconcile's meeting-shrank-the-day bumping
(now on effort bands).

**The door left open.** AI-proposed time can return later as
suggestion-with-acceptance (propose 1-2 anchors, user accepts, acceptance
rate earns autonomy), most plausibly alongside rhythms and real-event
write-back. Instance-level auto-scheduling should not.

### Container decision (2026-07-20, same-day follow-up)

**Day lives in the panel, week lives in a large overlay.** The frequency
argument decided it: the product loop is today-shaped, so the day view is the
high-frequency companion surface and stays a panel tab (an hour axis fits a
half-width column, and side-by-side with the deck is its whole value — a
modal would reintroduce the context switch the feature exists to remove).
The week is a deliberate look-ahead moment, so the panel's Week button opens
`WeekOverlay` (a ~1200px dialog) directly — no cramped in-panel week exists
at all. Esc or clicking a day header drops back to that day in the panel.

**Week content is facts, not verdicts** (post-retrenchment): per-day mini
agenda of timed events, all-day chips, a slim capacity bar from real busy
time, and **deadline markers** — active tasks whose `hardDeadline` lands on
that day, rendered as amber flag chips that open the task. Deadlines are
recorded dates, not estimates, so they survive the retrenchment principle
while delivering the look-ahead value that made month view tempting. Month
stays dead.

**Follow-up (same day):** the overlay gained honest loading/error states (a
blank week and a loading week are different facts — skeleton columns while
fetching, an explicit failure message on error, `keepPreviousData` while
navigating weeks) and the 7-day range is prefetched when the HUD peek opens
or the panel mounts, so Week opens instantly. The HUD peek footer offers two
doors: **Day view** (navigates to the calendar tab — an explicit choice, so
the jump out of an execution is earned) and **Week view** (opens the overlay
in place over ANY surface, including ExecutionView — no navigation, Esc
returns exactly where you were). A day click inside the HUD-launched overlay
jumps the panel to that date via `calendar-store.ts` (the `openSettings`
pattern).

**Follow-up 2 (same day): the week got its hour grid.** The original "no week
hour grid" rule was justified by the half-width panel; once the week moved to
a wide overlay that constraint was dead, and the familiar-encoding argument
(the same one that won for the day view) applies to weeks too. The overlay
now has two persisted renderings of the same facts — **Grid** (hour-by-day,
shared gutter, overlap packing per day, now marker on today's column; the
default, for reading the week's shape) and **List** (the stacked per-day
agenda, denser when sparse). All-day chips and deadline markers live in a
pinned header row in grid mode.

**Geometry rule (learned the hard way):** time surfaces contain no pixel math
in JS. Columns are real CSS grid tracks (`grid-cols-[2.5rem_repeat(7,1fr)]`),
vertical positions are percentages of the track (`minutePct`/`windowPct` in
`layout.ts`), and each surface sets its hour scale once as a rem CSS variable
(`--hour-h`) with the track height `calc(hours * var(--hour-h))`. Intra-day
overlap columns are percentages of their day cell. JS reasons in minutes;
CSS owns every length.

**Follow-up 3 (copy + viewport):** HUD states say "scheduled," not
"meetings" (events aren't all meetings), and phrase as status, never
imperative ("Clear rest of day" read like an instruction to empty the
calendar). And the viewport rule got its principle: **workday bounds are a
work-capacity input** (deck sizing, free-minute math, capacity bars) and
must never clamp what the calendar shows — the calendar holds a life, not a
shift. Day and week tracks span the full 24 hours (`FULL_DAY_BOUNDS`);
`landingTopMinute` decides the top row: anchored at a civil 7 AM (or just
above an earlier first event), sliding down only when now + 2h of lookahead
no longer fits the measured viewport, with guards for early risers (now
never lands above the frame), evening-only browsed days (frame the first
event, not an empty morning), and the end of the day. The 9:00-18:00 defaults in
`user_state.workdayStart/End` remain the deliberately-deferred deck-sizing
placeholder from deck-proactive-spec — surfacing them as a user setting is a
small follow-up when wanted.

**Follow-up 4 (no calendar connected):** honest degradation was already
right (surfaces hide, deck sizes to manual minutes, `get_day_shape` returns
`no_providers`) — the gap was discovery. The rule: **invite once, where the
value would appear, dismiss forever; chrome never nags.** Three pieces: a
dismissible one-line invite in the deck strip's slot (`flow.calendar.inviteDismissed`,
permanent), a skippable Connect step in the onboarding wizard (calendar-only
scopes, Google + Microsoft), and the HUD stays silent until a calendar
exists. Supporting mechanics: `POST /connectors/connect` accepts a
same-origin `returnTo` parked in a short-lived HttpOnly cookie the callback
honors and clears (so onboarding OAuth returns to `/welcome`), and the
wizard persists state + step in sessionStorage to survive the OAuth
round trip.

**Follow-up 5 (revises follow-up 4):** the HUD no longer stays silent when
no calendar is connected — decided this is a key feature people would never
discover otherwise. The button renders as a dashed invitation ("Connect
your calendar") opening a small pitch popover with Connect and "Don't show
this again". Dismissal is ONE shared concept (`src/components/calendar/invite.ts`):
declining the invitation anywhere (HUD popover or deck strip X) hides it
everywhere, permanently, with a window event syncing mounted surfaces.
After dismissal the connect paths remain: onboarding, the calendar tab CTA,
and Settings.
