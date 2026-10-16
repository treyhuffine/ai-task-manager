/**
 * Deterministic gap checks for a trip with explicit dates: nights with no
 * recorded lodging or overnight journey, and timed bookings that overlap. A
 * night counts from its date to the next morning, so a hotel's check-out
 * date is exclusive. An uncovered night is a prompt to check, since staying
 * with friends can be intentional. A dismissal holds until the facts it was
 * made on change. Times without a zone are reported, never compared.
 */
import { createHash } from "node:crypto";
import { addDays, dateRange, formatDate } from "@ri/app-kit/time";
import { describeEndpoint } from "./clock.js";
import type { EffectiveBooking } from "./booking.js";
import type { BookingKind } from "./model.js";

export type GapKind = "night" | "overlap" | "zone_missing";
export interface Gap {
  key: string;
  kind: GapKind;
  date: string | null;
  bookingIds: string[];
  message: string;
  /** Digest of the facts this gap was computed from. */
  fingerprint: string;
  dismissed: boolean;
  dismissedAt: string | null;
}
export interface NightCoverage {
  date: string;
  status: "covered" | "uncovered" | "dismissed";
  by: { bookingId: string; kind: BookingKind; label: string; how: "lodging" | "overnight" }[];
}
export interface TripCoverage {
  /** Nights are checked only when the trip has a start and an end date. */
  checked: boolean;
  nights: NightCoverage[];
  gaps: Gap[];
  /** Open (not dismissed) gaps. */
  open: number;
  summary: string;
}
export interface Dismissal { key: string; fingerprint: string; at: string }

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
const nightLabel = (date: string) => `the night of ${formatDate(date, "weekdayLong")}`;

interface Span { bookingId: string; kind: BookingKind; label: string; how: "lodging" | "overnight"; from: string; to: string }
/** Nights each active booking covers: [from, to) as local dates. */
function spans(bookings: EffectiveBooking[]): Span[] {
  const result: Span[] = [];
  for (const booking of bookings) {
    if (booking.status === "canceled") continue;
    if (booking.stay && booking.stay.checkOutDate > booking.stay.checkInDate)
      result.push({ bookingId: booking.id, kind: booking.kind, label: booking.stay.propertyName, how: "lodging", from: booking.stay.checkInDate, to: booking.stay.checkOutDate });
    if (booking.kind === "flight" || booking.kind === "train")
      for (const segment of booking.segments)
        if (segment.end && segment.end.date > segment.start.date)
          result.push({ bookingId: booking.id, kind: booking.kind, label: `${booking.kind === "flight" ? "Flight" : "Train"}${segment.number ? ` ${segment.number}` : ""}`, how: "overnight", from: segment.start.date, to: segment.end.date });
  }
  return result;
}

export function computeCoverage(input: { startDate: string | null; endDate: string | null; bookings: EffectiveBooking[]; dismissals: Dismissal[] }): TripCoverage {
  const dismissed = new Map(input.dismissals.map((item) => [item.key, item]));
  const gaps: Gap[] = [];
  const nights: NightCoverage[] = [];
  const covering = spans(input.bookings);
  const checked = !!input.startDate && !!input.endDate && input.endDate >= input.startDate;
  if (checked) {
    // Nights run from the first date up to the night before the last date.
    const dates = input.endDate! > input.startDate! ? dateRange(input.startDate!, addDays(input.endDate!, -1)) : [];
    for (const date of dates) {
      const by = covering.filter((span) => span.from <= date && date < span.to).map(({ bookingId, kind, label, how }) => ({ bookingId, kind, label, how }));
      if (by.length) { nights.push({ date, status: "covered", by }); continue; }
      // The facts: trip dates and every span touching the surrounding nights.
      const nearby = covering
        .filter((span) => span.from <= addDays(date, 1) && addDays(date, -1) < span.to)
        .map((span) => [span.bookingId, span.from, span.to])
        .sort();
      const key = `night:${date}`;
      const fingerprint = digest({ key, start: input.startDate, end: input.endDate, nearby });
      const dismissal = dismissed.get(key);
      const isDismissed = !!dismissal && dismissal.fingerprint === fingerprint;
      nights.push({ date, status: isDismissed ? "dismissed" : "uncovered", by: [] });
      gaps.push({ key, kind: "night", date, bookingIds: [], message: `No booking recorded for ${nightLabel(date)}.`, fingerprint, dismissed: isDismissed, dismissedAt: isDismissed ? dismissal!.at : null });
    }
  }
  // Timed bookings that overlap. Only entries with known instants can be compared.
  const timed: { bookingId: string; label: string; start: number; end: number; startText: string; endText: string }[] = [];
  for (const booking of input.bookings) {
    if (booking.status === "canceled") continue;
    for (const segment of booking.segments) {
      const label = booking.kind === "flight" || booking.kind === "train" ? `${booking.kind === "flight" ? "Flight" : "Train"}${segment.number ? ` ${segment.number}` : ""}` : booking.title;
      if (segment.dateOnly) continue;
      const missing = [segment.start.resolution === "zone_missing" ? "start" : null, segment.end && segment.end.resolution === "zone_missing" ? "end" : null].filter(Boolean);
      if (missing.length) {
        const key = `zone:${segment.id}`;
        const fingerprint = digest({ key, start: segment.start.local, end: segment.end?.local ?? null });
        const dismissal = dismissed.get(key);
        const isDismissed = !!dismissal && dismissal.fingerprint === fingerprint;
        gaps.push({ key, kind: "zone_missing", date: segment.start.date, bookingIds: [booking.id], message: `${label} has a time without a recorded time zone, so overlaps with it cannot be checked precisely.`, fingerprint, dismissed: isDismissed, dismissedAt: isDismissed ? dismissal!.at : null });
        continue;
      }
      if (!segment.start.instant) continue;
      if (booking.kind === "car") {
        // A rental is busy only at pick-up and return, not for the days in between.
        const provider = booking.provider ?? "Rental car";
        const pickup = Date.parse(segment.start.instant);
        timed.push({ bookingId: booking.id, label: `${provider} pick-up`, start: pickup, end: pickup, startText: describeEndpoint(segment.start), endText: describeEndpoint(segment.start) });
        if (segment.end?.instant) {
          const drop = Date.parse(segment.end.instant);
          timed.push({ bookingId: booking.id, label: `${provider} return`, start: drop, end: drop, startText: describeEndpoint(segment.end), endText: describeEndpoint(segment.end) });
        }
        continue;
      }
      const start = Date.parse(segment.start.instant);
      const end = segment.end?.instant ? Date.parse(segment.end.instant) : start;
      timed.push({ bookingId: booking.id, label, start, end: Math.max(start, end), startText: describeEndpoint(segment.start), endText: segment.end ? describeEndpoint(segment.end) : describeEndpoint(segment.start) });
    }
  }
  for (let i = 0; i < timed.length; i++)
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i], b = timed[j];
      if (a.bookingId === b.bookingId) continue;
      const overlaps = a.start === a.end && b.start === b.end ? a.start === b.start : a.start === a.end ? b.start <= a.start && a.start < b.end : b.start === b.end ? a.start <= b.start && b.start < a.end : a.start < b.end && b.start < a.end;
      if (!overlaps) continue;
      const [first, second] = a.start <= b.start ? [a, b] : [b, a];
      const ids = [first.bookingId, second.bookingId].sort();
      const key = `overlap:${ids.join(":")}`;
      if (gaps.some((gap) => gap.key === key)) continue;
      const fingerprint = digest({ key, a: [a.start, a.end], b: [b.start, b.end] });
      const dismissal = dismissed.get(key);
      const isDismissed = !!dismissal && dismissal.fingerprint === fingerprint;
      gaps.push({ key, kind: "overlap", date: new Date(second.start).toISOString().slice(0, 10), bookingIds: ids, message: `${second.label} at ${second.startText} overlaps ${first.label} (${first.startText} to ${first.endText}).`, fingerprint, dismissed: isDismissed, dismissedAt: isDismissed ? dismissal!.at : null });
    }
  const open = gaps.filter((gap) => !gap.dismissed);
  const uncovered = open.filter((gap) => gap.kind === "night").length;
  const overlaps = open.filter((gap) => gap.kind === "overlap").length;
  const zones = open.filter((gap) => gap.kind === "zone_missing").length;
  const parts = [
    uncovered ? `${uncovered} night${uncovered === 1 ? "" : "s"} with no booking recorded` : null,
    overlaps ? `${overlaps} overlapping time${overlaps === 1 ? "" : "s"}` : null,
    zones ? `${zones} time${zones === 1 ? "" : "s"} without a zone` : null,
  ].filter(Boolean);
  const summary = parts.length ? parts.join(", ") : checked ? "Every night has a booking recorded and no times overlap" : "Add trip dates to check night coverage";
  return { checked, nights, gaps, open: open.length, summary: summary.charAt(0).toUpperCase() + summary.slice(1) };
}
