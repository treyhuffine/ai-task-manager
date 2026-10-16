/**
 * Turn one parsed booking from one source into records, exactly once.
 *
 * Order of identity: the same source (already applied), the same invitation
 * or mail thread, then provider, reference, travelers and compatible dates.
 * A matching exact provider confirmation updates the booking with a visible
 * change record. Anything less certain, any change to a field the person
 * corrected, a cancellation without matching evidence, several possible
 * bookings, several travelers, a forwarded message or overlapping trips goes
 * to Review. Nothing here invents a booking from a cancellation.
 */
import { createHash } from "node:crypto";
import { allows, type AccessScope } from "@ri/app-kit/data";
import { daysBetween } from "@ri/app-kit/time";
import { baseValue, displayValue, draftValues, type EffectiveBooking } from "../domain/booking.js";
import { draftDates, matchBookings, matchTrips, providerKey, travelerFit } from "../domain/match.js";
import { fieldLabel, type BookingDraft, type ParsedBooking, type ReviewKind } from "../domain/model.js";
import { airport, findCityZone } from "../domain/places.js";
import { isComplete } from "../domain/parse/extract.js";
import { nameKey, normalizeReference } from "../domain/parse/text.js";
import type { EvidenceRow, Repo, ReviewRow, TripRow } from "../db/repo.js";
import { zoneCity } from "../domain/clock.js";

export interface IngestSettings { ownerNames: string[]; homeZone: string | null }
export interface IngestContext { repo: Repo; settings: IngestSettings; actor: string }
export type OutcomeAction = "created" | "duplicate" | "updated" | "canceled" | "review" | "unchanged";
export interface Outcome { action: OutcomeAction; bookingId: string | null; tripId: string | null; reviewId: string | null; message: string }
export interface ApplyOptions {
  /** A person reviewed exactly this content, so it counts as exact. */
  reviewed?: boolean;
  /** Place a new booking in this trip, or leave it unassigned with null. */
  tripId?: string | null;
  /** Create a new trip with this title for a new booking. */
  newTripTitle?: string | null;
  /** Treat as the given existing booking. */
  linkTo?: string | null;
  /** Keep separate from any existing booking. */
  forceNew?: boolean;
  fictional?: boolean;
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Paths whose differences matter for the itinerary. Titles and provider spellings vary between messages. */
const IGNORED_DIFFS = new Set(["title", "provider"]);

function sameValue(path: string, a: unknown, b: unknown) {
  if (path === "travelers") return travelerFit((a as string[]) ?? [], (b as string[]) ?? []) === "same";
  if (path === "reference") return normalizeReference(a as string) === normalizeReference(b as string);
  if (typeof a === "string" && typeof b === "string") return a.trim().toLowerCase() === b.trim().toLowerCase();
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Where a booking goes: the place that names the trip. */
export function destinationOf(draft: BookingDraft, homeZone: string | null): string | null {
  if (draft.kind === "lodging" && draft.stay) return findCityZone(draft.stay.address)?.city ?? findCityZone(draft.stay.propertyName)?.city ?? null;
  const segments = draft.segments ?? [];
  if (draft.kind === "flight" || draft.kind === "train") {
    for (const segment of segments) {
      const zone = segment.endZone ?? airport(segment.destinationCode)?.zone ?? null;
      const label = segment.destinationLabel ?? airport(segment.destinationCode)?.city ?? null;
      if (label && (!homeZone || zone !== homeZone)) return label.replace(/\s+(?:union|central|main|king\s+street)?\s*station$/i, "").replace(/\s+(?:airport|international).*$/i, "");
    }
    const first = segments[0];
    return first?.originLabel ?? first?.destinationLabel ?? null;
  }
  const segment = segments[0];
  return findCityZone(segment?.address)?.city ?? (segment?.originCode ? airport(segment.originCode)?.city ?? null : null) ?? findCityZone(segment?.originLabel)?.city ?? (segment?.startZone ? zoneCity(segment.startZone) : null);
}

export function createIngest(ctx: IngestContext) {
  const { repo } = ctx;

  function review(input: { kind: ReviewKind; bookingId?: string | null; tripId?: string | null; evidence: EvidenceRow | null; reason: string; previous?: Record<string, unknown> | null; proposed?: Record<string, unknown> | null; candidates?: string[]; fictional?: boolean }): ReviewRow {
    const fingerprint = digest([input.kind, input.bookingId ?? null, input.evidence?.id ?? null, input.proposed ?? null, input.candidates ?? []]);
    return repo.insertReview({
      kind: input.kind, bookingId: input.bookingId ?? null, tripId: input.tripId ?? null, evidenceIds: input.evidence ? [input.evidence.id] : [],
      reason: input.reason, previous: input.previous ?? null, proposed: input.proposed ?? null, candidates: input.candidates ?? [],
      sourceKey: input.evidence?.sourceKey ?? (input.bookingId ? repo.bookingRow(input.bookingId)?.sourceKey ?? "manual" : "manual"), fingerprint, fictional: input.fictional ?? input.evidence?.fictional ?? false,
    });
  }

  /** Trips a new booking can join, considering only unarchived trips. */
  function tripCandidates(booking: EffectiveBooking): TripRow[] {
    const trips = repo.trips().filter((trip) => !trip.archivedAt);
    const fits = matchTrips({ first: booking.firstDate, last: booking.lastDate, travelers: booking.travelers }, trips.map((trip) => ({ id: trip.id, startDate: trip.startDate, endDate: trip.endDate, travelers: trip.travelers, destinations: trip.destinations, archived: !!trip.archivedAt })));
    return fits.map((fit) => trips.find((trip) => trip.id === fit.id)!);
  }

  /** Grow a trip whose dates follow its bookings, and add the booking's destination. */
  function absorb(tripId: string, booking: EffectiveBooking) {
    const trip = repo.trip(tripId);
    if (!trip) return;
    const patch: Parameters<Repo["updateTrip"]>[1] = {};
    if (trip.datesSource !== "manual" && booking.firstDate && booking.lastDate) {
      const start = !trip.startDate || booking.firstDate < trip.startDate ? booking.firstDate : trip.startDate;
      const end = !trip.endDate || booking.lastDate > trip.endDate ? booking.lastDate : trip.endDate;
      if (start !== trip.startDate || end !== trip.endDate) Object.assign(patch, { startDate: start, endDate: end, datesSource: "derived" });
    }
    // A journey that leaves on the trip's last day heads home or onward, so it does not name a destination.
    const leaving = (booking.kind === "flight" || booking.kind === "train") && !!trip.endDate && !!booking.firstDate && booking.firstDate >= (patch.endDate ?? trip.endDate);
    const destination = leaving ? null : destinationOf(draftLike(booking), trip.homeZone ?? ctx.settings.homeZone);
    if (destination && !trip.destinations.some((item) => item.toLowerCase() === destination.toLowerCase())) patch.destinations = [...trip.destinations, destination].slice(0, 12);
    const travelers = [...trip.travelers];
    for (const name of booking.travelers) if (!travelers.some((item) => nameKey(item) === nameKey(name))) travelers.push(name);
    if (travelers.length !== trip.travelers.length) patch.travelers = travelers.slice(0, 20);
    if (Object.keys(patch).length) repo.updateTrip(tripId, patch);
  }

  function createTripFor(booking: EffectiveBooking, title: string | null, fictional: boolean): TripRow {
    const destination = destinationOf(draftLike(booking), ctx.settings.homeZone);
    return repo.insertTrip({
      title: title?.trim() || destination || booking.title,
      titleSource: title?.trim() ? "manual" : "derived",
      destinations: destination ? [destination] : [],
      startDate: booking.firstDate, endDate: booking.lastDate,
      datesSource: booking.firstDate ? "derived" : "unset",
      homeZone: ctx.settings.homeZone,
      travelers: booking.travelers,
      notes: null,
      sourceKey: booking.sourceKey,
      fictional,
    });
  }

  /** Put a new booking in a trip, or leave it unassigned with a Review item explaining why. */
  function place(bookingId: string, evidence: EvidenceRow | null, options: ApplyOptions): { tripId: string | null; reviewId: string | null } {
    const booking = repo.booking(bookingId)!;
    if (options.newTripTitle !== undefined && options.newTripTitle !== null) {
      const trip = createTripFor(booking, options.newTripTitle, !!options.fictional);
      repo.updateBooking(bookingId, { tripId: trip.id });
      return { tripId: trip.id, reviewId: null };
    }
    if (options.tripId !== undefined) {
      if (options.tripId) { repo.updateBooking(bookingId, { tripId: options.tripId }); absorb(options.tripId, booking); }
      return { tripId: options.tripId, reviewId: null };
    }
    const reasons: string[] = [];
    if (evidence?.forwarded) reasons.push("This confirmation was forwarded, so confirm who is traveling and which trip it belongs to.");
    if (booking.travelers.length > 1) reasons.push(`It lists ${booking.travelers.length} travelers (${booking.travelers.join(", ")}). Choose the trip it belongs to.`);
    const owners = ctx.settings.ownerNames.map(nameKey);
    if (owners.length && booking.travelers.length && !booking.travelers.some((name) => owners.includes(nameKey(name)) || travelerFit([name], ctx.settings.ownerNames) !== "different"))
      reasons.push(`It is for ${booking.travelers.join(", ")}. Add it to a trip if you are traveling too.`);
    const trips = tripCandidates(booking);
    if (!reasons.length && trips.length === 1) {
      repo.updateBooking(bookingId, { tripId: trips[0].id });
      absorb(trips[0].id, booking);
      return { tripId: trips[0].id, reviewId: null };
    }
    if (!reasons.length && trips.length > 1) reasons.push(`It fits more than one trip: ${trips.map((trip) => trip.title).join(" and ")}. Choose one.`);
    if (!reasons.length) {
      const trip = createTripFor(booking, null, !!options.fictional);
      repo.updateBooking(bookingId, { tripId: trip.id });
      return { tripId: trip.id, reviewId: null };
    }
    const item = review({ kind: "assign", bookingId, evidence, reason: reasons.join(" "), candidates: trips.map((trip) => trip.id), fictional: options.fictional });
    return { tripId: null, reviewId: item.id };
  }

  /** An exact provider confirmation may update the itinerary without asking. */
  function isExact(evidence: EvidenceRow, parsed: ParsedBooking, booking: EffectiveBooking, options: ApplyOptions): boolean {
    if (options.reviewed) return true;
    if (evidence.forwarded || parsed.method !== "deterministic") return false;
    if (!booking.sourceKeys.includes(evidence.sourceKey)) return false;
    const reference = normalizeReference(parsed.draft.reference);
    if (!reference || reference !== normalizeReference(booking.reference)) return false;
    const domains = repo.links(booking.id).filter((link) => link.contributes).map((link) => link.evidence.senderDomain).filter(Boolean);
    if (evidence.senderDomain && domains.includes(evidence.senderDomain)) return true;
    const sender = providerKey(evidence.sender);
    return !!sender && (sender === providerKey(booking.provider) || sender === providerKey(booking.title));
  }

  /** Differences between what a source says and the stored values, by field path. */
  function differences(booking: EffectiveBooking, parsed: ParsedBooking) {
    const { row, segments: segmentRows, stay: stayRow } = repo.parts(booking.id)!;
    const draftSegments = parsed.draft.segments ?? [];
    const structural = booking.kind !== "lodging" && draftSegments.length > 0 && draftSegments.length !== segmentRows.length;
    const values = draftValues(parsed.draft);
    const diffs: { path: string; before: unknown; after: unknown }[] = [];
    if (!structural)
      for (const [path, after] of values) {
        if (IGNORED_DIFFS.has(path)) continue;
        if (path === "status" && (after === "canceled" || (after === "planned" && row.status === "confirmed"))) continue;
        if (/^segments\.\d+\.(originLabel|destinationLabel)$/.test(path)) continue;
        const before = baseValue(row, segmentRows, stayRow, path);
        if (before === undefined) continue;
        if (!sameValue(path, before, after)) diffs.push({ path, before, after });
      }
    return { diffs, structural };
  }

  function changeFields(kind: EffectiveBooking["kind"], diffs: { path: string; before: unknown; after: unknown }[]) {
    return diffs.map((diff) => ({ field: diff.path, label: fieldLabel(diff.path, kind), before: displayValue(diff.path, diff.before), after: displayValue(diff.path, diff.after) }));
  }

  /** Apply an update from a source to an existing booking. */
  function updateExisting(booking: EffectiveBooking, evidence: EvidenceRow, parsed: ParsedBooking, options: ApplyOptions): Outcome {
    const base = { bookingId: booking.id, tripId: booking.tripId };
    if (parsed.cancellation) {
      if (booking.status === "canceled") {
        repo.link(booking.id, evidence.id, "duplicate", false, parsed.draft);
        return { ...base, action: "duplicate", reviewId: null, message: `${booking.title} is already canceled.` };
      }
      const statusCorrected = booking.corrections.some((item) => item.field === "status");
      if (isExact(evidence, parsed, booking, options) && !statusCorrected) {
        repo.setBase(booking.id, new Map([["status", "canceled"]]));
        repo.link(booking.id, evidence.id, "canceled", true, parsed.draft);
        repo.addSourceKey(booking.id, evidence.sourceKey);
        repo.addChange({ bookingId: booking.id, evidenceId: evidence.id, kind: "canceled", fields: [{ field: "status", label: "Status", before: displayValue("status", booking.status), after: "Canceled" }], actor: ctx.actor, sourceKey: evidence.sourceKey, note: "The provider confirmed the cancellation. It stays in history and its nights or times are no longer counted." });
        repo.bumpBooking(booking.id);
        return { ...base, action: "canceled", reviewId: null, message: `${booking.title} was canceled by the provider.` };
      }
      const item = review({ kind: "cancellation", bookingId: booking.id, tripId: booking.tripId, evidence, reason: statusCorrected ? `A cancellation arrived for ${booking.title}, but you set its status yourself. Choose which to keep.` : `A message says ${booking.title} was canceled. Confirm it matches this reservation before it is marked canceled.`, previous: { status: booking.status }, proposed: { status: "canceled" } });
      return { ...base, action: "review", reviewId: item.id, message: `Cancellation for ${booking.title} needs review.` };
    }
    const { diffs, structural } = differences(booking, parsed);
    if (structural) {
      const item = review({ kind: "change", bookingId: booking.id, tripId: booking.tripId, evidence, reason: `A newer message lists ${parsed.draft.segments!.length} legs for ${booking.title}, which had ${booking.segments.length}. Compare and choose.`, previous: { segments: booking.segments.map((segment) => `${segment.origin.code ?? segment.origin.label ?? "?"} to ${segment.destination.code ?? segment.destination.label ?? "?"}, ${segment.start.local}`) }, proposed: { segments: parsed.draft.segments!.map((segment) => `${segment.originCode ?? segment.originLabel ?? "?"} to ${segment.destinationCode ?? segment.destinationLabel ?? "?"}, ${segment.startLocal}`), draft: parsed.draft } });
      return { ...base, action: "review", reviewId: item.id, message: `${booking.title} has a changed itinerary to review.` };
    }
    // A planned booking becomes confirmed when the provider confirms it.
    if (parsed.draft.status === "confirmed" && booking.status === "planned" && !diffs.some((diff) => diff.path === "status")) diffs.push({ path: "status", before: "planned", after: "confirmed" });
    if (!diffs.length) {
      repo.link(booking.id, evidence.id, "duplicate", false, parsed.draft);
      return { ...base, action: "duplicate", reviewId: null, message: `${booking.title} was already recorded.` };
    }
    const overrides = new Map(repo.overrides(booking.id).map((item) => [item.field, item]));
    const exact = isExact(evidence, parsed, booking, options);
    if (!exact) {
      const item = review({ kind: "change", bookingId: booking.id, tripId: booking.tripId, evidence, reason: evidence.forwarded ? `A forwarded message shows different details for ${booking.title}. Confirm before the itinerary changes.` : `A message shows different details for ${booking.title}. Confirm before the itinerary changes.`, previous: Object.fromEntries(diffs.map((diff) => [diff.path, overrides.get(diff.path)?.value ?? diff.before])), proposed: Object.fromEntries(diffs.map((diff) => [diff.path, diff.after])) });
      return { ...base, action: "review", reviewId: item.id, message: `A change to ${booking.title} needs review.` };
    }
    // Exact: record what the source says. A correction stays in force until the person chooses.
    const conflicts = diffs.filter((diff) => overrides.has(diff.path) && !sameValue(diff.path, overrides.get(diff.path)!.value, diff.after));
    repo.setBase(booking.id, new Map(diffs.map((diff) => [diff.path, diff.after])));
    for (const diff of diffs) {
      const override = overrides.get(diff.path);
      if (!override) continue;
      if (sameValue(diff.path, override.value, diff.after)) repo.clearOverride(booking.id, diff.path);
      else repo.markOverride(booking.id, diff.path, { stale: true });
    }
    repo.link(booking.id, evidence.id, "changed", true, parsed.draft);
    repo.addSourceKey(booking.id, evidence.sourceKey);
    repo.addChange({ bookingId: booking.id, evidenceId: evidence.id, kind: "updated", fields: changeFields(booking.kind, diffs), actor: ctx.actor, sourceKey: evidence.sourceKey, note: conflicts.length ? `You corrected ${conflicts.map((diff) => fieldLabel(diff.path, booking.kind).toLowerCase()).join(" and ")}. Your correction is kept until you choose in Review.` : "The provider updated this booking." });
    repo.bumpBooking(booking.id);
    if (booking.tripId) absorb(booking.tripId, repo.booking(booking.id)!);
    if (conflicts.length) {
      const item = review({ kind: "change", bookingId: booking.id, tripId: booking.tripId, evidence, reason: `${booking.title} changed ${conflicts.map((diff) => fieldLabel(diff.path, booking.kind).toLowerCase()).join(" and ")}. Your earlier correction is kept until you choose.`, previous: Object.fromEntries(conflicts.map((diff) => [diff.path, overrides.get(diff.path)!.value])), proposed: Object.fromEntries(conflicts.map((diff) => [diff.path, diff.after])) });
      return { ...base, action: "review", reviewId: item.id, message: `${booking.title} changed a field you corrected.` };
    }
    return { ...base, action: "updated", reviewId: null, message: `${booking.title} was updated by the provider.` };
  }

  /** Apply one parsed booking from one source. Idempotent: applying the same source again changes nothing. */
  function apply(evidence: EvidenceRow, parsed: ParsedBooking, options: ApplyOptions = {}): Outcome {
    // One source can describe several bookings, such as a flight and a hotel. Each is applied once.
    const snapshot = JSON.stringify(parsed.draft);
    const already = repo.linksForEvidence(evidence.id).find((link) => JSON.stringify(link.snapshot) === snapshot);
    if (already && !options.forceNew && !options.linkTo) {
      const booking = repo.bookingRow(already.bookingId);
      return { action: "unchanged", bookingId: already.bookingId, tripId: booking?.tripId ?? null, reviewId: null, message: "This source was already applied." };
    }
    const reviewed = !!options.reviewed;
    const incomplete = !parsed.cancellation && (!isComplete(parsed) || parsed.ambiguous.length > 0);
    if (!reviewed && (incomplete || parsed.method === "ai")) {
      const reason = parsed.method === "ai"
        ? "Suggested by AI extraction from this source. Check each field against the quoted passages before it becomes a booking."
        : parsed.ambiguous.length
          ? `Confirm before adding: ${parsed.ambiguous.map((item) => item.reason).join(" ")}`
          : `Some details could not be read (${parsed.missing.filter((field) => !["reference", "travelers"].includes(field)).map((field) => field.replace(/^segments\.\d+\./, "").replace(/^stay\./, "")).join(", ") || "dates"}). Fill them in to add this booking.`;
      const item = review({ kind: "extraction", evidence, reason, proposed: { draft: parsed.draft, partial: parsed.partial ?? null, missing: parsed.missing, ambiguous: parsed.ambiguous, passages: parsed.passages, method: parsed.method } });
      return { action: "review", bookingId: null, tripId: null, reviewId: item.id, message: "Extracted details need confirmation." };
    }
    let candidates: EffectiveBooking[] = [];
    if (options.linkTo) {
      const target = repo.booking(options.linkTo);
      if (target) candidates = [target];
    } else if (!options.forceNew) {
      const identity = repo.bookingsBySourceIdentity(evidence);
      const thread = repo.bookingsInThread(evidence).filter((id) => {
        const row = repo.bookingRow(id);
        return !!row && !!normalizeReference(parsed.draft.reference) && normalizeReference(row.reference) === normalizeReference(parsed.draft.reference);
      });
      const known = [...new Set([...identity, ...thread])];
      candidates = known.length
        ? repo.bookings(null, { ids: known })
        : matchBookings({ draft: parsed.draft, kindGuessed: parsed.kindGuessed, provider: evidence.sender }, repo.bookings(null)).candidates;
    }
    if (candidates.length > 1) {
      const item = review({ kind: "identity", evidence, reason: `This message could describe ${candidates.length} recorded bookings (${candidates.map((booking) => `${booking.title}${booking.travelers.length ? ` for ${booking.travelers.join(" and ")}` : ""}`).join(", ")}). Choose the one it belongs to, or keep it separate.`, proposed: { draft: parsed.draft, cancellation: parsed.cancellation, passages: parsed.passages, method: parsed.method }, candidates: candidates.map((booking) => booking.id) });
      return { action: "review", bookingId: null, tripId: null, reviewId: item.id, message: "Several bookings could match." };
    }
    if (candidates.length === 1) return updateExisting(candidates[0], evidence, parsed, options);
    if (parsed.cancellation) {
      const item = review({ kind: "cancellation", evidence, reason: parsed.draft.reference ? `A cancellation for reference ${parsed.draft.reference} arrived, but no matching booking is recorded. Nothing was changed.` : "A cancellation arrived without a reference that matches a recorded booking. Nothing was changed.", proposed: { status: "canceled", reference: parsed.draft.reference ?? null } });
      return { action: "review", bookingId: null, tripId: null, reviewId: item.id, message: "Cancellation without a matching booking." };
    }
    const bookingId = repo.insertBooking({ ...parsed.draft, status: parsed.draft.status ?? "confirmed" }, { tripId: null, method: parsed.method, sourceKey: evidence.sourceKey, fictional: options.fictional ?? evidence.fictional });
    repo.link(bookingId, evidence.id, "created", true, parsed.draft);
    repo.addChange({ bookingId, evidenceId: evidence.id, kind: "created", fields: [], actor: ctx.actor, sourceKey: evidence.sourceKey, note: evidence.origin === "gmail" ? "Imported from a confirmation email." : evidence.origin === "file" ? "Imported from an uploaded file." : evidence.origin === "paste" ? "Imported from pasted text." : "Recorded from a source." });
    const placed = place(bookingId, evidence, options);
    const title = repo.bookingRow(bookingId)!.title;
    return { action: "created", bookingId, tripId: placed.tripId, reviewId: placed.reviewId, message: placed.reviewId ? `${title} was added and waits in Review for a trip.` : `${title} was added.` };
  }

  return { apply, place, absorb, review, createTripFor, tripCandidates, differences, changeFields };
}
export type Ingest = ReturnType<typeof createIngest>;

/** A booking as a draft for destination naming. */
function draftLike(booking: EffectiveBooking): BookingDraft {
  return {
    kind: booking.kind,
    stay: booking.stay ? { propertyName: booking.stay.propertyName, address: booking.stay.address, checkInDate: booking.stay.checkInDate, checkOutDate: booking.stay.checkOutDate } : null,
    segments: booking.segments.map((segment) => ({ number: segment.number, originLabel: segment.origin.label, originCode: segment.origin.code, destinationLabel: segment.destination.label, destinationCode: segment.destination.code, startLocal: segment.start.local, startZone: segment.start.zone, endLocal: segment.end?.local ?? null, endZone: segment.end?.zone ?? null, address: segment.address })),
  };
}

/** Days from a booking's start to a trip, for sorting suggestions. */
export function distanceToTrip(booking: EffectiveBooking, trip: TripRow): number {
  if (!booking.firstDate || !trip.startDate) return Number.POSITIVE_INFINITY;
  return Math.abs(daysBetween(booking.firstDate, trip.startDate));
}

/** Whether a scoped caller may see a review item. */
export function reviewVisible(scope: AccessScope, item: ReviewRow, repo: Repo): boolean {
  if (scope.kind === "owner") return true;
  if (!allows(scope, item.sourceKey)) return false;
  if (item.bookingId) {
    const row = repo.bookingRow(item.bookingId);
    if (row && !row.sourceKeys.every((key) => allows(scope, key))) return false;
  }
  return true;
}
export { draftDates };
