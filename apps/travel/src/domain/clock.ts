/**
 * Travel time. Every endpoint keeps the local wall value the provider wrote,
 * the IANA zone when known and the resolved instant when it can be computed.
 * Date-only items never become midnight timestamps. A missing zone leaves the
 * instant unknown and says so, which blocks precise overlap arithmetic.
 */
import { formatDate, formatInstant, instantFromLocal, isValidZone, localDate, localTime, zoneAbbreviation } from "@ri/app-kit/time";

export type Resolution = "exact" | "gap" | "ambiguous" | "offset" | "date_only" | "zone_missing";
export interface Endpoint {
  /** As written: `YYYY-MM-DDTHH:MM` or `YYYY-MM-DD`. */
  local: string;
  date: string;
  time: string | null;
  zone: string | null;
  /** MST, WET, or an honest GMT offset. */
  zoneLabel: string | null;
  instant: string | null;
  resolution: Resolution;
  /** Plain explanation for a DST gap, a repeated hour or a missing zone. */
  note: string | null;
}

function offsetLabel(minutes: number) {
  if (minutes === 0) return "UTC";
  const sign = minutes > 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  return `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, "0")}` : ""}`;
}

/** Resolve one local value. `offset` is used only when the zone is unknown. */
export function resolveEndpoint(local: string, zone: string | null | undefined, offset?: number | null): Endpoint {
  const date = local.slice(0, 10);
  if (local.length === 10) return { local, date, time: null, zone: zone && isValidZone(zone) ? zone : null, zoneLabel: null, instant: null, resolution: "date_only", note: null };
  const time = local.slice(11, 16);
  if (zone && isValidZone(zone)) {
    const resolved = instantFromLocal(local, zone);
    const zoneLabel = zoneAbbreviation(resolved.instant, zone);
    let note: string | null = null;
    if (resolved.status === "gap")
      note = `Clocks move forward on ${formatDate(date, "long")}, so ${time} does not exist there. It is treated as ${localTime(resolved.instant, zone)} ${zoneLabel}. Check with the provider.`;
    else if (resolved.status === "ambiguous")
      note = `${time} happens twice on ${formatDate(date, "long")} as clocks move back. The earlier one, ${zoneLabel}, is assumed.`;
    return { local, date, time, zone, zoneLabel, instant: resolved.instant, resolution: resolved.status, note };
  }
  if (typeof offset === "number") {
    const wall = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +time.slice(0, 2), +time.slice(3, 5));
    return { local, date, time, zone: null, zoneLabel: offsetLabel(offset), instant: new Date(wall - offset * 60000).toISOString(), resolution: "offset", note: null };
  }
  return { local, date, time, zone: null, zoneLabel: null, instant: null, resolution: "zone_missing", note: "Time zone not recorded, so this time cannot be compared precisely with other bookings." };
}

/** A wall value for an instant shown in a zone, for values that arrive as instants (calendar invites with UTC times). */
export function localValueFor(instant: string, zone: string): string {
  return `${localDate(instant, zone)}T${localTime(instant, zone)}`;
}

/** "Nov 10, 08:40 WET", "Nov 10, 08:40 (zone not recorded)" or "Nov 10". */
export function describeEndpoint(endpoint: Endpoint, options: { date?: boolean } = {}): string {
  const date = options.date === false ? "" : formatDate(endpoint.date, "short");
  if (!endpoint.time) return date || "All day";
  const prefix = date ? `${date}, ` : "";
  if (endpoint.zoneLabel) return `${prefix}${endpoint.time} ${endpoint.zoneLabel}`;
  return `${prefix}${endpoint.time} (zone not recorded)`;
}

/** Hours and minutes between two known instants, such as "7h 45m". */
export function durationLabel(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const minutes = Math.round((Date.parse(end) - Date.parse(start)) / 60000);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? `${hours}h${rest ? ` ${rest}m` : ""}` : `${rest}m`;
}

/**
 * A total chronological order for itinerary entries. Entries group by their
 * local date. Inside a day, date-only entries come first, then timed entries
 * by instant when known. A timed entry without a zone is placed by its local
 * wall time read in the day's reference zone, and is marked as local order.
 * Ties break on a stable key so the same records always sort the same way.
 */
export interface Chronology {
  date: string;
  bucket: 0 | 1;
  at: number;
  tie: string;
  /** The position used a local wall time because the zone is unknown. */
  localOrder: boolean;
}
export function chronology(endpoint: Endpoint, tie: string, referenceZone: string | null): Chronology {
  if (!endpoint.time) return { date: endpoint.date, bucket: 0, at: 0, tie, localOrder: false };
  if (endpoint.instant) return { date: endpoint.date, bucket: 1, at: Date.parse(endpoint.instant), tie, localOrder: false };
  const zone = referenceZone && isValidZone(referenceZone) ? referenceZone : "UTC";
  return { date: endpoint.date, bucket: 1, at: Date.parse(instantFromLocal(endpoint.local, zone).instant), tie, localOrder: true };
}
export function compareChronology(a: Chronology, b: Chronology): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.bucket !== b.bucket) return a.bucket - b.bucket;
  if (a.at !== b.at) return a.at - b.at;
  return a.tie < b.tie ? -1 : a.tie > b.tie ? 1 : 0;
}

/** City part of an IANA zone for labels: Europe/Lisbon to "Lisbon". */
export function zoneCity(zone: string): string {
  return zone.split("/").pop()!.replace(/_/g, " ");
}
export { formatInstant };
