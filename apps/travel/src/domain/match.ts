/**
 * Deduplication and trip grouping rules. Source identity decides first: the
 * same message, the same calendar invitation or the same mail thread with the
 * same reference. Otherwise a booking matches only when the provider,
 * reference, travelers and dates are all compatible. A reference alone never
 * identifies a booking. More than one compatible booking or trip goes to
 * Review instead of a guess.
 */
import { addDays, daysBetween } from "@ri/app-kit/time";
import type { EffectiveBooking } from "./booking.js";
import type { BookingDraft } from "./model.js";
import { nameKey, normalizeReference } from "./parse/text.js";

const PROVIDER_NOISE = /\b(?:the|airlines?|airways|air|hotels?|resorts?|inn|rail|railways?|car|rental|rentals|hire|inc|llc|ltd|gmbh|sa|group|international|reservations?|bookings?)\b/g;
export function providerKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(PROVIDER_NOISE, " ").replace(/[^a-z0-9]+/g, "");
  return key.length >= 2 ? key : null;
}
export { normalizeReference };

export type TravelerFit = "same" | "overlap" | "unknown" | "different";
/** How two traveler lists relate, comparing names written differently ("RIVERA/ALEX" and "Alex Rivera"). */
export function travelerFit(a: string[], b: string[]): TravelerFit {
  if (!a.length || !b.length) return "unknown";
  const keysA = new Set(a.map(nameKey)), keysB = new Set(b.map(nameKey));
  const contains = (key: string, set: Set<string>) => {
    if (set.has(key)) return true;
    // "Alex Rivera" and "Alex J Rivera": one name's tokens contained in the other.
    const tokens = key.split(" ");
    return [...set].some((other) => { const otherTokens = other.split(" "); return tokens.every((token) => otherTokens.includes(token)) || otherTokens.every((token) => tokens.includes(token)); });
  };
  const shared = [...keysA].filter((key) => contains(key, keysB)).length;
  if (!shared) return "different";
  return shared === keysA.size && keysA.size === keysB.size ? "same" : "overlap";
}

/** First and last local dates a draft touches, or nulls when it states none. */
export function draftDates(draft: BookingDraft): { first: string | null; last: string | null } {
  const dates = [
    ...(draft.segments ?? []).flatMap((segment) => [segment.startLocal.slice(0, 10), segment.endLocal?.slice(0, 10)].filter((value): value is string => !!value)),
    ...(draft.stay ? [draft.stay.checkInDate, draft.stay.checkOutDate] : []),
  ].sort();
  return { first: dates[0] ?? null, last: dates.at(-1) ?? null };
}

/** Dates are compatible when unknown on either side, overlapping, or within two weeks of each other (a rescheduled booking). */
export function datesCompatible(a: { first: string | null; last: string | null }, b: { first: string | null; last: string | null }): boolean {
  if (!a.first || !b.first) return true;
  const aLast = a.last ?? a.first, bLast = b.last ?? b.first;
  if (a.first <= bLast && b.first <= aLast) return true;
  return Math.abs(daysBetween(a.first, b.first)) <= 14;
}

export interface MatchInput {
  draft: BookingDraft;
  kindGuessed?: boolean;
  /** The sender or provider recorded with the source. */
  provider: string | null;
}
export interface MatchResult {
  /** Compatible bookings. One is a match, several need Review. */
  candidates: EffectiveBooking[];
  /** Why nothing matched, for tests and review text. */
  reason: string;
}

/** Bookings this draft may describe, by provider, reference, travelers and dates. */
export function matchBookings(input: MatchInput, bookings: EffectiveBooking[]): MatchResult {
  const draft = input.draft;
  const reference = normalizeReference(draft.reference);
  const providers = [providerKey(draft.provider), providerKey(input.provider)].filter((value): value is string => !!value);
  const dates = draftDates(draft);
  const travelers = draft.travelers ?? [];
  const candidates = bookings.filter((booking) => {
    if (!input.kindGuessed && booking.kind !== draft.kind) return false;
    const bookingProviders = [providerKey(booking.provider), providerKey(booking.title)].filter((value): value is string => !!value);
    const providerKnown = providers.length > 0 && bookingProviders.length > 0;
    const providerSame = providers.some((key) => bookingProviders.includes(key)) || (!!draft.providerCode && !!booking.providerCode && draft.providerCode.toUpperCase() === booking.providerCode.toUpperCase());
    if (providerKnown && !providerSame) return false;
    if (travelerFit(travelers, booking.travelers) === "different") return false;
    if (!datesCompatible(dates, { first: booking.firstDate, last: booking.lastDate })) return false;
    if (reference) return normalizeReference(booking.reference) === reference;
    // Without a reference only an identical booking is the same one: same provider, start and travelers.
    if (!providerSame || !dates.first) return false;
    const sameStart = draft.kind === "lodging" ? booking.stay?.checkInDate === draft.stay?.checkInDate && booking.stay?.checkOutDate === draft.stay?.checkOutDate : booking.segments[0]?.start.local === draft.segments?.[0]?.startLocal;
    return sameStart && travelerFit(travelers, booking.travelers) !== "overlap";
  });
  return { candidates, reason: candidates.length ? (candidates.length > 1 ? "Several bookings fit" : "One booking fits") : reference ? "No booking with this provider, reference, travelers and dates" : "No identical booking" };
}

export interface TripCandidate { id: string; startDate: string | null; endDate: string | null; travelers: string[]; destinations: string[]; archived: boolean }
/** Trips a booking can join automatically: dates overlapping or adjacent within a day, and compatible travelers. */
export function matchTrips(booking: { first: string | null; last: string | null; travelers: string[] }, trips: TripCandidate[]): TripCandidate[] {
  if (!booking.first) return [];
  const last = booking.last ?? booking.first;
  return trips.filter((trip) => {
    if (trip.archived || !trip.startDate || !trip.endDate) return false;
    if (!(booking.first! <= addDays(trip.endDate, 1) && addDays(trip.startDate, -1) <= last)) return false;
    return travelerFit(booking.travelers, trip.travelers) !== "different";
  });
}
