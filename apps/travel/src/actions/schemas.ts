/**
 * Strict input and output schemas for every Travel action. The contract is
 * generated from these, and the view's types are inferred from them.
 */
import { z } from "zod/v4";
import { listInputShape } from "@ri/app-kit/data";
import { BOOKING_KINDS, BOOKING_STATUSES, IDEA_KINDS, REVIEW_DECISIONS, REVIEW_KINDS, TRIP_STATES, bookingDraftSchema, clockTimeSchema, currencySchema, fieldPathSchema, localDateSchema, zoneSchema } from "../domain/model.js";

const id = z.string().min(1).max(128);
const text = (max: number) => z.string().max(max);
const nullableText = (max: number) => z.string().max(max).nullable();
const iso = z.string().max(40);

export const endpointSchema = z.object({
  local: text(16), date: text(10), time: nullableText(5), zone: nullableText(64), zoneLabel: nullableText(16), instant: iso.nullable(),
  resolution: z.enum(["exact", "gap", "ambiguous", "offset", "date_only", "zone_missing"]), note: nullableText(400),
}).strict();
const placeSchema = z.object({ label: nullableText(200), code: nullableText(8) }).strict();
export const segmentSchema = z.object({
  id, sequence: z.number().int().min(0), number: nullableText(40), origin: placeSchema, destination: placeSchema,
  start: endpointSchema, end: endpointSchema.nullable(), dateOnly: z.boolean(), address: nullableText(400), endAddress: nullableText(400),
  overnight: z.boolean(), duration: nullableText(20),
}).strict();
export const staySchema = z.object({
  id, propertyName: text(200), address: nullableText(400), checkInDate: text(10), checkOutDate: text(10), checkInTime: nullableText(5), checkOutTime: nullableText(5),
  zone: nullableText(64), nights: z.number().int().min(0), checkIn: endpointSchema, checkOut: endpointSchema,
}).strict();
const fieldValue = z.union([z.string().max(400), z.array(z.string().max(120)).max(20), z.null()]);
export const correctionSchema = z.object({ field: text(60), label: text(80), value: fieldValue, original: fieldValue, stale: z.boolean(), at: iso }).strict();
export const sourceRefSchema = z.object({
  evidenceId: id, role: z.enum(["created", "duplicate", "changed", "canceled", "linked", "pending"]), origin: z.enum(["gmail", "file", "paste", "manual", "fixture"]),
  title: text(300), sender: nullableText(200), receivedAt: iso.nullable(), observedAt: iso, availability: z.enum(["available", "unavailable"]),
  sourceLabel: text(200), method: nullableText(20), fictional: z.boolean(),
}).strict();
export const bookingCoverageSchema = z.object({
  sources: z.number().int().min(0), available: z.number().int().min(0), unavailable: z.number().int().min(0),
  missing: z.array(text(60)).max(30), note: nullableText(300),
}).strict();
export const bookingSchema = z.object({
  id, createdAt: iso, updatedAt: iso, revision: z.number().int().min(1), tripId: id.nullable(), tripTitle: nullableText(200),
  kind: z.enum(BOOKING_KINDS), kindLabel: text(30), title: text(200), provider: nullableText(200), providerCode: nullableText(8), reference: nullableText(60), detail: nullableText(160),
  travelers: z.array(text(120)).max(20), status: z.enum(BOOKING_STATUSES), statusLabel: text(20), notes: nullableText(2000), method: z.enum(["deterministic", "ai", "invite", "manual"]),
  segments: z.array(segmentSchema).max(12), stay: staySchema.nullable(), corrections: z.array(correctionSchema).max(60),
  firstDate: nullableText(10), lastDate: nullableText(10), dateLabel: text(120), summary: text(300), timeNotes: z.array(text(500)).max(30),
  sources: z.array(sourceRefSchema).max(50), coverage: bookingCoverageSchema, openReviewIds: z.array(id).max(50), fictional: z.boolean(),
}).strict();
export type BookingRecord = z.infer<typeof bookingSchema>;

export const changeSchema = z.object({
  id, at: iso, kind: text(30), fields: z.array(z.object({ field: text(60), label: text(80), before: text(400), after: text(400) }).strict()).max(60),
  note: nullableText(600), actorLabel: text(60), source: z.object({ evidenceId: id, title: text(300) }).strict().nullable(),
}).strict();

export const followUpSchema = z.object({
  id, createdAt: iso, updatedAt: iso, subjectType: z.enum(["trip", "booking", "idea", "review"]), subjectId: id, operationId: z.string().uuid(),
  title: text(500), dueAt: nullableText(40), taskId: nullableText(128), state: z.enum(["pending", "created", "needs_permission", "failed"]),
  availability: z.enum(["unknown", "available", "missing"]), checkedAt: iso.nullable(), message: nullableText(300),
}).strict();
export type FollowUpRecord = z.infer<typeof followUpSchema>;

const comparisonSchema = z.object({ field: text(60), label: text(80), current: text(400), proposed: text(400) }).strict();
export const reviewItemSchema = z.object({
  id, createdAt: iso, updatedAt: iso, revision: z.number().int().min(1), kind: z.enum(REVIEW_KINDS), kindLabel: text(60), headline: text(300), reason: text(600),
  bookingId: id.nullable(), bookingTitle: nullableText(200), tripId: id.nullable(), tripTitle: nullableText(200),
  candidates: z.array(z.object({ id, type: z.enum(["trip", "booking"]), title: text(200), detail: text(300) }).strict()).max(20),
  comparison: z.array(comparisonSchema).max(40), correctionConflict: z.boolean(),
  draft: bookingDraftSchema.nullable(), prefill: z.record(z.string().max(60), z.string().max(400).nullable()), missing: z.array(text(60)).max(30), passages: z.array(text(600)).max(20),
  evidence: z.array(sourceRefSchema).max(10), decisions: z.array(z.enum(REVIEW_DECISIONS)).max(7),
  decision: nullableText(20), decidedAt: iso.nullable(), fictional: z.boolean(),
}).strict();
export type ReviewItemRecord = z.infer<typeof reviewItemSchema>;

export const tripSchema = z.object({
  id, createdAt: iso, updatedAt: iso, revision: z.number().int().min(1), title: text(200), destinations: z.array(text(120)).max(12),
  startDate: nullableText(10), endDate: nullableText(10), dateLabel: text(120), datesSource: z.enum(["derived", "manual", "unset"]),
  homeZone: nullableText(64), state: z.enum(TRIP_STATES), travelers: z.array(text(120)).max(20), notes: nullableText(4000),
  bookingCount: z.number().int().min(0), canceledCount: z.number().int().min(0), ideaCount: z.number().int().min(0), reviewCount: z.number().int().min(0),
  attention: nullableText(300), projection: z.enum(["full", "partial"]), fictional: z.boolean(),
}).strict();
export type TripRecord = z.infer<typeof tripSchema>;

export const itineraryItemSchema = z.object({
  id: text(300), bookingId: id, kind: z.enum(BOOKING_KINDS), role: z.enum(["depart", "arrive", "journey", "check_in", "check_out", "staying", "pickup", "return", "rental", "activity", "activity_end"]),
  date: text(10), time: nullableText(5), zone: nullableText(64), zoneLabel: nullableText(16), instant: iso.nullable(), title: text(300), subtitle: text(300), context: nullableText(300),
  location: nullableText(400), status: z.enum(BOOKING_STATUSES), allDay: z.boolean(), localOrder: z.boolean(), notes: z.array(text(500)).max(10),
  sourceLabel: text(200), sourceAvailable: z.boolean(), corrected: z.boolean(), needsReview: z.boolean(),
}).strict();
export const daySchema = z.object({
  date: text(10), label: text(60), zones: z.array(z.object({ zone: text(64), label: text(16), city: text(80) }).strict()).max(10), zoneMissing: z.boolean(),
  zoneLine: nullableText(200), items: z.array(itineraryItemSchema).max(300), gapKeys: z.array(text(200)).max(50), inTrip: z.boolean(),
}).strict();
export const gapSchema = z.object({
  key: text(200), kind: z.enum(["night", "overlap", "zone_missing"]), date: nullableText(10), bookingIds: z.array(id).max(10), message: text(500),
  fingerprint: text(64), dismissed: z.boolean(), dismissedAt: iso.nullable(),
}).strict();
export const coverageSchema = z.object({
  checked: z.boolean(), summary: text(300), open: z.number().int().min(0),
  nights: z.array(z.object({ date: text(10), status: z.enum(["covered", "uncovered", "dismissed"]), by: z.array(z.object({ bookingId: id, kind: z.enum(BOOKING_KINDS), label: text(200), how: z.enum(["lodging", "overnight"]) }).strict()).max(10) }).strict()).max(400),
  gaps: z.array(gapSchema).max(400),
}).strict();
export const calendarEventSchema = z.object({
  id, summary: text(300), start: text(40), end: nullableText(40), allDay: z.boolean(), when: text(120), relation: z.enum(["during_trip", "overlaps_booking", "matches_booking"]),
  bookingId: id.nullable(), note: text(300), sourceLabel: text(200),
}).strict();
export const calendarStateSchema = z.object({
  status: z.enum(["not_connected", "not_chosen", "importing", "ready", "partial", "no_dates"]), message: text(300),
  events: z.array(calendarEventSchema).max(200), checkedThrough: iso.nullable(),
}).strict();

export const ideaSchema = z.object({
  id, createdAt: iso, updatedAt: iso, revision: z.number().int().min(1), tripId: id, kind: z.enum(IDEA_KINDS), title: text(200), note: nullableText(2000), url: nullableText(2000),
  priceMinor: z.number().int().nullable(), currency: nullableText(3), priceLabel: text(60), observedAt: nullableText(40), location: nullableText(300), conditions: nullableText(500),
  sourceLabel: nullableText(200), fictional: z.boolean(),
}).strict();
export type IdeaRecord = z.infer<typeof ideaSchema>;

const coverageList = z.object({ complete: z.boolean(), note: nullableText(300) }).strict();
const listOutput = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable(), coverage: coverageList, revision: text(80) }).strict();

// ─── Inputs ─────────────────────────────────────────────────────────────────

export const openViewInput = z.object({ path: z.string().max(1024), query: z.record(z.string(), z.string().max(1024)) }).strict();
export const viewStateSchema = z.object({
  section: z.enum(["trips", "trip", "review", "sources", "access"]).optional(),
  tripId: id.optional(),
  tab: z.enum(["itinerary", "bookings", "ideas"]).optional(),
  day: localDateSchema.optional(),
  selected: z.array(z.object({ type: z.enum(["trip", "booking", "idea", "review"]), id }).strict()).max(50).optional(),
  filters: z.object({ status: z.enum(["all", "confirmed", "planned", "canceled", "needs_review"]).optional(), kind: z.enum(["all", ...BOOKING_KINDS]).optional(), query: z.string().max(200).optional() }).strict().optional(),
  revisions: z.record(z.string().max(128), z.number().int().min(0)).optional(),
}).strict();
export type ViewState = z.infer<typeof viewStateSchema>;
export const contextInput = z.object({ path: z.string().max(1024), query: z.record(z.string(), z.string().max(1024)), state: viewStateSchema.nullable().optional() }).strict();

export const listTripsInput = z.object({ ...listInputShape, when: z.enum(["upcoming", "past", "all", "archived"]).default("all"), query: z.string().max(200).optional() }).strict();
export const getTripInput = z.object({ id }).strict();
export const saveTripInput = z.object({
  id: id.optional(), expectedRevision: z.number().int().min(1).optional(),
  title: z.string().trim().min(1).max(200).optional(), startDate: localDateSchema.nullable().optional(), endDate: localDateSchema.nullable().optional(),
  homeZone: zoneSchema.nullable().optional(), travelers: z.array(z.string().trim().min(1).max(120)).max(20).optional(), notes: z.string().max(4000).nullable().optional(),
  archived: z.boolean().optional(),
}).strict();
export const listBookingsInput = z.object({
  ...listInputShape, tripId: id.optional(), unassigned: z.boolean().optional(),
  status: z.enum(["all", "confirmed", "planned", "canceled", "needs_review"]).default("all"), kind: z.enum(["all", ...BOOKING_KINDS]).default("all"), query: z.string().max(200).optional(),
}).strict();
export const getBookingInput = z.object({ id }).strict();
const segmentPatch = z.object({
  sequence: z.number().int().min(0).max(11),
  number: z.string().trim().max(40).nullable().optional(), originLabel: z.string().trim().max(200).nullable().optional(), originCode: z.string().trim().max(8).nullable().optional(),
  destinationLabel: z.string().trim().max(200).nullable().optional(), destinationCode: z.string().trim().max(8).nullable().optional(),
  startLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}(T([01]\d|2[0-3]):[0-5]\d)?$/).optional(), startZone: zoneSchema.nullable().optional(),
  endLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}(T([01]\d|2[0-3]):[0-5]\d)?$/).nullable().optional(), endZone: zoneSchema.nullable().optional(),
  address: z.string().trim().max(400).nullable().optional(), endAddress: z.string().trim().max(400).nullable().optional(),
}).strict();
export const bookingPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(), provider: z.string().trim().max(200).nullable().optional(), reference: z.string().trim().max(60).nullable().optional(),
  travelers: z.array(z.string().trim().min(1).max(120)).max(20).optional(), status: z.enum(BOOKING_STATUSES).optional(),
  stay: z.object({
    propertyName: z.string().trim().min(1).max(200).optional(), address: z.string().trim().max(400).nullable().optional(),
    checkInDate: localDateSchema.optional(), checkOutDate: localDateSchema.optional(), checkInTime: clockTimeSchema.nullable().optional(), checkOutTime: clockTimeSchema.nullable().optional(), zone: zoneSchema.nullable().optional(),
  }).strict().optional(),
  segments: z.array(segmentPatch).max(12).optional(),
}).strict();
export const saveBookingInput = z.object({
  id: id.optional(), expectedRevision: z.number().int().min(1).optional(),
  /** New manual booking. */
  draft: bookingDraftSchema.optional(),
  /** Corrections to an existing booking. Imported values are kept beside them. */
  patch: bookingPatchSchema.optional(),
  /** Remove a correction and use the source value again. */
  clearCorrections: z.array(fieldPathSchema).max(60).optional(),
  /** Move between trips, or null to leave unassigned. Keeps sources and corrections. */
  tripId: id.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
}).strict();
export const deleteBookingInput = z.object({ id, expectedRevision: z.number().int().min(1) }).strict();
export const listIdeasInput = z.object({ ...listInputShape, tripId: id.optional() }).strict();
export const saveIdeaInput = z.object({
  id: id.optional(), expectedRevision: z.number().int().min(1).optional(), tripId: id.optional(),
  kind: z.enum(IDEA_KINDS).optional(), title: z.string().trim().min(1).max(200).optional(), note: z.string().max(2000).nullable().optional(),
  url: z.string().max(2000).regex(/^https:\/\/[^\s]+$/i, "Use an https link").nullable().optional(),
  priceMinor: z.number().int().min(0).max(100_000_000_00).nullable().optional(), currency: currencySchema.nullable().optional(), observedAt: localDateSchema.nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(), conditions: z.string().trim().max(500).nullable().optional(), sourceLabel: z.string().trim().max(200).nullable().optional(),
  removed: z.boolean().optional(),
}).strict();
export const compareIdeasInput = z.object({ ids: z.array(id).min(2).max(4) }).strict();
export const listReviewInput = z.object({ ...listInputShape, tripId: id.optional(), state: z.enum(["open", "decided", "all"]).default("open") }).strict();
export const reviewChangeInput = z.object({
  id, expectedRevision: z.number().int().min(1), decision: z.enum(REVIEW_DECISIONS),
  tripId: id.optional(), bookingId: id.optional(), newTripTitle: z.string().trim().max(200).optional(), draft: bookingDraftSchema.optional(),
}).strict();
export const dismissGapInput = z.object({ tripId: id, key: z.string().max(200), fingerprint: z.string().max(64), note: z.string().max(500).optional(), restore: z.boolean().optional() }).strict();
export const createFollowUpInput = z.object({
  subject: z.object({ type: z.enum(["trip", "booking", "idea", "review"]), id }).strict(),
  title: z.string().trim().min(1).max(500), description: z.string().max(4000).optional(),
  dueAt: z.union([localDateSchema, z.iso.datetime({ offset: true })]).optional(),
  operationId: z.string().uuid().optional(),
}).strict();
export const listFollowUpsInput = z.object({ ...listInputShape, subjectId: id.optional() }).strict();
export const checkFollowUpInput = z.object({ id }).strict();
export const previewImportInput = z.object({
  kind: z.enum(["file", "paste"]),
  fileName: z.string().min(1).max(200).optional(), mimeType: z.enum(["application/pdf", "text/plain", "message/rfc822", "text/html"]).optional(),
  base64: z.string().max(Math.ceil((512 * 1024) / 3) * 4 + 4).regex(/^[A-Za-z0-9+/]*={0,2}$/).optional(),
  text: z.string().max(200_000).optional(),
}).strict();
export const applyImportInput = z.object({
  previewId: id, digest: z.string().regex(/^[a-f0-9]{64}$/),
  decisions: z.array(z.object({ item: z.number().int().min(0).max(19), include: z.boolean(), tripId: id.nullable().optional(), newTripTitle: z.string().trim().max(200).optional() }).strict()).max(20).optional(),
  /** Details entered by hand when the source could not be read. The original stays linked as evidence. */
  manual: bookingDraftSchema.optional(),
  manualTripId: id.nullable().optional(),
}).strict();
export const getEvidenceInput = z.object({ id }).strict();
export const exportTripInput = z.object({ id, format: z.enum(["json", "csv"]) }).strict();
export const sourceRefInput = z.object({ account: z.string().min(1).max(128), kind: z.enum(["mail", "calendar"]) }).strict();
export const setupSourceInput = z.object({ account: z.string().min(1).max(128), kind: z.enum(["mail", "calendar"]), historyDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).optional(), calendars: z.array(z.string().min(1).max(1024)).max(20).optional(), label: z.string().max(200).optional() }).strict();
export const pauseSourceInput = z.object({ account: z.string().min(1).max(128), paused: z.boolean() }).strict();
export const deleteSourceInput = z.object({ source: z.string().min(1).max(200) }).strict();
/** `source` is an account source key such as `account:<connection>`. */
export const continueImportInput = z.object({ source: z.string().regex(/^account:.{1,128}$/), kind: z.enum(["mail", "calendar"]).default("mail") }).strict();
export const settingsInput = z.object({ homeZone: zoneSchema.nullable().optional(), ownerNames: z.array(z.string().trim().min(1).max(120)).max(10).optional(), aiExtraction: z.boolean().optional() }).strict();
export const createScopeInput = z.object({ actorId: z.string().min(1).max(200), sources: z.array(z.string().min(1).max(200)).min(1).max(200), operations: z.array(z.enum(["read", "write"])).min(1).max(2), label: z.string().max(200).optional() }).strict();
export const revokeScopeInput = z.object({ scopeRef: id }).strict();
export const rememberInput = z.object({ lastTripId: id.nullable() }).strict();

// ─── Outputs ────────────────────────────────────────────────────────────────

export const listTripsOutput = listOutput(tripSchema);
export const listBookingsOutput = listOutput(bookingSchema);
export const listIdeasOutput = listOutput(ideaSchema);
export const listReviewOutput = listOutput(reviewItemSchema);
export const listFollowUpsOutput = listOutput(followUpSchema);
export const tripDetailSchema = z.object({
  trip: tripSchema, days: z.array(daySchema).max(400), bookings: z.array(bookingSchema).max(500), coverage: coverageSchema,
  review: z.array(reviewItemSchema).max(100), calendar: calendarStateSchema, followUps: z.array(followUpSchema).max(100),
  ideaCount: z.number().int().min(0), localContext: text(300), revision: text(80),
}).strict();
export type TripDetail = z.infer<typeof tripDetailSchema>;
export const bookingDetailSchema = z.object({
  booking: bookingSchema, changes: z.array(changeSchema).max(200), review: z.array(reviewItemSchema).max(50), followUps: z.array(followUpSchema).max(50),
  directionsAddress: nullableText(400), revision: text(80),
}).strict();
export type BookingDetail = z.infer<typeof bookingDetailSchema>;
export const evidenceDetailSchema = z.object({
  source: sourceRefSchema, excerpt: text(8000), truncated: z.boolean(), passages: z.array(text(600)).max(20), fileName: nullableText(200), mimeType: nullableText(100),
  note: nullableText(300), openUrl: nullableText(500), bookings: z.array(z.object({ id, title: text(200) }).strict()).max(20),
}).strict();
export const compareOutput = z.object({
  ideas: z.array(ideaSchema).max(4),
  rows: z.array(z.object({ label: text(60), values: z.array(text(500)).max(4) }).strict()).max(12),
  currencies: z.array(text(3)).max(4), note: text(400),
}).strict();
export const writeTrip = z.discriminatedUnion("status", [
  z.object({ status: z.literal("saved"), record: tripSchema }).strict(),
  z.object({ status: z.literal("conflict"), current: tripSchema, message: text(300) }).strict(),
]);
export const writeBooking = z.discriminatedUnion("status", [
  z.object({ status: z.literal("saved"), record: bookingSchema }).strict(),
  z.object({ status: z.literal("conflict"), current: bookingSchema, message: text(300) }).strict(),
]);
export const writeIdea = z.discriminatedUnion("status", [
  z.object({ status: z.literal("saved"), record: ideaSchema }).strict(),
  z.object({ status: z.literal("conflict"), current: ideaSchema, message: text(300) }).strict(),
]);
export const writeReview = z.discriminatedUnion("status", [
  z.object({ status: z.literal("saved"), record: reviewItemSchema, bookingId: id.nullable(), tripId: id.nullable(), message: text(300) }).strict(),
  z.object({ status: z.literal("conflict"), current: reviewItemSchema, message: text(300) }).strict(),
]);
export const deleteOutput = z.discriminatedUnion("status", [
  z.object({ status: z.literal("deleted"), id }).strict(),
  z.object({ status: z.literal("conflict"), current: bookingSchema, message: text(300) }).strict(),
]);
export const dismissGapOutput = z.object({ status: z.literal("saved"), coverage: coverageSchema }).strict();
export const followUpOutput = z.object({ status: z.enum(["created", "pending", "needs_permission", "failed"]), followUp: followUpSchema, message: text(300) }).strict();
export const previewItemSchema = z.object({
  item: z.number().int().min(0), draft: bookingDraftSchema.nullable(), summary: text(300), kindLabel: text(30), complete: z.boolean(), missing: z.array(text(60)).max(30),
  ambiguous: z.array(text(300)).max(10), passages: z.array(text(600)).max(20), cancellation: z.boolean(), change: z.boolean(),
  match: z.object({ bookingId: id, title: text(200), changes: z.array(comparisonSchema).max(40) }).strict().nullable(),
  suggestedTripId: id.nullable(), suggestedTripTitle: nullableText(200), placement: text(300),
}).strict();
export const previewOutput = z.object({
  previewId: id, digest: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: iso, fileName: nullableText(200), characters: z.number().int().min(0), truncated: z.boolean(),
  forwarded: z.boolean(), items: z.array(previewItemSchema).max(20), notes: z.array(text(300)).max(10), excerpt: text(4000),
  trips: z.array(z.object({ id, title: text(200), dateLabel: text(120) }).strict()).max(50), extraction: z.enum(["deterministic", "none", "unavailable", "ai"]),
}).strict();
export const applyOutput = z.object({
  status: z.enum(["applied", "already_applied", "nothing_to_apply"]), evidenceId: id.nullable(),
  outcomes: z.array(z.object({ item: z.number().int().min(0), action: z.enum(["created", "duplicate", "updated", "canceled", "review", "unchanged", "skipped"]), bookingId: id.nullable(), tripId: id.nullable(), reviewId: id.nullable(), message: text(300) }).strict()).max(20),
  openTripId: id.nullable(), message: text(300),
}).strict();
export const sourceAccountSchema = z.object({
  id: text(200), account: text(128), label: text(200), detail: nullableText(200), kind: z.enum(["mail", "calendar"]), granted: z.boolean(), automatic: z.boolean(),
  status: z.enum(["ready", "importing", "paused", "reconnect", "error", "not_started"]), coverage: z.object({ from: text(10), to: text(10), partial: z.boolean() }).strict().nullable(),
  historyDays: z.union([z.literal(30), z.literal(90), z.literal(365)]), lastSuccessAt: iso.nullable(), pending: z.number().int().min(0), failed: z.number().int().min(0), error: nullableText(300),
  paused: z.boolean(), records: z.number().int().min(0), skipped: z.number().int().min(0), calendars: z.array(z.string().max(1024)).max(20), fictional: z.boolean(),
  firstDetected: z.object({ tripId: id, title: text(200), dateLabel: text(120), bookings: z.number().int().min(0) }).strict().nullable(),
}).strict();
export const listSourcesOutput = z.object({
  accounts: z.array(sourceAccountSchema).max(60),
  imports: z.array(z.object({ id: text(200), name: text(200), kind: text(30), importedAt: iso, records: z.number().int().min(0), status: text(30) }).strict()).max(200),
  collections: z.array(z.object({ key: text(200), label: text(200), records: z.number().int().min(0) }).strict()).max(10),
  shares: z.array(z.object({ id, label: text(200), actor: text(200), sources: z.array(text(200)).max(200), createdAt: iso, revoked: z.boolean() }).strict()).max(200),
  settings: z.object({ homeZone: nullableText(64), ownerNames: z.array(text(120)).max(10), aiExtraction: z.boolean() }).strict(),
  mailQuery: text(2000), note: text(600), revision: text(80),
}).strict();
export const stepOutput = z.object({
  ran: z.boolean(), kind: nullableText(30), source: nullableText(200), more: z.boolean(), summary: text(300),
  read: z.number().int().min(0), added: z.number().int().min(0), review: z.number().int().min(0), skipped: z.number().int().min(0), removed: z.number().int().min(0),
}).strict();
export const continueOutput = z.object({ step: stepOutput, source: sourceAccountSchema.nullable() }).strict();
export const calendarsOutput = z.object({ calendars: z.array(z.object({ id: z.string().max(1024), summary: text(300), primary: z.boolean() }).strict()).max(100), chosen: z.array(z.string().max(1024)).max(20) }).strict();
export const okOutput = z.object({ status: z.literal("saved") }).strict();
export const scopeOutput = z.object({ scopeRef: z.string() }).strict();
export const settingsOutput = z.object({ status: z.literal("saved"), settings: z.object({ homeZone: nullableText(64), ownerNames: z.array(text(120)).max(10), aiExtraction: z.boolean() }).strict() }).strict();
export const exportOutput = z.object({ fileName: text(200), mimeType: z.enum(["application/json", "text/csv"]), text: z.string().max(4_000_000), records: z.number().int().min(0) }).strict();
export const deleteSourceOutput = z.object({ status: z.literal("deleted"), source: text(200), bookings: z.number().int().min(0), evidence: z.number().int().min(0), keptNotes: z.number().int().min(0) }).strict();
export const contextOutput = z.object({
  modelContent: z.string().max(16384),
  recordRefs: z.array(z.object({ instanceId: z.string().uuid(), entityType: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), recordId: z.string().min(1).max(128) }).strict()).max(50),
  dataRevision: z.string().max(128),
}).strict();
export const openViewOutput = z.object({
  resource: z.literal("ui://ri-travel/main.html"),
  data: z.object({
    path: text(1024), section: z.enum(["trips", "trip", "review", "sources", "access", "booking"]), tripId: id.nullable(), bookingId: id.nullable(),
    tab: z.enum(["itinerary", "bookings", "ideas"]).nullable(), day: nullableText(10), selected: nullableText(128), filters: z.record(z.string(), z.string().max(200)),
    owner: z.boolean(), fictional: z.boolean(),
    setup: z.object({
      trips: z.number().int().min(0), accounts: z.number().int().min(0), reviewOpen: z.number().int().min(0), aiExtraction: z.boolean(),
      /** Accounts that need reconnecting in Ri. Their imported records stay readable. */
      reconnect: z.number().int().min(0),
      /** An account's first import is still running, so coverage is partial. */
      importing: z.boolean(),
      lastImportAt: iso.nullable(),
    }).strict(),
    access: z.object({ actorId: text(200), sources: z.array(z.object({ key: text(200), label: text(200), kind: z.enum(["account", "collection"]), detail: nullableText(200) }).strict()).max(200) }).strict().nullable(),
    revision: text(80), today: text(10),
  }).strict(),
  scope: z.object({ actions: z.array(z.string()).max(100), bindings: z.record(z.string(), z.unknown()).optional() }).strict(),
}).strict();
export type OpenViewData = z.infer<typeof openViewOutput>["data"];
