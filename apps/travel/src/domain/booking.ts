/**
 * Effective bookings. The stored row keeps what sources (or the manual form)
 * said. A person's corrections are stored separately and win when reading,
 * so a later import can update the source value without erasing the
 * correction, and Review can compare the two.
 */
import { daysBetween } from "@ri/app-kit/time";
import { durationLabel, resolveEndpoint, type Endpoint } from "./clock.js";
import { airportCity } from "./places.js";
import { fieldLabel, type BookingDraft, type BookingKind, type BookingStatus, type SegmentDraft, type StayDraft } from "./model.js";

export interface BookingRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  tripId: string | null;
  kind: BookingKind;
  title: string;
  provider: string | null;
  providerCode: string | null;
  reference: string | null;
  detail: string | null;
  travelers: string[];
  status: BookingStatus;
  notes: string | null;
  method: "deterministic" | "ai" | "invite" | "manual";
  sourceKey: string;
  sourceKeys: string[];
  fictional: boolean;
}
export interface SegmentRow {
  id: string;
  sequence: number;
  number: string | null;
  originLabel: string | null;
  originCode: string | null;
  destinationLabel: string | null;
  destinationCode: string | null;
  startLocal: string;
  startZone: string | null;
  startOffset: number | null;
  endLocal: string | null;
  endZone: string | null;
  endOffset: number | null;
  address: string | null;
  endAddress: string | null;
}
export interface StayRow {
  id: string;
  propertyName: string;
  address: string | null;
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  zone: string | null;
}
export interface OverrideRow {
  id: string;
  field: string;
  value: unknown;
  original: unknown;
  actor: string;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Place { label: string | null; code: string | null }
export interface EffectiveSegment {
  id: string;
  sequence: number;
  number: string | null;
  origin: Place;
  destination: Place;
  start: Endpoint;
  end: Endpoint | null;
  dateOnly: boolean;
  address: string | null;
  endAddress: string | null;
  /** The segment ends on a later local date than it starts. */
  overnight: boolean;
  duration: string | null;
}
export interface EffectiveStay {
  id: string;
  propertyName: string;
  address: string | null;
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  zone: string | null;
  nights: number;
  checkIn: Endpoint;
  checkOut: Endpoint;
}
export interface Correction {
  field: string;
  label: string;
  value: unknown;
  original: unknown;
  /** A newer source changed the value this correction replaced. */
  stale: boolean;
  at: string;
}
export interface EffectiveBooking extends Omit<BookingRow, "travelers"> {
  travelers: string[];
  segments: EffectiveSegment[];
  stay: EffectiveStay | null;
  corrections: Correction[];
  /** First and last local dates the booking touches. */
  firstDate: string | null;
  lastDate: string | null;
  /** Plain notes about time: DST gaps, repeated hours and missing zones. */
  timeNotes: string[];
}

type Values = Record<string, unknown>;
function segmentValues(row: SegmentRow): Values {
  return { number: row.number, originLabel: row.originLabel, originCode: row.originCode, destinationLabel: row.destinationLabel, destinationCode: row.destinationCode, startLocal: row.startLocal, startZone: row.startZone, endLocal: row.endLocal, endZone: row.endZone, address: row.address, endAddress: row.endAddress };
}
function stayValues(row: StayRow): Values {
  return { propertyName: row.propertyName, address: row.address, checkInDate: row.checkInDate, checkOutDate: row.checkOutDate, checkInTime: row.checkInTime, checkOutTime: row.checkOutTime, zone: row.zone };
}

/** The stored (imported or entered) value at a field path. */
export function baseValue(row: BookingRow, segments: SegmentRow[], stay: StayRow | null, path: string): unknown {
  if (path === "title" || path === "provider" || path === "reference" || path === "status") return row[path];
  if (path === "travelers") return row.travelers;
  const stayMatch = /^stay\.(\w+)$/.exec(path);
  if (stayMatch) return stay ? stayValues(stay)[stayMatch[1]] ?? null : undefined;
  const segment = /^segments\.(\d+)\.(\w+)$/.exec(path);
  if (segment) {
    const found = segments.find((item) => item.sequence === Number(segment[1]));
    return found ? segmentValues(found)[segment[2]] ?? null : undefined;
  }
  return undefined;
}

export function effectiveBooking(row: BookingRow, segments: SegmentRow[], stay: StayRow | null, overrides: OverrideRow[]): EffectiveBooking {
  const top: Values = { title: row.title, provider: row.provider, reference: row.reference, status: row.status, travelers: row.travelers };
  const segs = [...segments].sort((a, b) => a.sequence - b.sequence).map((segment) => ({ row: segment, values: segmentValues(segment) }));
  const stayVals = stay ? stayValues(stay) : null;
  const corrections: Correction[] = [];
  for (const override of overrides) {
    let applied = false;
    if (override.field in top) { top[override.field] = override.value; applied = true; }
    const stayMatch = /^stay\.(\w+)$/.exec(override.field);
    if (stayMatch && stayVals && stayMatch[1] in stayVals) { stayVals[stayMatch[1]] = override.value; applied = true; }
    const segmentMatch = /^segments\.(\d+)\.(\w+)$/.exec(override.field);
    if (segmentMatch) {
      const target = segs.find((item) => item.row.sequence === Number(segmentMatch[1]));
      if (target && segmentMatch[2] in target.values) { target.values[segmentMatch[2]] = override.value; applied = true; }
    }
    if (applied) corrections.push({ field: override.field, label: fieldLabel(override.field, row.kind), value: override.value, original: override.original, stale: override.stale, at: override.updatedAt });
  }
  const timeNotes: string[] = [];
  const effectiveSegments: EffectiveSegment[] = segs.map(({ row: segment, values }) => {
    const startZone = (values.startZone as string | null) ?? null;
    const endZone = (values.endZone as string | null) ?? null;
    const startOverridden = overrides.some((item) => item.field === `segments.${segment.sequence}.startZone` || item.field === `segments.${segment.sequence}.startLocal`);
    const endOverridden = overrides.some((item) => item.field === `segments.${segment.sequence}.endZone` || item.field === `segments.${segment.sequence}.endLocal`);
    const start = resolveEndpoint(values.startLocal as string, startZone, startOverridden ? null : segment.startOffset);
    const endLocal = values.endLocal as string | null;
    const end = endLocal ? resolveEndpoint(endLocal, endZone ?? (row.kind === "activity" || row.kind === "car" ? startZone : null), endOverridden ? null : segment.endOffset) : null;
    const originCode = (values.originCode as string | null) ?? null;
    const destinationCode = (values.destinationCode as string | null) ?? null;
    const label = row.kind === "flight" || row.kind === "train" ? `${KIND_NOUN[row.kind]}${values.number ? ` ${values.number}` : ""}` : row.title;
    if (start.note) timeNotes.push(`${label} ${row.kind === "flight" || row.kind === "train" ? "departure" : "start"}: ${start.note}`);
    if (end?.note) timeNotes.push(`${label} ${row.kind === "flight" || row.kind === "train" ? "arrival" : "end"}: ${end.note}`);
    return {
      id: segment.id,
      sequence: segment.sequence,
      number: (values.number as string | null) ?? null,
      origin: { label: (values.originLabel as string | null) ?? airportCity(originCode), code: originCode },
      destination: { label: (values.destinationLabel as string | null) ?? airportCity(destinationCode), code: destinationCode },
      start,
      end,
      dateOnly: start.resolution === "date_only",
      address: (values.address as string | null) ?? null,
      endAddress: (values.endAddress as string | null) ?? null,
      overnight: !!end && end.date > start.date,
      duration: durationLabel(start.instant, end?.instant ?? null),
    };
  });
  let effectiveStay: EffectiveStay | null = null;
  if (stay && stayVals) {
    const zone = (stayVals.zone as string | null) ?? null;
    const checkInDate = stayVals.checkInDate as string, checkOutDate = stayVals.checkOutDate as string;
    const checkInTime = (stayVals.checkInTime as string | null) ?? null, checkOutTime = (stayVals.checkOutTime as string | null) ?? null;
    const checkIn = resolveEndpoint(checkInTime ? `${checkInDate}T${checkInTime}` : checkInDate, zone);
    const checkOut = resolveEndpoint(checkOutTime ? `${checkOutDate}T${checkOutTime}` : checkOutDate, zone);
    effectiveStay = {
      id: stay.id,
      propertyName: stayVals.propertyName as string,
      address: (stayVals.address as string | null) ?? null,
      checkInDate, checkOutDate, checkInTime, checkOutTime, zone,
      nights: Math.max(0, daysBetween(checkInDate, checkOutDate)),
      checkIn, checkOut,
    };
    if (checkIn.note && checkIn.resolution !== "zone_missing") timeNotes.push(`Check-in: ${checkIn.note}`);
  }
  const dates = [
    ...effectiveSegments.flatMap((segment) => [segment.start.date, segment.end?.date].filter((value): value is string => !!value)),
    ...(effectiveStay ? [effectiveStay.checkInDate, effectiveStay.checkOutDate] : []),
  ].sort();
  return {
    ...row,
    title: top.title as string,
    provider: (top.provider as string | null) ?? null,
    reference: (top.reference as string | null) ?? null,
    status: top.status as BookingStatus,
    travelers: (top.travelers as string[]) ?? [],
    segments: effectiveSegments,
    stay: effectiveStay,
    corrections,
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
    timeNotes,
  };
}
const KIND_NOUN: Record<BookingKind, string> = { flight: "Flight", train: "Train", lodging: "Stay", car: "Car rental", activity: "Activity" };

/** Values a draft proposes at each field path, for comparison and change records. Unknown values are left out, never treated as empty. */
export function draftValues(draft: BookingDraft): Map<string, unknown> {
  const values = new Map<string, unknown>();
  const put = (path: string, value: unknown) => {
    if (value === undefined || value === null || (Array.isArray(value) && !value.length) || value === "") return;
    values.set(path, value);
  };
  put("title", draft.title);
  put("provider", draft.provider);
  put("reference", draft.reference);
  put("travelers", draft.travelers);
  put("status", draft.status);
  if (draft.stay) for (const [key, value] of Object.entries(draft.stay)) put(`stay.${key}`, value);
  (draft.segments ?? []).forEach((segment, index) => {
    for (const [key, value] of Object.entries(segment)) if (!key.endsWith("Offset")) put(`segments.${index}.${key}`, value);
  });
  return values;
}

/** Describe a value in change records and review comparisons. */
export function displayValue(path: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Not provided";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return `${value.slice(0, 10)} ${value.slice(11)}`;
  if (path === "status" && typeof value === "string") return value.charAt(0).toUpperCase() + value.slice(1);
  return String(value);
}

export function stayDraftOf(stay: EffectiveStay | null): StayDraft | null {
  return stay ? { propertyName: stay.propertyName, address: stay.address, checkInDate: stay.checkInDate, checkOutDate: stay.checkOutDate, checkInTime: stay.checkInTime, checkOutTime: stay.checkOutTime, zone: stay.zone } : null;
}
export function segmentDraftOf(segment: EffectiveSegment): SegmentDraft {
  return {
    number: segment.number,
    originLabel: segment.origin.label,
    originCode: segment.origin.code,
    destinationLabel: segment.destination.label,
    destinationCode: segment.destination.code,
    startLocal: segment.start.local,
    startZone: segment.start.zone,
    endLocal: segment.end?.local ?? null,
    endZone: segment.end?.zone ?? null,
    address: segment.address,
    endAddress: segment.endAddress,
  };
}
/** The effective booking as a draft, for prefilled forms and comparisons. */
export function draftOf(booking: EffectiveBooking): BookingDraft {
  return {
    kind: booking.kind,
    title: booking.title,
    provider: booking.provider,
    reference: booking.reference,
    detail: booking.detail,
    travelers: booking.travelers,
    status: booking.status,
    segments: booking.segments.map(segmentDraftOf),
    stay: stayDraftOf(booking.stay),
    notes: booking.notes,
  };
}
