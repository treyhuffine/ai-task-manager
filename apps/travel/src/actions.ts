/**
 * Travel's action contract. Importing this module opens nothing: the build
 * imports it to generate contract.json. `initialize` opens the instance's
 * database inside the host-resolved data directory.
 */
import { z } from "zod/v4";
import { AppError } from "@ri/app-kit/contract";
import { allows, allowsAll, decodeCursor, encodeCursor, type AccessScope } from "@ri/app-kit/data";
import { defineAction, type ActionDefinition, type AppDefinition, type AppInvocation, type Bootstrap } from "@ri/app-kit/sdk";
import { formatDate } from "@ri/app-kit/time";
import * as s from "./actions/schemas.js";
import * as ex from "./actions/examples.js";
import { MANUAL_SOURCE } from "./domain/model.js";
import { seedFixtures } from "./fixtures/seed.js";
import { openTravel, type Travel } from "./services/core.js";
import { createFollowUps } from "./services/followups.js";
import { createImports } from "./services/imports.js";
import { reviewVisible } from "./services/ingest.js";
import { clip, createReadModel, priceLabel } from "./services/records.js";
import { createSources, requireOwner } from "./services/sources.js";
import { createSync } from "./services/sync.js";
import { createView, scopedRevision } from "./services/view.js";
import { createWrites } from "./services/writes.js";

export const RESOURCE = "ui://ri-travel/main.html" as const;

/** defineAction with types taken from the schemas: parsed input for the handler, raw input for examples. */
type Def<S extends z.ZodType, O extends z.ZodType> = Omit<ActionDefinition<z.output<S>, z.output<O>>, "input" | "output" | "examples" | "handler"> & {
  input: S;
  output: O;
  examples: { input: z.input<S>; output: z.output<O> }[];
  handler(input: z.output<S>, invocation: AppInvocation): z.output<O> | Promise<z.output<O>>;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const act = <S extends z.ZodType, O extends z.ZodType>(def: Def<S, O>) => defineAction(def as unknown as ActionDefinition<any, any>);

function build(t: Travel) {
  return { t, read: createReadModel(t), writes: createWrites(t), sync: createSync(t), sources: createSources(t), view: createView(t), followUps: createFollowUps(t), imports: createImports(t) };
}
let services: ReturnType<typeof build> | null = null;
export async function initialize(boot: Bootstrap, options: { now?: () => Date } = {}) {
  const t = await openTravel(boot.dataDir, boot.instanceId, options);
  t.jobs.recover();
  services = build(t);
}
export function shutdown() {
  services?.t.close();
  services = null;
}
/** For tests: the opened instance. */
export function instance() {
  return app().t;
}
function app() {
  if (!services) throw new AppError("app_failed", "Travel is not ready yet");
  return services;
}

const READ_ERRORS = ["invalid_input", "not_found", "forbidden", "revoked"] as const;
const WRITE_ERRORS = ["invalid_input", "not_found", "forbidden", "revoked", "conflict"] as const;
const both = ["user", "agent"] as ("user" | "agent")[];
const userOnly = ["user"] as "user"[];
const listCoverage = (complete: boolean, note: string | null = null) => ({ complete, note });

function page<T>(items: T[], cursor: string | undefined, limit: number) {
  const start = decodeCursor(z.object({ o: z.number().int().min(0) }).strict(), cursor)?.o ?? 0;
  const slice = items.slice(start, start + limit);
  return { items: slice, nextCursor: start + limit < items.length ? encodeCursor({ o: start + limit }) : null };
}
function scopeOf(invocation: AppInvocation, operation: "read" | "write") {
  return app().t.resolve(invocation, operation);
}

// ─── View and context ───────────────────────────────────────────────────────

const VIEW_ACTIONS = [
  "list_trips", "get_trip", "save_trip", "list_bookings", "get_booking", "save_booking", "delete_booking", "list_ideas", "save_idea", "compare_ideas",
  "list_review_items", "review_change", "dismiss_gap", "create_follow_up", "list_follow_ups", "check_follow_up", "preview_import", "apply_import", "get_evidence",
  "export_trip", "list_sources", "setup_source", "list_calendars", "pause_source", "delete_source_data", "continue_import", "list_scopes", "revoke_scope", "save_settings", "remember_view",
];
const READER_ACTIONS = ["list_trips", "get_trip", "list_bookings", "get_booking", "list_ideas", "compare_ideas", "list_review_items", "list_follow_ups", "get_evidence"];

const openView = act({
  name: "open_view",
  description: "Open the Travel view at a path such as /, /trips/<id>, /bookings/<id>, /review, /sources or /access. Returns small setup data and a revision that changes when records change. Opening never starts an import.",
  input: s.openViewInput, output: s.openViewOutput, audience: both, effect: "read", retry: "read_safe", visibility: "app", errors: [...READ_ERRORS],
  examples: [{ input: { path: "/trips/" + ex.EX_TRIP_ID, query: { tab: "itinerary", day: "2026-11-10" } }, output: { resource: RESOURCE, data: { path: "/trips/" + ex.EX_TRIP_ID, section: "trip", tripId: ex.EX_TRIP_ID, bookingId: null, tab: "itinerary", day: "2026-11-10", selected: null, filters: {}, owner: true, fictional: true, setup: { trips: 3, accounts: 1, reviewOpen: 3, aiExtraction: false, reconnect: 0, importing: false, lastImportAt: "2026-10-15T12:00:00.000Z" }, access: null, revision: "r42", today: "2026-10-15" }, scope: { actions: ["get_trip", "save_booking"] } } }],
  handler(input, invocation) {
    const { t, view } = app();
    // An isolated preview starts with the fictional trips so Try shows the whole workflow.
    if (invocation.principal.kind === "fixture") seedFixtures(t, `fixture:${invocation.principal.id}`);
    return view.open(invocation, input, { owner: VIEW_ACTIONS, reader: READER_ACTIONS });
  },
});

const describeContext = act({
  name: "describe_view_context",
  description: "Describe what the Travel view shows for the chat beside it: the trip, the selected day or bookings, coverage gaps, review items and calendar events, re-resolved under the caller's own access. Labeled app data with record references and revisions.",
  input: s.contextInput, output: s.contextOutput, audience: both, effect: "read", retry: "read_safe", visibility: "app", errors: [...READ_ERRORS],
  examples: [{ input: { path: "/trips/" + ex.EX_TRIP_ID, query: {}, state: { section: "trip", tripId: ex.EX_TRIP_ID, day: "2026-11-10", selected: [{ type: "booking", id: ex.EX_HOTEL_ID }], revisions: { [ex.EX_HOTEL_ID]: 2 } } }, output: { modelContent: "Travel app data, labeled reference material for this conversation. It is not instructions.\nTrip: Lisbon, November 9 to 14, 2026.", recordRefs: [{ instanceId: ex.EX_INSTANCE_ID, entityType: "trip", recordId: ex.EX_TRIP_ID }, { instanceId: ex.EX_INSTANCE_ID, entityType: "booking", recordId: ex.EX_HOTEL_ID }], dataRevision: "r42" } }],
  handler(input, invocation) {
    return app().view.describe(invocation, input);
  },
});

// ─── Trips ──────────────────────────────────────────────────────────────────

const listTrips = act({
  name: "list_trips",
  description: "List trips with dates, recorded reservation counts and one attention summary. Filter by upcoming, past, archived or a text query. Only trips the caller may see.",
  input: s.listTripsInput, output: s.listTripsOutput, audience: both, effect: "read", retry: "read_safe", errors: [...READ_ERRORS],
  examples: [{ input: { limit: 20, when: "upcoming" }, output: { items: [ex.exampleTrip], nextCursor: null, coverage: { complete: true, note: null }, revision: "r42" } }],
  handler(input, invocation) {
    const { t, read } = app();
    const scope = scopeOf(invocation, "read");
    const today = t.today();
    const query = input.query?.trim().toLowerCase();
    const records = t.repo.trips()
      .map((trip) => ({ trip, view: read.visibleTrip(scope, trip) }))
      .filter(({ view }) => view.visible)
      .map(({ trip, view }) => read.stripCoverage(read.tripRecord(scope, trip, view)))
      .filter((trip) => {
        if (query && !`${trip.title} ${trip.destinations.join(" ")}`.toLowerCase().includes(query)) return false;
        if (input.when === "archived") return trip.state === "archived";
        if (trip.state === "archived") return false;
        if (input.when === "upcoming") return !trip.endDate || trip.endDate >= today;
        if (input.when === "past") return !!trip.endDate && trip.endDate < today;
        return true;
      });
    const upcoming = records.filter((trip) => !trip.endDate || trip.endDate >= today).sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999"));
    const past = records.filter((trip) => trip.endDate && trip.endDate < today).sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
    const result = page([...upcoming, ...past], input.cursor, input.limit);
    return { ...result, coverage: listCoverage(true), revision: scopedRevision(t, scope) };
  },
});

const getTrip = act({
  name: "get_trip",
  description: "Read one trip: the chronological itinerary by local date with zone labels, every recorded booking with sources and coverage, night coverage and overlap checks, open review items, calendar events during the trip and linked Ri follow-ups.",
  input: s.getTripInput, output: s.tripDetailSchema, audience: both, effect: "read", retry: "read_safe", errors: [...READ_ERRORS],
  examples: [{ input: { id: ex.EX_TRIP_ID }, output: ex.exampleDetail }],
  handler(input, invocation) {
    const { t, read } = app();
    const scope = scopeOf(invocation, "read");
    const trip = t.repo.trip(input.id);
    if (!trip || !read.visibleTrip(scope, trip).visible) throw new AppError("not_found", "That trip is no longer available");
    return { ...read.tripDetail(scope, trip), revision: scopedRevision(t, scope) };
  },
});

const saveTrip = act({
  name: "save_trip",
  description: "Create a trip, or rename it, set inclusive trip dates, home time zone, travelers and notes, or archive it. Updates need the revision you edited and return the current trip on conflict.",
  input: s.saveTripInput, output: s.writeTrip, audience: both, effect: "app_write", retry: "idempotent", errors: [...WRITE_ERRORS],
  examples: [{ input: { id: ex.EX_TRIP_ID, expectedRevision: 3, startDate: "2026-11-09", endDate: "2026-11-15" }, output: { status: "saved", record: { ...ex.exampleTrip, revision: 4, endDate: "2026-11-15", dateLabel: "November 9 to 15, 2026", datesSource: "manual" } } }],
  handler(input, invocation) {
    const { t, writes } = app();
    const scope = scopeOf(invocation, "write");
    return t.store.mutate(invocation, "save_trip", input, () => writes.saveTrip(scope, t.actor(invocation), input));
  },
});

// ─── Bookings ───────────────────────────────────────────────────────────────

function bookingFilter(scope: AccessScope, input: z.infer<typeof s.listBookingsInput>) {
  const { t } = app();
  let bookings = t.repo.bookings(scope, input.unassigned ? { tripId: null } : input.tripId ? { tripId: input.tripId } : {});
  if (input.query?.trim()) {
    const ids = new Set(t.repo.searchBookingIds(scope, input.query));
    bookings = bookings.filter((booking) => ids.has(booking.id));
  }
  if (input.kind !== "all") bookings = bookings.filter((booking) => booking.kind === input.kind);
  if (input.status === "needs_review") {
    const open = new Set(t.repo.reviews({ open: true }).filter((item) => reviewVisible(scope, item, t.repo)).flatMap((item) => (item.bookingId ? [item.bookingId] : [])));
    bookings = bookings.filter((booking) => open.has(booking.id));
  } else if (input.status !== "all") bookings = bookings.filter((booking) => booking.status === input.status);
  return bookings;
}

const listBookings = act({
  name: "list_bookings",
  description: "List recorded bookings in chronological order, for one trip, unassigned, or across trips. Filter by status (confirmed, planned, canceled, needs review), kind or a text query over titles, providers, references, travelers and places. Every booking includes its source references and coverage.",
  input: s.listBookingsInput, output: s.listBookingsOutput, audience: both, effect: "read", retry: "read_safe", errors: [...READ_ERRORS],
  examples: [{ input: { tripId: ex.EX_TRIP_ID, limit: 50, status: "all", kind: "all" }, output: { items: [ex.exampleFlight, ex.exampleHotel], nextCursor: null, coverage: { complete: true, note: null }, revision: "r42" } }],
  handler(input, invocation) {
    const { t, read } = app();
    const scope = scopeOf(invocation, "read");
    const labels = read.accountLabels();
    const all = bookingFilter(scope, input);
    const result = page(all, input.cursor, input.limit);
    return { items: result.items.map((booking) => read.bookingRecord(scope, booking, { labels })), nextCursor: result.nextCursor, coverage: listCoverage(true, input.query ? "Search covers recorded bookings. A reservation that was never imported cannot appear." : null), revision: scopedRevision(t, scope) };
  },
});

const getBooking = act({
  name: "get_booking",
  description: "Read one booking with its segments or stay, local times and zones, corrections beside source values, every source reference, its change history, open review items and linked follow-ups.",
  input: s.getBookingInput, output: s.bookingDetailSchema, audience: both, effect: "read", retry: "read_safe", errors: [...READ_ERRORS],
  examples: [{ input: { id: ex.EX_HOTEL_ID }, output: { booking: ex.exampleHotel, changes: [{ id: "4f1c2d3e-0000-4000-8000-00000000000f", at: "2026-10-14T10:00:00.000Z", kind: "corrected", fields: [{ field: "stay.checkInTime", label: "Check-in time", before: "14:00", after: "15:00" }], note: "Corrected by you.", actorLabel: "You", source: null }], review: [ex.exampleReview], followUps: [], directionsAddress: "Rua da Prata 112, 1100-420 Lisbon, Portugal", revision: "r42" } }],
  handler(input, invocation) {
    const { t, read } = app();
    const scope = scopeOf(invocation, "read");
    const booking = t.repo.booking(input.id);
    if (!booking || !allowsAll(scope, booking.sourceKeys)) throw new AppError("not_found", "That booking is no longer available");
    const changes = t.repo.changes(booking.id).filter((change) => change.sourceKey === MANUAL_SOURCE || allows(scope, change.sourceKey)).slice(-200).map((change) => {
      const evidence = change.evidenceId ? t.repo.evidence(change.evidenceId) : null;
      return {
        id: change.id, at: change.createdAt, kind: change.kind, fields: change.fields.slice(0, 60).map((field) => ({ field: clip(field.field, 60), label: clip(field.label, 80), before: clip(field.before, 400), after: clip(field.after, 400) })),
        note: change.note ? clip(change.note, 600) : null,
        actorLabel: change.actor.startsWith("owner-ui:") || change.actor.startsWith("fixture:") ? (change.kind === "corrected" || change.kind === "edited" || change.kind === "moved" || change.kind === "kept" || change.kind === "correction_removed" ? "You" : "Travel") : change.actor.startsWith("job:") ? "Automatic update" : change.actor.startsWith("chat:") ? "A chat" : "Travel",
        source: evidence && allows(scope, evidence.sourceKey) ? { evidenceId: evidence.id, title: clip(evidence.title, 300) } : null,
      };
    });
    const review = t.repo.reviews({ bookingId: booking.id, open: true }).filter((item) => reviewVisible(scope, item, t.repo)).map((item) => read.reviewRecord(scope, item));
    const followUps = t.repo.followUps({ subjectType: "booking", subjectId: booking.id }).filter((row) => allows(scope, row.sourceKey)).map(read.followUpRecord);
    const address = booking.stay?.address ?? booking.segments.find((segment) => segment.address)?.address ?? null;
    return { booking: read.bookingRecord(scope, booking), changes, review, followUps, directionsAddress: address ? clip(address, 400) : null, revision: scopedRevision(t, scope) };
  },
});

const saveBooking = act({
  name: "save_booking",
  description: "Add a booking by hand, or correct one. A correction to an imported booking is saved beside the original value and survives later imports. Also moves a booking between trips without losing sources or corrections, and clears corrections. Updates need the revision you edited.",
  input: s.saveBookingInput, output: s.writeBooking, audience: both, effect: "app_write", retry: "idempotent", errors: [...WRITE_ERRORS],
  examples: [{ input: { id: ex.EX_HOTEL_ID, expectedRevision: 1, patch: { stay: { checkInTime: "15:00" } } }, output: { status: "saved", record: ex.exampleHotel } }],
  handler(input, invocation) {
    const { t, writes } = app();
    const scope = scopeOf(invocation, "write");
    return t.store.mutate(invocation, "save_booking", input, () => writes.saveBooking(scope, t.actor(invocation), input));
  },
});

const deleteBooking = act({
  name: "delete_booking",
  description: "Remove a booking from Travel. Its sources stay recorded. Needs the revision you saw.",
  input: s.deleteBookingInput, output: s.deleteOutput, audience: userOnly, effect: "app_write", retry: "idempotent", errors: [...WRITE_ERRORS],
  examples: [{ input: { id: ex.EX_FLIGHT_ID, expectedRevision: 2 }, output: { status: "deleted", id: ex.EX_FLIGHT_ID } }],
  handler(input, invocation) {
    const { t, writes } = app();
    const scope = scopeOf(invocation, "write");
    return t.store.mutate(invocation, "delete_booking", input, () => writes.deleteBooking(scope, t.actor(invocation), input));
  },
});

// ─── Ideas ──────────────────────────────────────────────────────────────────

const listIdeas = act({
  name: "list_ideas",
  description: "List saved ideas for a trip. Ideas are visibly unbooked and never count as confirmed bookings. Prices are as observed, in integer minor units with their currency.",
  input: s.listIdeasInput, output: s.listIdeasOutput, audience: both, effect: "read", retry: "read_safe", errors: [...READ_ERRORS],
  examples: [{ input: { tripId: ex.EX_TRIP_ID, limit: 50 }, output: { items: [ex.exampleIdea, ex.exampleIdea2], nextCursor: null, coverage: { complete: true, note: null }, revision: "r42" } }],
  handler(input, invocation) {
    const { t, read } = app();
    const scope = scopeOf(invocation, "read");
    const ideas = t.repo.ideas(scope, input.tripId ? { tripId: input.tripId } : {});
    const result = page(ideas, input.cursor, input.limit);
    return { items: result.items.map(read.ideaRecord), nextCursor: result.nextCursor, coverage: listCoverage(true), revision: scopedRevision(t, scope) };
  },
});

const saveIdea = act({
  name: "save_idea",
  description: "Save an idea for a trip, or update or remove one: title, note, an optional https source link, an observed price in integer minor units with its currency, location and check-in conditions. Ideas are never bookings.",
  input: s.saveIdeaInput, output: s.writeIdea, audience: both, effect: "app_write", retry: "idempotent", errors: [...WRITE_ERRORS],
  examples: [{ input: { tripId: ex.EX_TRIP_ID, kind: "activity", title: "Sintra day tour", priceMinor: 6500, currency: "EUR", url: "https://tours.example/sintra-day" }, output: { status: "saved", record: ex.exampleIdea } }],
  handler(input, invocation) {
    const { t, writes } = app();
    const scope = scopeOf(invocation, "write");
    return t.store.mutate(invocation, "save_idea", input, () => writes.saveIdea(scope, input));
  },
});

const compareIdeas = act({
  name: "compare_ideas",
  description: "Compare two to four saved ideas side by side: known price and currency, location, check-in conditions and source date. Unknown values say Not provided. Prices in different currencies are never converted or added. No ratings or rankings.",
  input: s.compareIdeasInput, output: s.compareOutput, audience: both, effect: "read", retry: "read_safe", errors: [...READ_ERRORS],
  examples: [{ input: { ids: [ex.EX_IDEA_ID, ex.EX_IDEA_2_ID] }, output: { ideas: [ex.exampleIdea, ex.exampleIdea2], rows: [{ label: "Price", values: ["EUR 65.00", "EUR 12.50"] }, { label: "Location", values: ["Sintra", "Sintra"] }], currencies: ["EUR"], note: "Prices are as observed on the source date. Ideas are not bookings." } }],
  handler(input, invocation) {
    const { t, read } = app();
    const scope = scopeOf(invocation, "read");
    const ideas = input.ids.map((id) => {
      const idea = t.repo.idea(id);
      if (!idea || idea.removedAt || !allows(scope, idea.sourceKey)) throw new AppError("not_found", "One of these ideas is no longer available");
      return read.ideaRecord(idea);
    });
    const given = (value: string | null | undefined) => (value && value.trim() ? clip(value, 500) : "Not provided");
    const rows = [
      { label: "Price", values: ideas.map((idea) => priceLabel(idea.priceMinor, idea.currency)) },
      { label: "Location", values: ideas.map((idea) => given(idea.location)) },
      { label: "Check-in and conditions", values: ideas.map((idea) => given(idea.conditions)) },
      { label: "Source date", values: ideas.map((idea) => (idea.observedAt ? formatDate(idea.observedAt.slice(0, 10), "medium") : "Not provided")) },
      { label: "Source", values: ideas.map((idea) => given(idea.sourceLabel)) },
      { label: "Note", values: ideas.map((idea) => given(idea.note)) },
    ];
    const currencies = [...new Set(ideas.map((idea) => idea.currency).filter((value): value is string => !!value))];
    const note = currencies.length > 1 ? `Prices are in ${currencies.join(" and ")}. They are not converted or added together. Ideas are not bookings.` : "Prices are as observed on the source date. Ideas are not bookings.";
    return { ideas, rows, currencies, note };
  },
});

// ─── Review and coverage ────────────────────────────────────────────────────

const listReview = act({
  name: "list_review_items",
  description: "List items waiting in Review: unassigned reservations, changes and cancellations to confirm, possible duplicates and extracted details to check. Each item compares current and proposed values with its sources.",
  input: s.listReviewInput, output: s.listReviewOutput, audience: both, effect: "read", retry: "read_safe", errors: [...READ_ERRORS],
  examples: [{ input: { limit: 50, state: "open" }, output: { items: [ex.exampleReview], nextCursor: null, coverage: { complete: true, note: null }, revision: "r42" } }],
  handler(input, invocation) {
    const { t, read } = app();
    const scope = scopeOf(invocation, "read");
    const items = t.repo.reviews({ open: input.state === "open", tripId: input.tripId, limit: 1000 }).filter((item) => (input.state !== "decided" || !!item.decision) && reviewVisible(scope, item, t.repo));
    if (input.state === "decided") items.reverse();
    const result = page(items, input.cursor, input.limit);
    const labels = read.accountLabels();
    return { items: result.items.map((item) => read.reviewRecord(scope, item, labels)), nextCursor: result.nextCursor, coverage: listCoverage(true), revision: scopedRevision(t, scope) };
  },
});

const reviewChange = act({
  name: "review_change",
  description: "Decide a review item: accept a change or keep current values, assign a reservation to a trip or start a new one, link a possible duplicate or keep it separate, confirm extracted details, or dismiss. Needs the item's revision.",
  input: s.reviewChangeInput, output: s.writeReview, audience: userOnly, effect: "app_write", retry: "idempotent", errors: [...WRITE_ERRORS],
  examples: [{ input: { id: ex.EX_REVIEW_ID, expectedRevision: 1, decision: "accept" }, output: { status: "saved", record: { ...ex.exampleReview, revision: 2, decision: "accept", decidedAt: "2026-10-15T10:00:00.000Z" }, bookingId: ex.EX_HOTEL_ID, tripId: ex.EX_TRIP_ID, message: "Riverside House now uses the newer details." } }],
  handler(input, invocation) {
    const { t, writes } = app();
    const scope = scopeOf(invocation, "write");
    return t.store.mutate(invocation, "review_change", input, () => writes.reviewChange(scope, t.actor(invocation), input));
  },
});

const dismissGap = act({
  name: "dismiss_gap",
  description: "Dismiss a coverage prompt, such as a night with no booking recorded when staying with friends. The dismissal holds until the bookings around it change. Pass restore to show it again.",
  input: s.dismissGapInput, output: s.dismissGapOutput, audience: both, effect: "app_write", retry: "idempotent", errors: [...WRITE_ERRORS],
  examples: [{ input: { tripId: ex.EX_TRIP_ID, key: "night:2026-11-12", fingerprint: "0123456789abcdef0123456789abcdef" }, output: { status: "saved", coverage: ex.exampleDetail.coverage } }],
  handler(input, invocation) {
    const { t, writes } = app();
    const scope = scopeOf(invocation, "write");
    return t.store.mutate(invocation, "dismiss_gap", input, () => writes.dismissGap(scope, t.actor(invocation), input));
  },
});

// ─── Follow-ups ─────────────────────────────────────────────────────────────

const createFollowUp = act({
  name: "create_follow_up",
  description: "Create one Ri task linked to a trip, booking, idea or review item, with an optional due date. Pass the same operationId on a retry or second click to get the same task. Nothing is sent to anyone.",
  input: s.createFollowUpInput, output: s.followUpOutput, audience: both, effect: "app_write", retry: "idempotent", timeoutMs: 30_000, errors: [...WRITE_ERRORS, "approval_required"],
  examples: [{ input: { subject: { type: "trip", id: ex.EX_TRIP_ID }, title: "Arrange the airport transfer in Lisbon", dueAt: "2026-11-02", operationId: ex.EX_OPERATION_ID }, output: { status: "created", followUp: ex.exampleFollowUp, message: "Created one Ri task linked to this record." } }],
  async handler(input, invocation) {
    const { followUps } = app();
    return followUps.create(invocation, scopeOf(invocation, "write"), input);
  },
});

const listFollowUps = act({
  name: "list_follow_ups",
  description: "List Ri follow-ups linked from Travel, with their last known task availability.",
  input: s.listFollowUpsInput, output: s.listFollowUpsOutput, audience: both, effect: "read", retry: "read_safe", errors: [...READ_ERRORS],
  examples: [{ input: { subjectId: ex.EX_TRIP_ID, limit: 50 }, output: { items: [ex.exampleFollowUp], nextCursor: null, coverage: { complete: true, note: null }, revision: "r42" } }],
  handler(input, invocation) {
    const { t, followUps } = app();
    const scope = scopeOf(invocation, "read");
    const result = page(followUps.list(scope, input.subjectId), input.cursor, input.limit);
    return { ...result, coverage: listCoverage(true), revision: scopedRevision(t, scope) };
  },
});

const checkFollowUp = act({
  name: "check_follow_up",
  description: "Check whether a linked Ri task still exists and record its availability.",
  input: s.checkFollowUpInput, output: s.followUpSchema, audience: both, effect: "app_write", retry: "idempotent", errors: [...READ_ERRORS],
  examples: [{ input: { id: ex.EX_FOLLOW_UP_ID }, output: ex.exampleFollowUp }],
  async handler(input, invocation) {
    return app().followUps.check(invocation, scopeOf(invocation, "write"), input.id);
  },
});

// ─── Import ─────────────────────────────────────────────────────────────────

const previewImport = act({
  name: "preview_import",
  description: "Read a chosen file (PDF, text, HTML or saved email) or pasted confirmation and preview the bookings found, their source passages, matching bookings and trip placement. Nothing changes until apply_import.",
  input: s.previewImportInput, output: s.previewOutput, audience: userOnly, effect: "app_write", retry: "idempotent", timeoutMs: 60_000, errors: [...WRITE_ERRORS],
  examples: [{ input: { kind: "paste", text: "Booking reference: RH-4821\nCheck-in: Tue, Nov 10, 2026 (from 15:00)\nCheck-out: Sat, Nov 14, 2026" }, output: { previewId: ex.EX_PREVIEW_ID, digest: ex.EX_DIGEST, expiresAt: "2026-10-15T11:00:00.000Z", fileName: null, characters: 86, truncated: false, forwarded: false, items: [{ item: 0, draft: { kind: "lodging", title: "Riverside House", reference: "RH-4821", travelers: [], status: "confirmed", stay: { propertyName: "Riverside House", checkInDate: "2026-11-10", checkOutDate: "2026-11-14", checkInTime: "15:00" } }, summary: "Riverside House, November 10 to 14, 2026, confirmation RH-4821", kindLabel: "Stay", complete: true, missing: ["travelers"], ambiguous: [], passages: ["Booking reference: RH-4821"], cancellation: false, change: false, match: null, suggestedTripId: ex.EX_TRIP_ID, suggestedTripTitle: "Lisbon", placement: "Adds to Lisbon." }], notes: [], excerpt: "Booking reference: RH-4821", trips: [{ id: ex.EX_TRIP_ID, title: "Lisbon", dateLabel: "November 9 to 14, 2026" }], extraction: "deterministic" } }],
  async handler(input, invocation) {
    return app().imports.preview(invocation, scopeOf(invocation, "write"), input);
  },
});

const applyImport = act({
  name: "apply_import",
  description: "Apply exactly the stored preview once, by preview ID and digest. Adds or updates the matching bookings, places them in trips and sends anything uncertain to Review. A repeat returns the first result.",
  input: s.applyImportInput, output: s.applyOutput, audience: userOnly, effect: "app_write", retry: "idempotent", errors: [...WRITE_ERRORS],
  examples: [{ input: { previewId: ex.EX_PREVIEW_ID, digest: ex.EX_DIGEST }, output: { status: "applied", evidenceId: ex.EX_EVIDENCE_ID, outcomes: [{ item: 0, action: "created", bookingId: ex.EX_HOTEL_ID, tripId: ex.EX_TRIP_ID, reviewId: null, message: "Riverside House was added." }], openTripId: ex.EX_TRIP_ID, message: "Added 1 booking" } }],
  handler(input, invocation) {
    return app().imports.apply(invocation, scopeOf(invocation, "write"), input);
  },
});

const getEvidence = act({
  name: "get_evidence",
  description: "Read a retained source: the excerpt kept from the original confirmation, its availability and the bookings it supports.",
  input: s.getEvidenceInput, output: s.evidenceDetailSchema, audience: both, effect: "read", retry: "read_safe", errors: [...READ_ERRORS],
  examples: [{ input: { id: ex.EX_EVIDENCE_ID }, output: { source: ex.exampleHotel.sources[0], excerpt: "Booking reference: RH-4821\nCheck-in: Tue, Nov 10, 2026 (from 14:00)", truncated: false, passages: ["Booking reference: RH-4821"], fileName: null, mimeType: "message/rfc822", note: null, openUrl: null, bookings: [{ id: ex.EX_HOTEL_ID, title: "Riverside House" }] } }],
  handler(input, invocation) {
    const { t, read } = app();
    const scope = scopeOf(invocation, "read");
    const evidence = t.repo.evidence(input.id);
    if (!evidence || !allows(scope, evidence.sourceKey)) throw new AppError("not_found", "That source is no longer available");
    const text = evidence.textBlob ? t.blobs.readText(evidence.textBlob) ?? "" : "";
    const links = t.repo.linksForEvidence(evidence.id);
    const bookings = links.map((link) => t.repo.booking(link.bookingId)).filter((booking): booking is NonNullable<typeof booking> => !!booking && allowsAll(scope, booking.sourceKeys));
    const account = evidence.account ? t.accounts.get(evidence.account, "mail") : null;
    const address = account?.checkpoint && typeof account.checkpoint === "object" ? (account.checkpoint as { emailAddress?: string | null }).emailAddress ?? null : null;
    const messageId = evidence.messageIdHeader?.replace(/^<|>$/g, "");
    const openUrl = evidence.origin === "gmail" && messageId && evidence.availability === "available" ? `https://mail.google.com/mail/${address ? `?authuser=${encodeURIComponent(address)}` : ""}#search/rfc822msgid%3A${encodeURIComponent(messageId)}` : null;
    return {
      source: read.sourceRef({ role: links[0]?.role ?? "linked", evidence }, read.accountLabels()),
      excerpt: clip(text || evidence.excerpt || "", 8000), truncated: text.length > 8000,
      passages: (evidence.excerpt ?? "").split("\n").filter(Boolean).slice(0, 20).map((line) => clip(line, 600)),
      fileName: evidence.fileName ? clip(evidence.fileName, 200) : null, mimeType: evidence.mimeType,
      note: evidence.availability === "unavailable" ? "Source unavailable. The original was deleted or moved to Trash. This excerpt was retained when it was imported." : evidence.fictional ? "Fictional example source." : evidence.parseNote ? clip(evidence.parseNote, 300) : null,
      openUrl: openUrl && openUrl.length <= 500 ? openUrl : null,
      bookings: bookings.slice(0, 20).map((booking) => ({ id: booking.id, title: clip(booking.title, 200) })),
    };
  },
});

const exportTrip = act({
  name: "export_trip",
  description: "Export one trip's itinerary, bookings and ideas as JSON or CSV for a human download. Local times keep their zones.",
  input: s.exportTripInput, output: s.exportOutput, audience: userOnly, effect: "read", retry: "read_safe", errors: [...READ_ERRORS],
  examples: [{ input: { id: ex.EX_TRIP_ID, format: "csv" }, output: { fileName: "travel-lisbon.csv", mimeType: "text/csv", text: "\"Date\",\"Time\"\n\"2026-11-10\",\"08:40\"\n", records: 1 } }],
  handler(input, invocation) {
    return app().view.exportTrip(scopeOf(invocation, "read"), input.id, input.format);
  },
});

// ─── Sources and scopes ─────────────────────────────────────────────────────

const listSources = act({
  name: "list_sources",
  description: "List mail and calendar accounts granted to Travel with history range, coverage, last update, pending and failed counts, plus imported files, collections and data shared with chats.",
  input: z.object({}).strict(), output: s.listSourcesOutput, audience: userOnly, effect: "read", retry: "read_safe", visibility: "app", errors: [...READ_ERRORS],
  examples: [{ input: {}, output: { accounts: [ex.exampleSourceAccount], imports: [], collections: [{ key: "manual", label: "Manual entries and ideas", records: 2 }, { key: "imports", label: "Uploaded and pasted confirmations", records: 0 }], shares: [], settings: { homeZone: "America/Denver", ownerNames: ["Alex Rivera"], aiExtraction: false }, mailQuery: "{subject:confirmation} -category:promotions", note: "Search is a relevance filter.", revision: "r42" } }],
  handler(_input, invocation) {
    requireOwner(scopeOf(invocation, "read"));
    return app().sources.list(invocation);
  },
});

const setupSource = act({
  name: "setup_source",
  description: "Choose the mail history range (30, 90 or 365 days) or the calendars to check for a granted account. A wider range resumes import for the older mail only.",
  input: s.setupSourceInput, output: s.okOutput, audience: userOnly, effect: "app_write", retry: "idempotent", visibility: "app", errors: [...WRITE_ERRORS],
  examples: [{ input: { account: "conn-fictional-1", kind: "mail", historyDays: 365 }, output: { status: "saved" } }],
  handler(input, invocation) {
    const { t, sources } = app();
    requireOwner(scopeOf(invocation, "write"));
    return t.store.mutate(invocation, "setup_source", input, () => sources.setup(invocation, input));
  },
});

const listCalendarsAction = act({
  name: "list_calendars",
  description: "List the calendars of a granted calendar account so the owner can choose which to check for trip conflicts.",
  input: z.object({ account: z.string().min(1).max(128) }).strict(), output: s.calendarsOutput, audience: userOnly, effect: "read", retry: "read_safe", visibility: "app", errors: [...READ_ERRORS, "busy", "timeout"],
  examples: [{ input: { account: "conn-fictional-1" }, output: { calendars: [{ id: "primary", summary: "Alex Rivera", primary: true }], chosen: ["primary"] } }],
  async handler(input, invocation) {
    requireOwner(scopeOf(invocation, "read"));
    return app().sources.calendars(invocation, input.account);
  },
});

const pauseSource = act({
  name: "pause_source",
  description: "Pause or resume automatic updates for an account. Imported records stay readable.",
  input: s.pauseSourceInput, output: s.okOutput, audience: userOnly, effect: "app_write", retry: "idempotent", visibility: "app", errors: [...WRITE_ERRORS],
  examples: [{ input: { account: "conn-fictional-1", paused: true }, output: { status: "saved" } }],
  handler(input, invocation) {
    const { t, sources } = app();
    requireOwner(scopeOf(invocation, "write"));
    return t.store.mutate(invocation, "pause_source", input, () => sources.pause(input.account, input.paused));
  },
});

const deleteSourceData = act({
  name: "delete_source_data",
  description: "Delete what Travel imported from one account (account:<id>), from all files (imports) or from one file (import:<id>): its bookings, sources, search entries and calendar events. Notes you wrote are kept. The account is paused so nothing re-imports.",
  input: s.deleteSourceInput, output: s.deleteSourceOutput, audience: userOnly, effect: "app_write", retry: "idempotent", visibility: "app", errors: [...WRITE_ERRORS],
  examples: [{ input: { source: "account:conn-fictional-1" }, output: { status: "deleted", source: "account:conn-fictional-1", bookings: 4, evidence: 6, keptNotes: 0 } }],
  handler(input, invocation) {
    const { t, sources } = app();
    requireOwner(scopeOf(invocation, "write"));
    return t.store.mutate(invocation, "delete_source_data", input, () => sources.deleteImported(input.source));
  },
});

const continueImport = act({
  name: "continue_import",
  description: "Run the next bounded import step for one granted account now, with the same limits as the automatic schedule: one mail page with at most ten messages read, or one calendar page.",
  input: s.continueImportInput, output: s.continueOutput, audience: userOnly, effect: "app_write", retry: "idempotent", timeoutMs: 40_000, visibility: "app", errors: [...WRITE_ERRORS, "busy", "timeout"],
  examples: [{ input: { source: "account:conn-fictional-1", kind: "mail" }, output: { step: ex.exampleStep, source: ex.exampleSourceAccount } }],
  async handler(input, invocation) {
    const { sync, sources } = app();
    requireOwner(scopeOf(invocation, "write"));
    const account = input.source.slice("account:".length);
    const step = await sync.step(invocation, { only: { account, kind: input.kind } });
    const grant = (invocation.access?.accounts ?? []).find((item) => item.account === account && item.binding === input.kind);
    return { step, source: sources.accountRecord(account, input.kind, grant ? { automatic: grant.automatic } : null) };
  },
});

const createScope = act({
  name: "create_scope",
  description: "Create the data scope a chat may use: the chosen accounts and collections and whether it may change records. Called from the account access view with the host-bound actor.",
  input: s.createScopeInput, output: s.scopeOutput, audience: userOnly, effect: "app_write", retry: "idempotent", visibility: "app", errors: [...WRITE_ERRORS],
  examples: [{ input: { actorId: "chat:fictional-chat", sources: ["manual", "account:conn-fictional-1"], operations: ["read"] }, output: { scopeRef: "4f1c2d3e-0000-4000-8000-000000000010" } }],
  handler(input, invocation) {
    const { t, sources } = app();
    requireOwner(scopeOf(invocation, "write"));
    return t.store.mutate(invocation, "create_scope", input, () => sources.createScope(invocation, input));
  },
});

const listScopes = act({
  name: "list_scopes",
  description: "List the data scopes shared with chats, including revoked ones.",
  input: z.object({}).strict(), output: z.object({ items: s.listSourcesOutput.shape.shares }).strict(), audience: userOnly, effect: "read", retry: "read_safe", visibility: "app", errors: [...READ_ERRORS],
  examples: [{ input: {}, output: { items: [{ id: "4f1c2d3e-0000-4000-8000-000000000010", label: "Shared Travel records", actor: "chat:fictional-chat", sources: ["manual"], createdAt: "2026-10-15T10:00:00.000Z", revoked: false }] } }],
  handler(_input, invocation) {
    requireOwner(scopeOf(invocation, "read"));
    return { items: app().sources.list(invocation).shares };
  },
});

const revokeScope = act({
  name: "revoke_scope",
  description: "Revoke a data scope so its chat can no longer read or change Travel records.",
  input: s.revokeScopeInput, output: s.okOutput, audience: userOnly, effect: "app_write", retry: "idempotent", visibility: "app", errors: [...WRITE_ERRORS],
  examples: [{ input: { scopeRef: "4f1c2d3e-0000-4000-8000-000000000010" }, output: { status: "saved" } }],
  handler(input, invocation) {
    const { t } = app();
    requireOwner(scopeOf(invocation, "write"));
    return t.store.mutate(invocation, "revoke_scope", input, () => {
      if (!t.scopes.get(input.scopeRef)) throw new AppError("not_found", "That access is no longer listed");
      t.scopes.revoke(input.scopeRef);
      return { status: "saved" as const };
    });
  },
});

const saveSettings = act({
  name: "save_settings",
  description: "Set the home time zone, the names that appear on your own bookings, and whether the opted-in AI fallback may read confirmations that the built-in readers cannot.",
  input: s.settingsInput, output: s.settingsOutput, audience: userOnly, effect: "app_write", retry: "idempotent", visibility: "app", errors: [...WRITE_ERRORS],
  examples: [{ input: { homeZone: "America/Denver", ownerNames: ["Alex Rivera"] }, output: { status: "saved", settings: { homeZone: "America/Denver", ownerNames: ["Alex Rivera"], aiExtraction: false } } }],
  handler(input, invocation) {
    const { t } = app();
    requireOwner(scopeOf(invocation, "write"));
    return t.store.mutate(invocation, "save_settings", input, () => {
      t.settings.set(input);
      return { status: "saved" as const, settings: t.settings.get() };
    });
  },
});

const rememberView = act({
  name: "remember_view",
  description: "Remember the trip the owner last opened so Travel can reopen it.",
  input: s.rememberInput, output: s.okOutput, audience: userOnly, effect: "app_write", retry: "idempotent", visibility: "app", errors: [...WRITE_ERRORS],
  examples: [{ input: { lastTripId: ex.EX_TRIP_ID }, output: { status: "saved" } }],
  handler(input, invocation) {
    const { t } = app();
    requireOwner(scopeOf(invocation, "write"));
    t.settings.setLastTripId(input.lastTripId);
    return { status: "saved" as const };
  },
});

// ─── Background ─────────────────────────────────────────────────────────────

const stepDescription = "One bounded step: a Gmail page with at most ten messages read and a 20 second budget, a Calendar page, or a small batch reading booking attachments or the opted-in AI fallback. Records and the checkpoint commit together.";
const runBackgroundStep = act({
  name: "run_background_step",
  description: `The schedule's step. Recovers interrupted work, picks the next due account fairly and runs it. ${stepDescription}`,
  input: z.object({}).strict(), output: s.stepOutput, audience: ["schedule"], effect: "app_write", retry: "idempotent", timeoutMs: 40_000, errors: ["forbidden", "revoked", "busy", "timeout"],
  examples: [{ input: {}, output: ex.exampleStep }],
  async handler(_input, invocation) {
    return app().sync.step(invocation);
  },
});
const syncStep = act({
  name: "sync_step",
  description: `A scheduled ingestion step. ${stepDescription}`,
  input: z.object({}).strict(), output: s.stepOutput, audience: ["schedule"], effect: "app_write", retry: "idempotent", timeoutMs: 40_000, errors: ["forbidden", "revoked", "busy", "timeout"],
  examples: [{ input: {}, output: ex.exampleStep }],
  async handler(_input, invocation) {
    return app().sync.step(invocation, { kinds: ["mail_sync", "calendar_sync"] });
  },
});
const enrichStep = act({
  name: "enrich_step",
  description: "A scheduled enrichment step: read up to three saved sources whose booking is in an attachment, or use the opted-in AI fallback with exact passages. Suggestions wait in Review.",
  input: z.object({}).strict(), output: s.stepOutput, audience: ["schedule"], effect: "app_write", retry: "idempotent", timeoutMs: 40_000, errors: ["forbidden", "revoked", "busy", "timeout"],
  examples: [{ input: {}, output: { ...ex.exampleStep, kind: "enrich", summary: "Read 1 saved source, 1 to review", read: 1, added: 0, review: 1, skipped: 0 } }],
  async handler(_input, invocation) {
    return app().sync.step(invocation, { kinds: ["enrich"] });
  },
});

export const definition: AppDefinition = {
  packageId: "ri-travel",
  version: "0.1.0",
  actions: [
    openView, describeContext, listTrips, getTrip, saveTrip, listBookings, getBooking, saveBooking, deleteBooking, listIdeas, saveIdea, compareIdeas,
    listReview, reviewChange, dismissGap, createFollowUp, listFollowUps, checkFollowUp, previewImport, applyImport, getEvidence, exportTrip,
    listSources, setupSource, listCalendarsAction, pauseSource, deleteSourceData, continueImport, createScope, listScopes, revokeScope, saveSettings, rememberView,
    runBackgroundStep, syncStep, enrichStep,
  ],
  entities: [
    { type: "trip", idField: "id", titleField: "title", recordSchema: z.toJSONSchema(s.tripSchema) as Record<string, unknown>, readAction: "get_trip", listAction: "list_trips", searchAction: "list_trips", openPath: "/trips/{id}" },
    { type: "booking", idField: "id", titleField: "title", recordSchema: z.toJSONSchema(s.bookingSchema) as Record<string, unknown>, readAction: "get_booking", listAction: "list_bookings", searchAction: "list_bookings", openPath: "/bookings/{id}" },
    { type: "idea", idField: "id", titleField: "title", recordSchema: z.toJSONSchema(s.ideaSchema) as Record<string, unknown>, listAction: "list_ideas", openPath: "/ideas/{id}" },
  ],
  contexts: { [RESOURCE]: s.viewStateSchema },
};
