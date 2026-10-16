/**
 * Local record changes. Every update checks the expected revision and
 * returns the current record on conflict so the view can compare. A
 * correction to an imported booking is stored beside the source value, so a
 * later import cannot silently replace it.
 */
import { z } from "zod/v4";
import { AppError } from "@ri/app-kit/contract";
import { allows, allowsAll, type AccessScope } from "@ri/app-kit/data";
import { isValidZone } from "@ri/app-kit/time";
import { baseValue, displayValue, type EffectiveBooking } from "../domain/booking.js";
import { computeCoverage } from "../domain/coverage.js";
import { bookingDraftSchema, fieldLabel, MANUAL_SOURCE, type BookingDraft, type ParsedBooking } from "../domain/model.js";
import { airport } from "../domain/places.js";
import type { TripRow } from "../db/repo.js";
import type { bookingPatchSchema, dismissGapInput, reviewChangeInput, saveBookingInput, saveIdeaInput, saveTripInput } from "../actions/schemas.js";
import type { Travel } from "./core.js";
import { createReadModel } from "./records.js";
import { reviewVisible } from "./ingest.js";

type SaveTrip = z.infer<typeof saveTripInput>;
type SaveBooking = z.infer<typeof saveBookingInput>;
type BookingPatch = z.infer<typeof bookingPatchSchema>;
type SaveIdea = z.infer<typeof saveIdeaInput>;
type ReviewChange = z.infer<typeof reviewChangeInput>;
type DismissGap = z.infer<typeof dismissGapInput>;

const STALE = "This changed since you opened it. Compare the current values and try again.";

/** Fill zones a person did not type from airport codes, and require the parts each kind needs. */
export function completeDraft(draft: BookingDraft): BookingDraft {
  const segments = (draft.segments ?? []).map((segment) => ({
    ...segment,
    originCode: segment.originCode?.toUpperCase() ?? null,
    destinationCode: segment.destinationCode?.toUpperCase() ?? null,
    startZone: segment.startZone ?? airport(segment.originCode)?.zone ?? null,
    endZone: segment.endZone ?? airport(segment.destinationCode)?.zone ?? (draft.kind === "activity" || draft.kind === "car" ? segment.startZone ?? airport(segment.originCode)?.zone ?? null : null),
  }));
  // Times can look reversed across zones, but an end date before the start date is always a mistake.
  for (const segment of segments) if (segment.endLocal && segment.endLocal.slice(0, 10) < segment.startLocal.slice(0, 10))
    throw new AppError("invalid_input", "The end date is before the start date");
  if (draft.kind === "lodging" && !draft.stay) throw new AppError("invalid_input", "A stay needs check-in and check-out dates");
  if (draft.kind !== "lodging" && !segments.length) throw new AppError("invalid_input", "Add a date and time for this booking");
  return { ...draft, segments: draft.kind === "lodging" ? [] : segments, stay: draft.kind === "lodging" ? draft.stay : null, travelers: draft.travelers ?? [] };
}

export function createWrites(t: Travel) {
  const { repo } = t;
  const read = createReadModel(t);

  function writableTrip(scope: AccessScope, id: string): TripRow {
    const trip = repo.trip(id);
    if (!trip) throw new AppError("not_found", "That trip is no longer available");
    if (!allows(scope, trip.sourceKey)) throw new AppError("forbidden", "This caller may not change that trip");
    return trip;
  }
  function writableBooking(scope: AccessScope, id: string): EffectiveBooking {
    const booking = repo.booking(id);
    if (!booking || !allowsAll(scope, booking.sourceKeys)) throw new AppError("not_found", "That booking is no longer available");
    return booking;
  }

  function saveTrip(scope: AccessScope, _actor: string, input: SaveTrip) {
    if (input.startDate && input.endDate && input.endDate < input.startDate) throw new AppError("invalid_input", "The trip ends before it starts");
    if ((input.startDate === null) !== (input.endDate === null) && input.startDate !== undefined && input.endDate !== undefined) throw new AppError("invalid_input", "Set both trip dates, or clear both");
    if (!input.id) {
      if (!input.title) throw new AppError("invalid_input", "Name the trip");
      if (!allows(scope, MANUAL_SOURCE)) throw new AppError("forbidden", "This caller may not add trips");
      const hasDates = !!input.startDate && !!input.endDate;
      const trip = repo.insertTrip({
        title: input.title, titleSource: "manual", destinations: [input.title], startDate: hasDates ? input.startDate! : null, endDate: hasDates ? input.endDate! : null,
        datesSource: hasDates ? "manual" : "unset", homeZone: input.homeZone ?? t.settings.get().homeZone, travelers: input.travelers ?? t.settings.get().ownerNames, notes: input.notes ?? null, sourceKey: MANUAL_SOURCE,
      });
      return { status: "saved" as const, record: read.stripCoverage(read.tripRecord(scope, trip)) };
    }
    const trip = writableTrip(scope, input.id);
    if (input.expectedRevision === undefined) throw new AppError("invalid_input", "Include the revision you edited");
    if (trip.revision !== input.expectedRevision) return { status: "conflict" as const, current: read.stripCoverage(read.tripRecord(scope, trip)), message: STALE };
    const patch: Parameters<typeof repo.updateTrip>[1] = {};
    if (input.title !== undefined) Object.assign(patch, { title: input.title, titleSource: "manual" });
    if (input.startDate !== undefined || input.endDate !== undefined) {
      const start = input.startDate !== undefined ? input.startDate : trip.startDate;
      const end = input.endDate !== undefined ? input.endDate : trip.endDate;
      if (start && end && end < start) throw new AppError("invalid_input", "The trip ends before it starts");
      Object.assign(patch, { startDate: start, endDate: end, datesSource: start && end ? "manual" : "unset" });
    }
    if (input.homeZone !== undefined) patch.homeZone = input.homeZone && isValidZone(input.homeZone) ? input.homeZone : null;
    if (input.travelers !== undefined) patch.travelers = input.travelers;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.archived !== undefined) patch.archivedAt = input.archived ? (trip.archivedAt ?? repo.iso()) : null;
    repo.updateTrip(trip.id, patch);
    return { status: "saved" as const, record: read.stripCoverage(read.tripRecord(scope, repo.trip(trip.id)!)) };
  }

  /** Field paths and values from a correction patch. */
  function patchValues(booking: EffectiveBooking, patch: BookingPatch): Map<string, unknown> {
    const values = new Map<string, unknown>();
    for (const key of ["title", "provider", "reference", "travelers", "status"] as const) if (patch[key] !== undefined) values.set(key, patch[key]);
    if (patch.stay) {
      if (!booking.stay) throw new AppError("invalid_input", "This booking has no stay to correct");
      for (const [key, value] of Object.entries(patch.stay)) if (value !== undefined) values.set(`stay.${key}`, value);
    }
    for (const segment of patch.segments ?? []) {
      if (!booking.segments.some((item) => item.sequence === segment.sequence)) throw new AppError("invalid_input", "That leg does not exist");
      for (const [key, value] of Object.entries(segment)) if (key !== "sequence" && value !== undefined) values.set(`segments.${segment.sequence}.${key}`, key.endsWith("Code") && typeof value === "string" ? value.toUpperCase() : value);
      if (segment.originCode && segment.startZone === undefined && airport(segment.originCode)) values.set(`segments.${segment.sequence}.startZone`, airport(segment.originCode)!.zone);
      if (segment.destinationCode && segment.endZone === undefined && airport(segment.destinationCode)) values.set(`segments.${segment.sequence}.endZone`, airport(segment.destinationCode)!.zone);
    }
    // Validate the result before writing anything.
    const next = (path: string, current: unknown) => (values.has(path) ? values.get(path) : current);
    if (booking.stay) {
      const checkIn = next("stay.checkInDate", booking.stay.checkInDate) as string, checkOut = next("stay.checkOutDate", booking.stay.checkOutDate) as string;
      if (checkOut <= checkIn) throw new AppError("invalid_input", "Check-out must be after check-in");
    }
    for (const segment of booking.segments) {
      const start = next(`segments.${segment.sequence}.startLocal`, segment.start.local) as string;
      const end = next(`segments.${segment.sequence}.endLocal`, segment.end?.local ?? null) as string | null;
      if (end && end.slice(0, 10) < start.slice(0, 10)) throw new AppError("invalid_input", "An arrival or end date is before its start");
    }
    return values;
  }

  function saveBooking(scope: AccessScope, actor: string, input: SaveBooking) {
    if (!input.id) {
      if (!input.draft) throw new AppError("invalid_input", "Describe the booking to add");
      if (!allows(scope, MANUAL_SOURCE)) throw new AppError("forbidden", "This caller may not add bookings");
      const draft = completeDraft(bookingDraftSchema.parse(input.draft));
      if (input.tripId) writableTrip(scope, input.tripId);
      const ingest = t.ingest(actor);
      const id = repo.insertBooking({ ...draft, status: draft.status ?? "confirmed" }, { tripId: null, method: "manual", sourceKey: MANUAL_SOURCE });
      repo.addChange({ bookingId: id, evidenceId: null, kind: "created", fields: [], actor, sourceKey: MANUAL_SOURCE, note: "Entered by you." });
      ingest.place(id, null, input.tripId !== undefined ? { tripId: input.tripId } : {});
      if (input.notes !== undefined) repo.updateBooking(id, { notes: input.notes });
      return { status: "saved" as const, record: read.bookingRecord(scope, repo.booking(id)!) };
    }
    const booking = writableBooking(scope, input.id);
    if (input.expectedRevision === undefined) throw new AppError("invalid_input", "Include the revision you edited");
    if (booking.revision !== input.expectedRevision) return { status: "conflict" as const, current: read.bookingRecord(scope, booking), message: STALE };
    const parts = repo.parts(booking.id)!;
    let changed = false;
    if (input.patch) {
      const values = patchValues(booking, input.patch);
      const fields: { field: string; label: string; before: string; after: string }[] = [];
      const effective = new Map<string, unknown>(booking.corrections.map((item) => [item.field, item.value]));
      for (const [path, value] of values) {
        const base = baseValue(parts.row, parts.segments, parts.stay, path);
        const before = effective.has(path) ? effective.get(path) : base;
        if (JSON.stringify(before ?? null) === JSON.stringify(value ?? null)) continue;
        fields.push({ field: path, label: fieldLabel(path, booking.kind), before: displayValue(path, before), after: displayValue(path, value) });
        if (booking.method === "manual") repo.setBase(booking.id, new Map([[path, value]]));
        else if (JSON.stringify(base ?? null) === JSON.stringify(value ?? null)) repo.clearOverride(booking.id, path);
        else repo.setOverride(booking.id, path, value, base, actor);
      }
      if (fields.length) {
        repo.addChange({ bookingId: booking.id, evidenceId: null, kind: booking.method === "manual" ? "edited" : "corrected", fields, actor, sourceKey: MANUAL_SOURCE, note: booking.method === "manual" ? "Edited by you." : "Corrected by you. The original value is kept with the source, and later imports will not replace your correction." });
        changed = true;
      }
    }
    for (const path of input.clearCorrections ?? []) {
      const correction = booking.corrections.find((item) => item.field === path);
      if (!correction) continue;
      repo.clearOverride(booking.id, path);
      const base = baseValue(parts.row, parts.segments, parts.stay, path);
      repo.addChange({ bookingId: booking.id, evidenceId: null, kind: "correction_removed", fields: [{ field: path, label: fieldLabel(path, booking.kind), before: displayValue(path, correction.value), after: displayValue(path, base) }], actor, sourceKey: MANUAL_SOURCE, note: "Your correction was removed. The source value applies again." });
      changed = true;
    }
    if (input.tripId !== undefined && input.tripId !== booking.tripId) {
      const target = input.tripId ? writableTrip(scope, input.tripId) : null;
      const from = booking.tripId ? repo.trip(booking.tripId)?.title ?? "another trip" : "Unassigned";
      repo.updateBooking(booking.id, { tripId: target?.id ?? null });
      if (target) t.ingest(actor).absorb(target.id, repo.booking(booking.id)!);
      repo.addChange({ bookingId: booking.id, evidenceId: null, kind: "moved", fields: [{ field: "trip", label: "Trip", before: from, after: target?.title ?? "Unassigned" }], actor, sourceKey: MANUAL_SOURCE, note: "Moved by you. Sources and corrections stay with the booking." });
      if (target) repo.supersedeReviews(booking.id, ["assign"], actor);
      changed = true;
    }
    if (input.notes !== undefined && input.notes !== booking.notes) { repo.updateBooking(booking.id, { notes: input.notes }); changed = true; }
    if (changed) repo.bumpBooking(booking.id);
    return { status: "saved" as const, record: read.bookingRecord(scope, repo.booking(booking.id)!) };
  }

  function deleteBooking(scope: AccessScope, actor: string, input: { id: string; expectedRevision: number }) {
    const booking = writableBooking(scope, input.id);
    if (booking.revision !== input.expectedRevision) return { status: "conflict" as const, current: read.bookingRecord(scope, booking), message: STALE };
    for (const link of repo.links(booking.id)) if (link.evidence.parseStatus !== "ignored") repo.updateEvidence(link.evidence.id, { parseNote: `Booking removed by ${actor.startsWith("owner") ? "you" : "a caller"}` });
    repo.deleteBooking(booking.id);
    return { status: "deleted" as const, id: booking.id };
  }

  function saveIdea(scope: AccessScope, input: SaveIdea) {
    if (input.priceMinor !== undefined && input.priceMinor !== null && !input.currency) {
      const existing = input.id ? repo.idea(input.id) : null;
      if (!existing?.currency) throw new AppError("invalid_input", "Add the currency for this price");
    }
    if (!input.id) {
      if (!input.tripId || !input.title) throw new AppError("invalid_input", "Choose a trip and name the idea");
      writableTrip(scope, input.tripId);
      if (!allows(scope, MANUAL_SOURCE)) throw new AppError("forbidden", "This caller may not add ideas");
      const idea = repo.insertIdea({
        tripId: input.tripId, kind: input.kind ?? "place", title: input.title, note: input.note ?? null, url: input.url ?? null,
        priceMinor: input.priceMinor ?? null, currency: input.priceMinor === null || input.priceMinor === undefined ? input.currency ?? null : input.currency ?? null,
        observedAt: input.observedAt ?? (input.priceMinor !== undefined && input.priceMinor !== null ? t.today() : null),
        location: input.location ?? null, conditions: input.conditions ?? null, sourceLabel: input.sourceLabel ?? (input.url ? hostOf(input.url) : "Your idea"), sourceKey: MANUAL_SOURCE, fictional: false,
      });
      return { status: "saved" as const, record: read.ideaRecord(idea) };
    }
    const idea = repo.idea(input.id);
    if (!idea || !allows(scope, idea.sourceKey)) throw new AppError("not_found", "That idea is no longer available");
    if (input.expectedRevision === undefined) throw new AppError("invalid_input", "Include the revision you edited");
    if (idea.revision !== input.expectedRevision) return { status: "conflict" as const, current: read.ideaRecord(idea), message: STALE };
    if (input.tripId && input.tripId !== idea.tripId) writableTrip(scope, input.tripId);
    const priceChanged = (input.priceMinor !== undefined && input.priceMinor !== idea.priceMinor) || (input.currency !== undefined && input.currency !== idea.currency);
    repo.updateIdea(idea.id, {
      tripId: input.tripId, kind: input.kind, title: input.title, note: input.note, url: input.url, priceMinor: input.priceMinor, currency: input.currency,
      observedAt: input.observedAt !== undefined ? input.observedAt : priceChanged ? t.today() : undefined,
      location: input.location, conditions: input.conditions, sourceLabel: input.sourceLabel,
      removedAt: input.removed === undefined ? undefined : input.removed ? repo.iso() : null,
    });
    return { status: "saved" as const, record: read.ideaRecord(repo.idea(idea.id)!) };
  }

  function dismissGap(scope: AccessScope, actor: string, input: DismissGap) {
    const trip = writableTrip(scope, input.tripId);
    const view = read.visibleTrip(scope, trip);
    const coverage = () => computeCoverage({ startDate: trip.startDate, endDate: trip.endDate, bookings: view.bookings, dismissals: repo.dismissals(trip.id) });
    if (input.restore) repo.restoreGap(trip.id, input.key);
    else {
      const gap = coverage().gaps.find((item) => item.key === input.key);
      if (!gap) throw new AppError("conflict", "This gap is no longer open. The itinerary changed");
      if (gap.fingerprint !== input.fingerprint) throw new AppError("conflict", "The bookings around this gap changed. Review it again");
      repo.dismissGap(trip.id, input.key, gap.fingerprint, actor, input.note ?? null);
    }
    const result = coverage();
    return { status: "saved" as const, coverage: { ...result, gaps: result.gaps.map((gap) => ({ ...gap, message: gap.message.slice(0, 500) })) } };
  }

  /** Apply a person's decision on a review item. */
  function reviewChange(scope: AccessScope, actor: string, input: ReviewChange) {
    const item = repo.review(input.id);
    if (!item || !reviewVisible(scope, item, repo)) throw new AppError("not_found", "That review item is no longer available");
    const current = () => read.reviewRecord(scope, repo.review(item.id)!);
    if (item.decision) return { status: "conflict" as const, current: current(), message: "This was already decided." };
    if (item.revision !== input.expectedRevision) return { status: "conflict" as const, current: current(), message: STALE };
    const record = read.reviewRecord(scope, item);
    if (!record.decisions.includes(input.decision)) throw new AppError("invalid_input", "That choice does not apply to this item");
    const ingest = t.ingest(actor);
    const evidence = item.evidenceIds.length ? repo.evidence(item.evidenceIds[0]) : null;
    let bookingId: string | null = item.bookingId;
    let tripId: string | null = null;
    let message = "Decision saved.";
    const proposed = item.proposed ?? {};
    const parsedFrom = (draft: BookingDraft, method: ParsedBooking["method"], cancellation = false): ParsedBooking => ({ draft, passages: (proposed.passages as string[]) ?? [], missing: [], ambiguous: [], change: false, cancellation, method });

    switch (item.kind) {
      case "assign": {
        const booking = writableBooking(scope, item.bookingId!);
        if (input.decision === "assign") {
          if (!input.tripId) throw new AppError("invalid_input", "Choose a trip");
          const trip = writableTrip(scope, input.tripId);
          repo.updateBooking(booking.id, { tripId: trip.id });
          ingest.absorb(trip.id, booking);
          repo.addChange({ bookingId: booking.id, evidenceId: null, kind: "moved", fields: [{ field: "trip", label: "Trip", before: "Unassigned", after: trip.title }], actor, sourceKey: MANUAL_SOURCE, note: "Added to a trip from Review." });
          repo.bumpBooking(booking.id);
          tripId = trip.id;
          message = `${booking.title} is in ${trip.title}.`;
        } else if (input.decision === "new_trip") {
          if (!allows(scope, MANUAL_SOURCE) && !allows(scope, booking.sourceKey)) throw new AppError("forbidden", "This caller may not add trips");
          const trip = ingest.createTripFor(booking, input.newTripTitle ?? null, booking.fictional);
          repo.updateBooking(booking.id, { tripId: trip.id });
          repo.addChange({ bookingId: booking.id, evidenceId: null, kind: "moved", fields: [{ field: "trip", label: "Trip", before: "Unassigned", after: trip.title }], actor, sourceKey: MANUAL_SOURCE, note: "Started a new trip from Review." });
          repo.bumpBooking(booking.id);
          tripId = trip.id;
          message = `${booking.title} starts a new trip, ${trip.title}.`;
        } else message = `${booking.title} stays unassigned.`;
        break;
      }
      case "change": {
        const booking = writableBooking(scope, item.bookingId!);
        tripId = booking.tripId;
        if (input.decision === "accept") {
          const fields: { field: string; label: string; before: string; after: string }[] = [];
          if (proposed.draft && Array.isArray(proposed.segments)) {
            const draft = completeDraft(bookingDraftSchema.parse(proposed.draft));
            repo.replaceParts(booking.id, { ...draft, kind: booking.kind });
            for (const correction of booking.corrections) if (correction.field.startsWith("segments.")) repo.clearOverride(booking.id, correction.field);
            fields.push({ field: "segments", label: "Legs", before: displayValue("segments", item.previous?.segments ?? null), after: displayValue("segments", proposed.segments) });
          } else {
            const values = new Map(Object.entries(proposed));
            const parts = repo.parts(booking.id)!;
            for (const [path, value] of values) {
              const before = booking.corrections.find((correction) => correction.field === path)?.value ?? baseValue(parts.row, parts.segments, parts.stay, path);
              fields.push({ field: path, label: fieldLabel(path, booking.kind), before: displayValue(path, before), after: displayValue(path, value) });
            }
            repo.setBase(booking.id, values);
            for (const path of values.keys()) if (booking.corrections.some((correction) => correction.field === path)) repo.clearOverride(booking.id, path);
          }
          if (evidence) { repo.link(booking.id, evidence.id, "changed", true, proposed); repo.addSourceKey(booking.id, evidence.sourceKey); }
          repo.addChange({ bookingId: booking.id, evidenceId: evidence?.id ?? null, kind: "updated", fields, actor, sourceKey: evidence?.sourceKey ?? MANUAL_SOURCE, note: "You accepted the newer details." });
          repo.bumpBooking(booking.id);
          if (booking.tripId) ingest.absorb(booking.tripId, repo.booking(booking.id)!);
          message = `${booking.title} now uses the newer details.`;
        } else {
          for (const path of Object.keys(proposed)) if (booking.corrections.some((correction) => correction.field === path)) repo.markOverride(booking.id, path, { stale: false, original: proposed[path] });
          if (evidence) repo.link(booking.id, evidence.id, "linked", false, proposed);
          repo.addChange({ bookingId: booking.id, evidenceId: evidence?.id ?? null, kind: "kept", fields: Object.keys(proposed).filter((path) => path !== "draft" && path !== "segments").map((path) => ({ field: path, label: fieldLabel(path, booking.kind), before: displayValue(path, booking.corrections.find((correction) => correction.field === path)?.value ?? item.previous?.[path] ?? null), after: displayValue(path, proposed[path]) })), actor, sourceKey: evidence?.sourceKey ?? MANUAL_SOURCE, note: "You kept the recorded details. The newer source stays in history." });
          repo.bumpBooking(booking.id);
          message = `${booking.title} keeps your details.`;
        }
        break;
      }
      case "cancellation": {
        if (input.decision === "dismiss") {
          if (evidence) repo.updateEvidence(evidence.id, { parseStatus: "ignored", parseNote: "Dismissed in Review" });
          message = "Nothing was changed.";
          break;
        }
        const targetId = item.bookingId ?? input.bookingId;
        if (!targetId) throw new AppError("invalid_input", "Choose the booking this cancellation belongs to");
        const booking = writableBooking(scope, targetId);
        tripId = booking.tripId;
        bookingId = booking.id;
        if (input.decision === "keep") {
          if (evidence) repo.link(booking.id, evidence.id, "linked", false, proposed);
          repo.addChange({ bookingId: booking.id, evidenceId: evidence?.id ?? null, kind: "kept", fields: [], actor, sourceKey: evidence?.sourceKey ?? MANUAL_SOURCE, note: "You kept this booking active. The cancellation message stays in history." });
          repo.bumpBooking(booking.id);
          message = `${booking.title} stays ${booking.status}.`;
        } else {
          repo.setBase(booking.id, new Map([["status", "canceled"]]));
          if (booking.corrections.some((correction) => correction.field === "status")) repo.clearOverride(booking.id, "status");
          if (evidence) { repo.link(booking.id, evidence.id, "canceled", true, proposed); repo.addSourceKey(booking.id, evidence.sourceKey); }
          repo.addChange({ bookingId: booking.id, evidenceId: evidence?.id ?? null, kind: "canceled", fields: [{ field: "status", label: "Status", before: displayValue("status", booking.status), after: "Canceled" }], actor, sourceKey: evidence?.sourceKey ?? MANUAL_SOURCE, note: "You confirmed the cancellation. It stays in history." });
          repo.bumpBooking(booking.id);
          message = `${booking.title} is marked canceled.`;
        }
        break;
      }
      case "identity": {
        if (!evidence) throw new AppError("not_found", "The source for this item is no longer available");
        const draft = completeDraft(bookingDraftSchema.parse(proposed.draft));
        const parsed = parsedFrom(draft, (proposed.method as ParsedBooking["method"]) ?? "deterministic", !!proposed.cancellation);
        if (input.decision === "link") {
          if (!input.bookingId || !item.candidates.includes(input.bookingId)) throw new AppError("invalid_input", "Choose one of the listed bookings");
          writableBooking(scope, input.bookingId);
          const outcome = ingest.apply(evidence, parsed, { linkTo: input.bookingId, reviewed: true });
          bookingId = outcome.bookingId; tripId = outcome.tripId; message = outcome.message;
        } else if (input.decision === "separate") {
          const outcome = ingest.apply(evidence, parsed, { forceNew: true, reviewed: true, ...(input.tripId ? { tripId: input.tripId } : {}) });
          bookingId = outcome.bookingId; tripId = outcome.tripId; message = outcome.message;
        } else {
          repo.updateEvidence(evidence.id, { parseStatus: "ignored", parseNote: "Dismissed in Review" });
          message = "Nothing was changed.";
        }
        break;
      }
      case "extraction":
      case "unreadable": {
        if (input.decision === "dismiss") {
          if (evidence) repo.updateEvidence(evidence.id, { parseStatus: "ignored", parseNote: "Dismissed in Review" });
          message = "Dismissed. The source is kept.";
          break;
        }
        const source = input.draft ?? (proposed.draft as BookingDraft | undefined);
        if (!source) throw new AppError("invalid_input", "Fill in the booking details");
        const draft = completeDraft(bookingDraftSchema.parse(source));
        if (input.tripId) writableTrip(scope, input.tripId);
        if (!evidence) throw new AppError("not_found", "The source for this item is no longer available");
        // Values the person typed or changed count as entered by hand. Accepted suggestions keep their method.
        const edited = !!input.draft && JSON.stringify(input.draft) !== JSON.stringify(proposed.draft ?? null);
        const proposedMethod = (proposed.method as ParsedBooking["method"] | undefined) ?? "deterministic";
        const enteredByHand = item.kind === "unreadable" || edited;
        const outcome = ingest.apply(evidence, parsedFrom(draft, enteredByHand ? "deterministic" : proposedMethod), { reviewed: true, ...(input.tripId ? { tripId: input.tripId } : {}), ...(input.newTripTitle ? { newTripTitle: input.newTripTitle } : {}) });
        if (outcome.bookingId && outcome.action === "created" && enteredByHand) repo.run("UPDATE bookings SET method = 'manual' WHERE id = ?", outcome.bookingId);
        repo.updateEvidence(evidence.id, { parseStatus: "parsed", parseNote: "Confirmed in Review" });
        bookingId = outcome.bookingId; tripId = outcome.tripId; message = outcome.message;
        break;
      }
    }
    repo.decideReview(item.id, input.decision, actor);
    return { status: "saved" as const, record: read.reviewRecord(scope, repo.review(item.id)!), bookingId, tripId, message: message.slice(0, 300) };
  }

  return { saveTrip, saveBooking, deleteBooking, saveIdea, dismissGap, reviewChange };
}

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Saved link"; }
}
