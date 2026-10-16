/**
 * The itinerary: one ordered list of entries grouped by local date. Overnight
 * journeys appear on both their departure and arrival dates. A hotel shows
 * check-in and check-out entries and a quiet all-day line on the nights in
 * between, never an hour block.
 */
import { formatDate } from "@ri/app-kit/time";
import { chronology, compareChronology, describeEndpoint, zoneCity, type Endpoint } from "./clock.js";
import { findCityZone } from "./places.js";
import type { EffectiveBooking, EffectiveSegment } from "./booking.js";
import type { BookingKind, BookingStatus } from "./model.js";

export type ItemRole = "depart" | "arrive" | "journey" | "check_in" | "check_out" | "staying" | "pickup" | "return" | "rental" | "activity" | "activity_end";
export interface ItineraryItem {
  id: string;
  bookingId: string;
  kind: BookingKind;
  role: ItemRole;
  date: string;
  time: string | null;
  zone: string | null;
  zoneLabel: string | null;
  instant: string | null;
  title: string;
  subtitle: string;
  /** Short context such as "From Denver, overnight flight". */
  context: string | null;
  location: string | null;
  status: BookingStatus;
  allDay: boolean;
  /** Placed by local wall time because the zone is unknown. */
  localOrder: boolean;
  notes: string[];
}
export interface ItineraryDay {
  date: string;
  label: string;
  /** Zones used by timed entries that day, such as Denver MST. */
  zones: { zone: string; label: string; city: string }[];
  /** A timed entry that day has no zone. */
  zoneMissing: boolean;
  items: ItineraryItem[];
}

const NOUN: Record<BookingKind, string> = { flight: "Flight", train: "Train", lodging: "Stay", car: "Car rental", activity: "Activity" };
const placeOf = (place: { label: string | null; code: string | null }) => place.label ? (place.code && place.label !== place.code ? place.label : place.label) : place.code;

function base(booking: EffectiveBooking, id: string, role: ItemRole, endpoint: Endpoint, fields: Pick<ItineraryItem, "title" | "subtitle" | "context" | "location"> & { notes?: string[] }): ItineraryItem {
  return {
    id, bookingId: booking.id, kind: booking.kind, role,
    date: endpoint.date, time: endpoint.time, zone: endpoint.zone, zoneLabel: endpoint.zoneLabel, instant: endpoint.instant,
    status: booking.status, allDay: !endpoint.time, localOrder: false,
    notes: [...(fields.notes ?? []), ...(endpoint.note ? [endpoint.note] : [])],
    title: fields.title, subtitle: fields.subtitle, context: fields.context, location: fields.location,
  };
}

function journeyItems(booking: EffectiveBooking, segment: EffectiveSegment): ItineraryItem[] {
  const noun = `${NOUN[booking.kind]}${segment.number ? ` ${segment.number}` : ""}`;
  const from = placeOf(segment.origin), to = placeOf(segment.destination);
  const key = `${booking.id}:${segment.id}`;
  if (!segment.end || !segment.overnight) {
    const arrives = segment.end?.time ? `arrives ${describeEndpoint(segment.end, { date: false })}` : null;
    return [base(booking, `${key}:journey`, "journey", segment.start, {
      title: from && to ? `${from} to ${to}` : to ? `To ${to}` : noun,
      subtitle: [noun, arrives].filter(Boolean).join(", "),
      context: segment.duration ? `${segment.duration} journey` : null,
      location: segment.address ?? from,
    })];
  }
  const kindWord = booking.kind === "flight" ? "flight" : booking.kind === "train" ? "train" : "journey";
  return [
    base(booking, `${key}:depart`, "depart", segment.start, {
      title: from ? `Depart ${from}` : `Depart on ${noun}`,
      subtitle: noun,
      context: `Overnight ${kindWord}${to ? ` to ${to}` : ""}, arrives ${describeEndpoint(segment.end)}`,
      location: segment.address ?? from,
    }),
    base(booking, `${key}:arrive`, "arrive", segment.end, {
      title: to ? `Arrive in ${to}` : `Arrive on ${noun}`,
      subtitle: noun,
      context: `${from ? `From ${from}, ` : ""}overnight ${kindWord}, departed ${describeEndpoint(segment.start)}`,
      location: segment.endAddress ?? to,
    }),
  ];
}

function rentalItems(booking: EffectiveBooking, segment: EffectiveSegment): ItineraryItem[] {
  const key = `${booking.id}:${segment.id}`;
  const provider = booking.provider ?? "Rental car";
  const from = placeOf(segment.origin), to = placeOf(segment.destination);
  if (!segment.end || segment.end.date === segment.start.date)
    return [base(booking, `${key}:rental`, "rental", segment.start, { title: booking.title, subtitle: segment.end?.time ? `Return by ${describeEndpoint(segment.end, { date: false })}` : "Rental car", context: booking.detail, location: from })];
  return [
    base(booking, `${key}:pickup`, "pickup", segment.start, { title: "Pick up rental car", subtitle: `${provider}${from ? ` at ${from}` : ""}`, context: booking.detail ? `${booking.detail}, return ${describeEndpoint(segment.end)}` : `Return ${describeEndpoint(segment.end)}`, location: segment.address ?? from }),
    base(booking, `${key}:return`, "return", segment.end, { title: "Return rental car", subtitle: `${provider}${to ? ` at ${to}` : ""}`, context: null, location: segment.endAddress ?? to }),
  ];
}

function activityItems(booking: EffectiveBooking, segment: EffectiveSegment): ItineraryItem[] {
  const key = `${booking.id}:${segment.id}`;
  const subtitle = booking.detail ?? booking.provider ?? NOUN.activity;
  const items = [base(booking, `${key}:activity`, "activity", segment.start, {
    title: booking.title,
    subtitle,
    context: segment.end && segment.end.date === segment.start.date && segment.end.time ? `Until ${describeEndpoint(segment.end, { date: false })}` : null,
    location: segment.address,
  })];
  if (segment.end && segment.end.date > segment.start.date)
    items.push(base(booking, `${key}:end`, "activity_end", segment.end, { title: `${booking.title} ends`, subtitle, context: null, location: segment.endAddress ?? segment.address }));
  return items;
}

function stayItems(booking: EffectiveBooking): ItineraryItem[] {
  const stay = booking.stay;
  if (!stay) return [];
  const key = `${booking.id}:${stay.id}`;
  const nightsLabel = `${stay.nights} night${stay.nights === 1 ? "" : "s"}`;
  const items: ItineraryItem[] = [
    base(booking, `${key}:check_in`, "check_in", stay.checkIn, { title: stay.propertyName, subtitle: `Check in, ${nightsLabel}`, context: booking.detail, location: stay.address }),
  ];
  for (let night = 1; night < stay.nights; night++) {
    const date = new Date(Date.parse(`${stay.checkInDate}T00:00:00Z`) + night * 864e5).toISOString().slice(0, 10);
    items.push({ ...base(booking, `${key}:night:${date}`, "staying", { local: date, date, time: null, zone: stay.zone, zoneLabel: null, instant: null, resolution: "date_only", note: null }, { title: stay.propertyName, subtitle: `Staying, night ${night + 1} of ${stay.nights}`, context: null, location: stay.address }) });
  }
  items.push(base(booking, `${key}:check_out`, "check_out", stay.checkOut, { title: stay.propertyName, subtitle: "Check out", context: null, location: stay.address }));
  return items;
}

/** Entries for one booking, unordered. */
export function bookingItems(booking: EffectiveBooking): ItineraryItem[] {
  if (booking.kind === "lodging") return stayItems(booking);
  return booking.segments.flatMap((segment) =>
    booking.kind === "car" ? rentalItems(booking, segment) : booking.kind === "activity" ? activityItems(booking, segment) : journeyItems(booking, segment),
  );
}

/** The zone most entries use on each date, used only to place entries without a zone. */
function referenceZones(items: ItineraryItem[], fallback: string | null) {
  const counts = new Map<string, Map<string, number>>();
  for (const item of items) {
    if (!item.zone) continue;
    const day = counts.get(item.date) ?? new Map<string, number>();
    day.set(item.zone, (day.get(item.zone) ?? 0) + 1);
    counts.set(item.date, day);
  }
  return (date: string) => {
    const day = counts.get(date);
    if (!day) return fallback;
    return [...day.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  };
}

const ROLE_ORDER: Record<ItemRole, string> = { check_out: "0", staying: "1", depart: "2", journey: "3", pickup: "4", rental: "5", activity: "6", activity_end: "7", arrive: "8", return: "9", check_in: "a" };

/** Order entries chronologically and group them by local date. */
export function buildItinerary(bookings: EffectiveBooking[], options: { fallbackZone?: string | null; includeCanceled?: boolean } = {}): ItineraryDay[] {
  const items = bookings.filter((booking) => options.includeCanceled !== false || booking.status !== "canceled").flatMap(bookingItems);
  const zoneFor = referenceZones(items, options.fallbackZone ?? null);
  const keyed = items.map((item) => {
    const endpoint: Endpoint = { local: item.time ? `${item.date}T${item.time}` : item.date, date: item.date, time: item.time, zone: item.zone, zoneLabel: item.zoneLabel, instant: item.instant, resolution: item.time ? (item.instant ? "exact" : "zone_missing") : "date_only", note: null };
    const order = chronology(endpoint, `${ROLE_ORDER[item.role]}:${item.bookingId}:${item.id}`, zoneFor(item.date));
    return { item: { ...item, localOrder: order.localOrder }, order };
  });
  keyed.sort((a, b) => compareChronology(a.order, b.order));
  const days = new Map<string, ItineraryDay>();
  for (const { item } of keyed) {
    let day = days.get(item.date);
    if (!day) {
      day = { date: item.date, label: formatDate(item.date, "weekdayLong"), zones: [], zoneMissing: false, items: [] };
      days.set(item.date, day);
    }
    day.items.push(item);
    if (item.time && !item.zone && !item.zoneLabel) day.zoneMissing = true;
    if (item.time && item.zone && item.zoneLabel) {
      // Name the zone after the place on the itinerary when it is in that zone: "Portland PST", not "Los Angeles PST".
      const place = findCityZone(item.location);
      const city = place && place.zone === item.zone ? place.city : zoneCity(item.zone);
      const existing = day.zones.find((zone) => zone.zone === item.zone && zone.label === item.zoneLabel);
      if (!existing) day.zones.push({ zone: item.zone, label: item.zoneLabel, city });
      else if (!existing.city.split(" and ").includes(city) && place && place.zone === item.zone) existing.city = existing.city === zoneCity(item.zone) ? city : `${existing.city} and ${city}`;
    }
  }
  return [...days.values()];
}

/** "Local times in Lisbon WET" or "Local times: Denver MST, Lisbon WET". */
export function dayZoneLine(day: Pick<ItineraryDay, "zones" | "zoneMissing">): string | null {
  const parts = day.zones.map((zone) => `${zone.city} ${zone.label}`);
  const missing = day.zoneMissing ? "Some times have no recorded zone" : null;
  if (!parts.length) return missing;
  const line = parts.length === 1 ? `Local times in ${parts[0]}` : `Local times: ${parts.join(", ")}`;
  return missing ? `${line}. ${missing}` : line;
}

/** The booking's sort position: its earliest entry. */
export function bookingOrder(booking: EffectiveBooking, fallbackZone: string | null) {
  const items = bookingItems(booking);
  const zoneFor = referenceZones(items, fallbackZone);
  let best: ReturnType<typeof chronology> | null = null;
  for (const item of items) {
    const endpoint: Endpoint = { local: item.time ? `${item.date}T${item.time}` : item.date, date: item.date, time: item.time, zone: item.zone, zoneLabel: item.zoneLabel, instant: item.instant, resolution: item.time ? (item.instant ? "exact" : "zone_missing") : "date_only", note: null };
    const order = chronology(endpoint, booking.id, zoneFor(item.date));
    if (!best || compareChronology(order, best) < 0) best = order;
  }
  return best ?? { date: "9999-12-31", bucket: 1 as const, at: 0, tie: booking.id, localOrder: false };
}
export function compareBookings(a: EffectiveBooking, b: EffectiveBooking, fallbackZone: string | null) {
  return compareChronology(bookingOrder(a, fallbackZone), bookingOrder(b, fallbackZone));
}
