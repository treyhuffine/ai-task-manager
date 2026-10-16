/**
 * Read model. Every projection takes the caller's scope and assembles only
 * what that scope may see: bookings whose contributing sources are all
 * allowed, source references from allowed sources, and trips projected from
 * visible bookings when the trip itself came from another source.
 */
import { allows, type AccessScope } from "@ri/app-kit/data";
import { addDays, formatDate, formatDateRange, formatInstant, instantFromLocal, isValidZone, todayIn } from "@ri/app-kit/time";
import { describeEndpoint } from "../domain/clock.js";
import { findCityZone } from "../domain/places.js";
import { displayValue, type EffectiveBooking } from "../domain/booking.js";
import { computeCoverage, type TripCoverage } from "../domain/coverage.js";
import { buildItinerary, compareBookings, dayZoneLine } from "../domain/itinerary.js";
import { fieldLabel, KIND_LABELS, STATUS_LABELS, type BookingDraft, type ReviewDecision, type TripState } from "../domain/model.js";
import type { EvidenceRow, FollowUpRow, IdeaRow, ReviewRow, TripRow } from "../db/repo.js";
import type { BookingRecord, FollowUpRecord, IdeaRecord, ReviewItemRecord, TripRecord } from "../actions/schemas.js";
import { reviewVisible } from "./ingest.js";
import type { Travel } from "./core.js";
import { bookingDraftSchema } from "../domain/model.js";

export const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);
const clipNull = (value: string | null | undefined, max: number) => (value ? clip(value, max) : null);

export function evidenceLabel(evidence: EvidenceRow, accountLabel?: string | null): string {
  switch (evidence.origin) {
    case "gmail": return clip(`Email${evidence.sender ? ` from ${evidence.sender}` : ""}${accountLabel ? ` in ${accountLabel}` : ""}`, 200);
    case "file": return clip(`Uploaded ${evidence.fileName ?? "file"}`, 200);
    case "paste": return "Pasted confirmation";
    case "manual": return "Entered by you";
    case "fixture": return clip(`Fictional example email${evidence.sender ? ` from ${evidence.sender}` : ""}`, 200);
  }
}
export function shortSourceLabel(evidence: EvidenceRow | null, method: string): string {
  if (!evidence) return method === "manual" ? "Entered by you" : "Recorded";
  if (evidence.origin === "gmail" || evidence.origin === "fixture") return "Confirmation email";
  if (evidence.origin === "file") return "Uploaded file";
  if (evidence.origin === "paste") return "Pasted confirmation";
  return "Entered by you";
}

export function tripState(trip: Pick<TripRow, "archivedAt" | "startDate" | "endDate">, today: string): TripState {
  if (trip.archivedAt) return "archived";
  if (!trip.startDate || !trip.endDate) return "planning";
  if (today < trip.startDate) return "planning";
  if (today > trip.endDate) return "completed";
  return "active";
}

export function dateLabel(first: string | null, last: string | null): string {
  if (!first) return "Dates not recorded";
  return formatDateRange(first, last ?? first);
}

export function createReadModel(t: Travel) {
  const { repo } = t;
  const accountLabels = () => new Map(t.accounts.list().map((account) => [account.account, account.label]));

  function sourceRef(link: { role: string; evidence: EvidenceRow }, labels: Map<string, string | null>) {
    const evidence = link.evidence;
    return {
      evidenceId: evidence.id,
      role: link.role as "created",
      origin: evidence.origin,
      title: clip(evidence.title, 300),
      sender: clipNull(evidence.sender, 200),
      receivedAt: evidence.receivedAt,
      observedAt: evidence.observedAt,
      availability: evidence.availability,
      sourceLabel: evidenceLabel(evidence, evidence.account ? labels.get(evidence.account) ?? null : null),
      method: evidence.parseMethod,
      fictional: evidence.fictional,
    };
  }

  function bookingSummary(booking: EffectiveBooking): string {
    const range = dateLabel(booking.firstDate, booking.lastDate);
    if (booking.stay) return clip(`${range}, ${booking.stay.nights} night${booking.stay.nights === 1 ? "" : "s"}${booking.stay.address ? `, ${booking.stay.address}` : ""}`, 300);
    const first = booking.segments[0], last = booking.segments.at(-1);
    if (!first) return range;
    if (booking.kind === "flight" || booking.kind === "train") {
      const route = booking.segments.map((segment) => segment.origin.code ?? segment.origin.label ?? "?").concat(last?.destination.code ?? last?.destination.label ?? "?").join(" to ");
      return clip(`${route}, ${describeEndpoint(first.start)}`, 300);
    }
    return clip(`${describeEndpoint(first.start)}${first.address ? `, ${first.address}` : ""}`, 300);
  }

  function bookingRecord(scope: AccessScope, booking: EffectiveBooking, options: { tripTitle?: string | null; labels?: Map<string, string | null>; reviews?: ReviewRow[] } = {}): BookingRecord {
    const labels = options.labels ?? accountLabels();
    const links = repo.links(booking.id).filter((link) => allows(scope, link.evidence.sourceKey));
    const sources = links.slice(0, 50).map((link) => sourceRef(link, labels));
    const unavailable = sources.filter((source) => source.availability === "unavailable").length;
    const missing: string[] = [];
    if (!booking.reference) missing.push("Confirmation number");
    if (!booking.travelers.length) missing.push("Travelers");
    if (booking.segments.some((segment) => segment.start.resolution === "zone_missing" || segment.end?.resolution === "zone_missing")) missing.push("Time zone");
    if (booking.kind === "flight" && booking.segments.some((segment) => !segment.end)) missing.push("Arrival time");
    const reviews = (options.reviews ?? repo.reviews({ open: true, bookingId: booking.id })).filter((item) => item.bookingId === booking.id && !item.decision && reviewVisible(scope, item, repo));
    const tripTitle = options.tripTitle !== undefined ? options.tripTitle : booking.tripId ? repo.trip(booking.tripId)?.title ?? null : null;
    return {
      id: booking.id, createdAt: booking.createdAt, updatedAt: booking.updatedAt, revision: booking.revision,
      tripId: booking.tripId, tripTitle: clipNull(tripTitle, 200),
      kind: booking.kind, kindLabel: KIND_LABELS[booking.kind], title: clip(booking.title, 200), provider: clipNull(booking.provider, 200), providerCode: booking.providerCode,
      reference: clipNull(booking.reference, 60), detail: clipNull(booking.detail, 160), travelers: booking.travelers.slice(0, 20).map((name) => clip(name, 120)),
      status: booking.status, statusLabel: STATUS_LABELS[booking.status], notes: clipNull(booking.notes, 2000), method: booking.method,
      segments: booking.segments.map((segment) => ({
        ...segment,
        number: clipNull(segment.number, 40),
        origin: { label: clipNull(segment.origin.label, 200), code: segment.origin.code },
        destination: { label: clipNull(segment.destination.label, 200), code: segment.destination.code },
        address: clipNull(segment.address, 400), endAddress: clipNull(segment.endAddress, 400),
      })),
      stay: booking.stay ? { ...booking.stay, propertyName: clip(booking.stay.propertyName, 200), address: clipNull(booking.stay.address, 400) } : null,
      corrections: booking.corrections.map((correction) => ({ ...correction, value: asFieldValue(correction.value), original: asFieldValue(correction.original) })),
      firstDate: booking.firstDate, lastDate: booking.lastDate, dateLabel: dateLabel(booking.firstDate, booking.lastDate), summary: bookingSummary(booking),
      timeNotes: booking.timeNotes.map((note) => clip(note, 500)).slice(0, 30),
      sources,
      coverage: {
        sources: sources.length, available: sources.length - unavailable, unavailable, missing,
        note: unavailable ? (unavailable === sources.length ? "Source unavailable. The original was deleted or moved to Trash. Details recorded earlier are kept." : "One or more sources are no longer available. Details recorded earlier are kept.") : booking.method === "manual" ? "Entered by hand." : null,
      },
      openReviewIds: reviews.map((item) => item.id),
      fictional: booking.fictional,
    };
  }

  /** Bookings visible to the scope for a trip, with the trip projection when the trip itself is not visible. */
  function visibleTrip(scope: AccessScope, trip: TripRow) {
    const bookings = repo.bookings(scope, { tripId: trip.id });
    const ideas = repo.ideas(scope, { tripId: trip.id });
    const full = allows(scope, trip.sourceKey);
    return { visible: full || bookings.length > 0 || ideas.length > 0, full, bookings, ideas };
  }

  function coverageFor(trip: TripRow, startDate: string | null, endDate: string | null, bookings: EffectiveBooking[]): TripCoverage {
    return computeCoverage({ startDate, endDate, bookings, dismissals: repo.dismissals(trip.id) });
  }

  function tripRecord(scope: AccessScope, trip: TripRow, view = visibleTrip(scope, trip)): TripRecord & { coverage: TripCoverage } {
    const active = view.bookings.filter((booking) => booking.status !== "canceled");
    const dates = view.bookings.flatMap((booking) => [booking.firstDate, booking.lastDate]).filter((value): value is string => !!value).sort();
    const startDate = view.full ? trip.startDate : dates[0] ?? null;
    const endDate = view.full ? trip.endDate : dates.at(-1) ?? null;
    const reviews = repo.reviews({ open: true, tripId: trip.id }).filter((item) => reviewVisible(scope, item, repo));
    const coverage = coverageFor(trip, startDate, endDate, view.bookings);
    const today = todayIn(trip.homeZone && isValidZone(trip.homeZone) ? trip.homeZone : t.zone(), t.now());
    // A trip seen only through shared bookings is named from those bookings' places.
    const destinations = view.full ? trip.destinations : [...new Set(view.bookings.map((booking) => findCityZone(booking.stay?.address ?? booking.segments[0]?.address)?.city ?? booking.segments.at(0)?.destination.label ?? null).filter((value): value is string => !!value))].slice(0, 6);
    let attention: string | null = null;
    if (reviews.length) attention = `${reviews.length} item${reviews.length === 1 ? "" : "s"} to review`;
    else if (!active.length && view.ideas.length) attention = "Only ideas so far. Nothing is booked yet";
    else if (!active.length) attention = "No booking recorded yet";
    else if (coverage.open) attention = coverage.summary;
    const travelers = view.full ? trip.travelers : [...new Set(view.bookings.flatMap((booking) => booking.travelers))];
    return {
      id: trip.id, createdAt: trip.createdAt, updatedAt: trip.updatedAt, revision: trip.revision,
      title: clip(view.full ? trip.title : destinations[0] ?? "Shared trip", 200), destinations: destinations.map((item) => clip(item, 120)),
      startDate, endDate, dateLabel: dateLabel(startDate, endDate), datesSource: view.full ? trip.datesSource : startDate ? "derived" : "unset",
      homeZone: trip.homeZone, state: tripState({ archivedAt: trip.archivedAt, startDate, endDate }, today), travelers: travelers.slice(0, 20).map((name) => clip(name, 120)),
      notes: view.full ? clipNull(trip.notes, 4000) : null,
      bookingCount: active.length, canceledCount: view.bookings.length - active.length, ideaCount: view.ideas.length, reviewCount: reviews.length,
      attention: clipNull(attention, 300), projection: view.full ? "full" : "partial", fictional: trip.fictional,
      coverage,
    };
  }

  function stripCoverage<T extends { coverage: TripCoverage }>(record: T): Omit<T, "coverage"> {
    const { coverage: _coverage, ...rest } = record;
    return rest;
  }

  function reviewDecisions(item: ReviewRow): ReviewDecision[] {
    switch (item.kind) {
      case "assign": return ["assign", "new_trip", "dismiss"];
      case "change": return ["accept", "keep"];
      case "cancellation": return item.bookingId ? ["accept", "keep"] : ["link", "dismiss"];
      case "identity": return ["link", "separate", "dismiss"];
      case "extraction": return ["accept", "dismiss"];
      case "unreadable": return ["accept", "dismiss"];
    }
  }
  const REVIEW_LABELS: Record<ReviewRow["kind"], string> = { assign: "Choose a trip", change: "Changed details", cancellation: "Cancellation", identity: "Possible duplicate", extraction: "Confirm details", unreadable: "Could not read" };

  function reviewRecord(scope: AccessScope, item: ReviewRow, labels = accountLabels()): ReviewItemRecord {
    const booking = item.bookingId ? repo.booking(item.bookingId) : null;
    const trip = (booking?.tripId ? repo.trip(booking.tripId) : null) ?? (item.tripId ? repo.trip(item.tripId) : null);
    const evidence = item.evidenceIds.map((id) => repo.evidence(id)).filter((row): row is EvidenceRow => !!row && allows(scope, row.sourceKey));
    const proposed = item.proposed ?? {};
    const previous = item.previous ?? {};
    const kind = booking?.kind ?? ((proposed.draft as BookingDraft | undefined)?.kind ?? "activity");
    const comparison = Object.keys(proposed)
      .filter((field) => !["draft", "partial", "missing", "ambiguous", "passages", "method", "cancellation"].includes(field))
      .map((field) => ({ field: clip(field, 60), label: clip(field === "segments" ? "Legs" : fieldLabel(field, kind), 80), current: clip(displayValue(field, previous[field] ?? (booking ? currentValue(booking, field) : null)), 400), proposed: clip(displayValue(field, proposed[field]), 400) }));
    const correctionConflict = !!booking && item.kind === "change" && Object.keys(proposed).some((field) => booking.corrections.some((correction) => correction.field === field));
    const candidates = item.candidates.map((id) => {
      if (item.kind === "identity" || (item.kind === "cancellation" && !item.bookingId)) {
        const candidate = repo.booking(id);
        if (!candidate || !candidate.sourceKeys.every((key) => allows(scope, key))) return null;
        return { id, type: "booking" as const, title: clip(candidate.title, 200), detail: clip([candidate.travelers.join(", "), dateLabel(candidate.firstDate, candidate.lastDate), candidate.reference].filter(Boolean).join(", "), 300) };
      }
      const candidate = repo.trip(id);
      if (!candidate) return null;
      const projected = visibleTrip(scope, candidate);
      if (!projected.visible) return null;
      return { id, type: "trip" as const, title: clip(projected.full ? candidate.title : "Shared trip", 200), detail: dateLabel(candidate.startDate, candidate.endDate) };
    }).filter((value): value is NonNullable<typeof value> => !!value);
    const draft = proposed.draft && typeof proposed.draft === "object" ? sanitizeDraft(proposed.draft as BookingDraft) : null;
    const prefill = prefillOf((proposed.partial ?? null) as { stay?: Record<string, unknown>; segments?: Record<string, unknown>[] } | null);
    const subject = booking?.title ?? draft?.title ?? draft?.stay?.propertyName ?? evidence[0]?.title ?? "A source";
    const headline = {
      assign: `Choose a trip for ${subject}`,
      change: `${subject} changed`,
      cancellation: item.bookingId ? `${subject} may be canceled` : "Cancellation without a matching booking",
      identity: `Is this an existing booking?`,
      extraction: `Confirm ${subject}`,
      unreadable: `Could not read ${evidence[0]?.title ?? "this source"}`,
    }[item.kind];
    return {
      id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, revision: item.revision, kind: item.kind, kindLabel: REVIEW_LABELS[item.kind],
      headline: clip(headline, 300), reason: clip(item.reason, 600),
      bookingId: item.bookingId, bookingTitle: clipNull(booking?.title, 200), tripId: trip?.id ?? null, tripTitle: clipNull(trip?.title, 200),
      candidates, comparison: comparison.slice(0, 40), correctionConflict,
      draft, prefill, missing: ((proposed.missing as string[] | undefined) ?? []).slice(0, 30).map((value) => clip(value, 60)),
      passages: ((proposed.passages as string[] | undefined) ?? []).slice(0, 20).map((value) => clip(value, 600)),
      evidence: evidence.slice(0, 10).map((row) => sourceRef({ role: "pending", evidence: row }, labels)),
      decisions: reviewDecisions(item), decision: item.decision, decidedAt: item.decidedAt, fictional: item.fictional,
    };
  }

  function ideaRecord(idea: IdeaRow): IdeaRecord {
    return {
      id: idea.id, createdAt: idea.createdAt, updatedAt: idea.updatedAt, revision: idea.revision, tripId: idea.tripId, kind: idea.kind, title: clip(idea.title, 200),
      note: clipNull(idea.note, 2000), url: idea.url, priceMinor: idea.priceMinor, currency: idea.currency, priceLabel: priceLabel(idea.priceMinor, idea.currency),
      observedAt: idea.observedAt, location: clipNull(idea.location, 300), conditions: clipNull(idea.conditions, 500), sourceLabel: clipNull(idea.sourceLabel, 200), fictional: idea.fictional,
    };
  }

  function followUpRecord(row: FollowUpRow): FollowUpRecord {
    const message = row.state === "needs_permission" ? "Allow Ri tasks for this app in Sources, then try again." : row.state === "failed" ? row.lastError : row.availability === "missing" ? "The linked Ri task is no longer available." : null;
    return {
      id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt, subjectType: row.subjectType, subjectId: row.subjectId, operationId: row.operationId,
      title: clip(row.title, 500), dueAt: row.dueAt, taskId: row.taskId, state: row.state, availability: row.availability, checkedAt: row.checkedAt, message: clipNull(message, 300),
    };
  }

  /** The full trip view: itinerary days, coverage, bookings, review, calendar and follow-ups. */
  function tripDetail(scope: AccessScope, trip: TripRow) {
    const view = visibleTrip(scope, trip);
    const record = tripRecord(scope, trip, view);
    const labels = accountLabels();
    const fallbackZone = view.bookings.flatMap((booking) => [booking.stay?.zone, ...booking.segments.map((segment) => segment.end?.zone ?? segment.start.zone)]).find((zone): zone is string => !!zone) ?? trip.homeZone ?? t.settings.get().homeZone;
    const sorted = [...view.bookings].sort((a, b) => compareBookings(a, b, fallbackZone));
    const reviews = repo.reviews({ open: true, tripId: trip.id }).filter((item) => reviewVisible(scope, item, repo));
    const bookingReviews = new Set(reviews.flatMap((item) => (item.bookingId ? [item.bookingId] : [])));
    const bookings = sorted.map((booking) => bookingRecord(scope, booking, { tripTitle: record.title, labels, reviews }));
    const byId = new Map(sorted.map((booking) => [booking.id, booking]));
    const itinerary = buildItinerary(sorted, { fallbackZone });
    const gapsByDate = new Map<string, string[]>();
    for (const gap of record.coverage.gaps) if (gap.date && !gap.dismissed) gapsByDate.set(gap.date, [...(gapsByDate.get(gap.date) ?? []), gap.key]);
    const dayMap = new Map(itinerary.map((day) => [day.date, day]));
    const dates = new Set<string>(itinerary.map((day) => day.date));
    if (record.startDate && record.endDate && record.endDate >= record.startDate) {
      for (let date = record.startDate; date <= record.endDate; date = addDays(date, 1)) dates.add(date);
    }
    const days = [...dates].sort().slice(0, 400).map((date) => {
      const day = dayMap.get(date) ?? { date, label: formatDate(date, "weekdayLong"), zones: [], zoneMissing: false, items: [] };
      return {
        date, label: day.label, zones: day.zones.slice(0, 10).map((zone) => ({ ...zone, city: clip(zone.city, 80) })), zoneMissing: day.zoneMissing, zoneLine: dayZoneLine(day),
        items: day.items.slice(0, 300).map((item) => {
          const booking = byId.get(item.bookingId)!;
          const primary = repo.links(booking.id).find((link) => link.contributes && allows(scope, link.evidence.sourceKey));
          return {
            ...item, title: clip(item.title, 300), subtitle: clip(item.subtitle, 300), context: clipNull(item.context, 300), location: clipNull(item.location, 400), notes: item.notes.slice(0, 10).map((note) => clip(note, 500)),
            sourceLabel: shortSourceLabel(primary?.evidence ?? null, booking.method), sourceAvailable: primary ? primary.evidence.availability === "available" : true,
            corrected: booking.corrections.length > 0, needsReview: bookingReviews.has(booking.id),
          };
        }),
        gapKeys: (gapsByDate.get(date) ?? []).slice(0, 50),
        inTrip: !!record.startDate && !!record.endDate && date >= record.startDate && date <= record.endDate,
      };
    });
    const zone = trip.homeZone ?? t.settings.get().homeZone;
    const localZones = [...new Set(itinerary.flatMap((day) => day.zones.map((item) => `${item.city} ${item.label}`)))];
    const localContext = clip(
      localZones.length ? `Times are local: ${localZones.join(", ")}${zone ? `. Home zone ${zone}` : ""}` : zone ? `Home zone ${zone}` : "Times are shown in each place's local time",
      300,
    );
    return {
      trip: stripCoverage(record),
      coverage: { checked: record.coverage.checked, summary: record.coverage.summary, open: record.coverage.open, nights: record.coverage.nights, gaps: record.coverage.gaps.map((gap) => ({ ...gap, message: clip(gap.message, 500) })) },
      days,
      bookings,
      review: reviews.slice(0, 100).map((item) => reviewRecord(scope, item, labels)),
      calendar: calendarState(scope, record, sorted),
      followUps: repo.followUps({ subjectType: "trip", subjectId: trip.id }).filter((row) => allows(scope, row.sourceKey)).slice(0, 100).map(followUpRecord),
      ideaCount: view.ideas.length,
      localContext,
    };
  }

  /** Calendar events while the trip is underway, with how each relates to the bookings. */
  function calendarState(scope: AccessScope, trip: { startDate: string | null; endDate: string | null; homeZone: string | null }, bookings: EffectiveBooking[]) {
    const calendarAccounts = t.accounts.list().filter((account) => account.kind === "calendar");
    if (!calendarAccounts.length) return { status: "not_connected" as const, message: "Connect a calendar in Sources to check this trip against your schedule.", events: [], checkedThrough: null };
    const chosen = calendarAccounts.filter((account) => account.calendars.length > 0 && allows(scope, `account:${account.account}`));
    if (!chosen.length) return { status: "not_chosen" as const, message: "Choose which calendars to check in Sources.", events: [], checkedThrough: null };
    if (!trip.startDate || !trip.endDate) return { status: "no_dates" as const, message: "Add trip dates to check your calendar.", events: [], checkedThrough: null };
    const zone = trip.homeZone && isValidZone(trip.homeZone) ? trip.homeZone : t.zone();
    const from = instantFromLocal(`${trip.startDate}T00:00`, zone).instant;
    const to = instantFromLocal(`${addDays(trip.endDate, 1)}T00:00`, zone).instant;
    const rows = repo.calendarEvents(addDays(trip.startDate, -1), addDays(trip.endDate, 2), chosen.map((account) => `account:${account.account}`));
    const timed = bookings.filter((booking) => booking.status !== "canceled").flatMap((booking) => booking.segments.filter((segment) => segment.start.instant).map((segment) => ({ booking, segment, start: Date.parse(segment.start.instant!), end: Date.parse(segment.end?.instant ?? segment.start.instant!) })));
    const events = rows.flatMap((row) => {
      if (row.transparent || row.response === "declined" || !row.startValue) return [];
      const allDay = row.allDay || row.startValue.length === 10;
      const startMs = allDay ? Date.parse(instantFromLocal(`${row.startValue.slice(0, 10)}T00:00`, zone).instant) : Date.parse(row.startValue);
      const endMs = row.endValue ? (allDay ? Date.parse(instantFromLocal(`${row.endValue.slice(0, 10)}T00:00`, zone).instant) : Date.parse(row.endValue)) : startMs;
      if (!(startMs < Date.parse(to) && Date.parse(from) < Math.max(endMs, startMs + 1))) return [];
      const summary = row.summary ?? "Busy";
      const match = timed.find(({ booking, segment, start, end }) => {
        const words = [booking.reference, segment.number, booking.provider].filter((value): value is string => !!value).map((value) => value.toLowerCase());
        return !allDay && Math.abs(startMs - start) < 3 * 3600_000 && Math.abs(endMs - end) < 3 * 3600_000 && words.some((word) => summary.toLowerCase().includes(word.toLowerCase()));
      });
      const overlap = !match && !allDay ? timed.find(({ start, end }) => startMs < Math.max(end, start + 1) && start < Math.max(endMs, startMs + 1)) : undefined;
      const relation = match ? "matches_booking" as const : overlap ? "overlaps_booking" as const : "during_trip" as const;
      const when = allDay
        ? (row.endValue && row.endValue.slice(0, 10) > addDays(row.startValue.slice(0, 10), 1) ? dateLabel(row.startValue.slice(0, 10), addDays(row.endValue.slice(0, 10), -1)) : formatDate(row.startValue.slice(0, 10), "weekdayLong"))
        : formatInstant(new Date(startMs).toISOString(), zone, { date: "weekday", zone: true });
      const note = relation === "matches_booking" ? `Matches ${match!.booking.title}. Not a conflict.` : relation === "overlaps_booking" ? `Overlaps ${overlap!.booking.title}.` : "On your calendar while you are away.";
      const account = calendarAccounts.find((item) => item.account === row.account);
      return [{ id: row.id, summary: clip(summary, 300), start: row.startValue, end: row.endValue, allDay, when: clip(when, 120), relation, bookingId: match?.booking.id ?? overlap?.booking.id ?? null, note, sourceLabel: clip(`Calendar${account?.label ? ` in ${account.label}` : ""}`, 200) }];
    }).slice(0, 200);
    const partial = chosen.some((account) => {
      const checkpoints = (account.checkpoint ?? {}) as Record<string, { completedAt?: string | null; window?: { to: string } }>;
      return account.calendars.some((calendarId) => !checkpoints[calendarId]?.completedAt || (checkpoints[calendarId]?.window?.to ?? "") < to);
    });
    const conflicts = events.filter((event) => event.relation !== "matches_booking").length;
    const lastSuccess = chosen.map((account) => account.lastSuccessAt).filter((value): value is string => !!value).sort().at(-1) ?? null;
    return {
      status: partial ? "partial" as const : "ready" as const,
      message: clip(`${conflicts ? `${conflicts} calendar event${conflicts === 1 ? "" : "s"} during this trip` : "No calendar events during this trip"}${partial ? ". Calendar import is not complete for these dates" : ""}.`, 300),
      events,
      checkedThrough: lastSuccess,
    };
  }

  return { bookingRecord, tripRecord, stripCoverage, visibleTrip, reviewRecord, ideaRecord, followUpRecord, tripDetail, calendarState, sourceRef, accountLabels, bookingSummary };
}
export type ReadModel = ReturnType<typeof createReadModel>;

function currentValue(booking: EffectiveBooking, field: string): unknown {
  if (field === "title") return booking.title;
  if (field === "provider") return booking.provider;
  if (field === "reference") return booking.reference;
  if (field === "travelers") return booking.travelers;
  if (field === "status") return booking.status;
  const stay = /^stay\.(\w+)$/.exec(field);
  if (stay && booking.stay) return (booking.stay as unknown as Record<string, unknown>)[stay[1]] ?? null;
  const segment = /^segments\.(\d+)\.(\w+)$/.exec(field);
  if (segment) {
    const found = booking.segments.find((item) => item.sequence === Number(segment[1]));
    if (!found) return null;
    const map: Record<string, unknown> = { number: found.number, originLabel: found.origin.label, originCode: found.origin.code, destinationLabel: found.destination.label, destinationCode: found.destination.code, startLocal: found.start.local, startZone: found.start.zone, endLocal: found.end?.local ?? null, endZone: found.end?.zone ?? null, address: found.address, endAddress: found.endAddress };
    return map[segment[2]] ?? null;
  }
  return null;
}

function asFieldValue(value: unknown): string | string[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => clip(String(item), 120)).slice(0, 20);
  return clip(String(value), 400);
}

/** A review draft valid for the form: keep the parts that validate. */
function sanitizeDraft(draft: BookingDraft): BookingDraft {
  const whole = bookingDraftSchema.safeParse(draft);
  if (whole.success) return whole.data;
  const segmentSchema = bookingDraftSchema.shape.segments.unwrap().element;
  const result: BookingDraft = {
    kind: draft.kind, title: draft.title ?? null, provider: draft.provider ?? null, reference: draft.reference ?? null, detail: draft.detail ?? null,
    travelers: (draft.travelers ?? []).slice(0, 20), status: draft.status ?? "confirmed",
    segments: (draft.segments ?? []).filter((segment) => segmentSchema.safeParse(segment).success),
    stay: null,
  };
  const parsed = bookingDraftSchema.safeParse(result);
  return parsed.success ? parsed.data : { kind: draft.kind, travelers: [], segments: [], stay: null };
}
/** Values read for an incomplete booking, keyed by field path, to prefill the review form. */
function prefillOf(partial: { stay?: Record<string, unknown>; segments?: Record<string, unknown>[] } | null): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  if (!partial) return result;
  for (const [key, value] of Object.entries(partial.stay ?? {})) if (typeof value === "string" || value === null) result[`stay.${key}`] = value === null ? null : clip(value, 400);
  (partial.segments ?? []).slice(0, 12).forEach((segment, index) => {
    for (const [key, value] of Object.entries(segment)) if (typeof value === "string" || value === null) result[`segments.${index}.${key}`] = value === null ? null : clip(value, 400);
  });
  return result;
}

export function priceLabel(minor: number | null, currency: string | null): string {
  if (minor === null || !currency) return "Not provided";
  try {
    const digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code" }).format(minor / 10 ** digits).replace(/ /g, " ");
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}
