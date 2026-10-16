/**
 * Zone-aware dates using only the platform Intl time-zone database, so the
 * same code runs in an app backend and in its sandboxed view. Local dates are
 * `YYYY-MM-DD` strings and never pass through a midnight timestamp. Instants
 * are ISO strings with an offset or `Z`. Copy avoids dashes: ranges read
 * "November 9 to 14, 2026".
 */
export type LocalDate = string;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string, options: Intl.DateTimeFormatOptions, locale = "en-US") {
  const key = `${locale}|${zone}|${JSON.stringify(options)}`;
  let value = formatters.get(key);
  if (!value) {
    if (formatters.size > 500) formatters.clear();
    value = new Intl.DateTimeFormat(locale, { timeZone: zone, ...options });
    formatters.set(key, value);
  }
  return value;
}
function toDate(instant: string | Date) {
  const value = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(value.getTime())) throw new RangeError(`Invalid instant: ${String(instant).slice(0, 80)}`);
  return value;
}

export function isValidZone(zone: string | null | undefined): zone is string {
  if (!zone || zone.length > 100) return false;
  try {
    formatter(zone, { year: "numeric" });
    return true;
  } catch {
    return false;
  }
}
export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string") return false;
  const match = DATE.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return date.toISOString().slice(0, 10) === value;
}
/** The zone this process or browser reports, defaulting to UTC. */
export function systemZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }
/** Wall-clock parts of an instant in a zone. `weekday` is 0 for Sunday. */
export function zonedParts(instant: string | Date, zone: string): ZonedParts {
  const parts = formatter(zone, {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23", weekday: "short",
  }).formatToParts(toDate(instant));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(read("weekday"));
  return { year: +read("year"), month: +read("month"), day: +read("day"), hour: +read("hour") % 24, minute: +read("minute"), second: +read("second"), weekday };
}
const pad = (value: number, size = 2) => String(value).padStart(size, "0");
export function localDate(instant: string | Date, zone: string): LocalDate {
  const p = zonedParts(instant, zone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}
export function localTime(instant: string | Date, zone: string): string {
  const p = zonedParts(instant, zone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}
export function todayIn(zone: string, now: Date = new Date()): LocalDate {
  return localDate(now, zone);
}
/** Minutes east of UTC for this instant in this zone. */
export function offsetMinutes(instant: string | Date, zone: string): number {
  const date = toDate(instant);
  const p = zonedParts(date, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}
/**
 * A short zone label for an instant, such as MDT or WET. Intl names zones
 * differently per locale, so a few English locales are tried before falling
 * back to an honest offset such as GMT+9.
 */
export function zoneAbbreviation(instant: string | Date, zone: string): string {
  let fallback: string | undefined;
  for (const locale of ["en-US", "en-GB", "en-AU", "pt-PT"]) {
    const value = formatter(zone, { timeZoneName: "short" }, locale).formatToParts(toDate(instant)).find((part) => part.type === "timeZoneName")?.value;
    if (!value) continue;
    if (/^[A-Z]{2,5}$/.test(value)) return value;
    fallback ??= value.replace(/^GMT\+0$/, "GMT");
  }
  return fallback ?? zone;
}

export type LocalResolution = { instant: string; status: "exact" | "gap" | "ambiguous" };
/**
 * The instant for a wall-clock time in a zone. In a spring-forward gap the
 * time moves forward by the gap and reports `gap`. In a repeated fall-back
 * hour the earlier instant is chosen and reported as `ambiguous`.
 */
export function instantFromLocal(local: string, zone: string): LocalResolution {
  const match = LOCAL.exec(local);
  if (!match || !isLocalDate(local.slice(0, 10))) throw new RangeError(`Invalid local time: ${local.slice(0, 40)}`);
  if (!isValidZone(zone)) throw new RangeError(`Unknown time zone: ${String(zone).slice(0, 40)}`);
  const [, y, mo, d, h, mi, s] = match;
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0));
  const candidates = new Set<number>();
  for (const probe of [wall - 36e5 * 14, wall - 36e5 * 3, wall, wall + 36e5 * 3, wall + 36e5 * 14]) {
    const offset = offsetMinutes(new Date(probe), zone);
    candidates.add(wall - offset * 60000);
  }
  const matches = [...candidates].filter((time) => {
    const p = zonedParts(new Date(time), zone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) === wall;
  }).sort((a, b) => a - b);
  if (matches.length) return { instant: new Date(matches[0]).toISOString(), status: matches.length > 1 ? "ambiguous" : "exact" };
  // Nonexistent wall time: use the offset in force before the transition.
  const before = offsetMinutes(new Date(wall - 36e5 * 3), zone);
  return { instant: new Date(wall - before * 60000).toISOString(), status: "gap" };
}

function utcDay(date: LocalDate) {
  if (!isLocalDate(date)) throw new RangeError(`Invalid date: ${String(date).slice(0, 20)}`);
  return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
}
export function addDays(date: LocalDate, days: number): LocalDate {
  return new Date(utcDay(date) + days * 864e5).toISOString().slice(0, 10);
}
/** Whole days from `a` to `b`. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((utcDay(b) - utcDay(a)) / 864e5);
}
/** Inclusive list of dates, bounded to 400 entries. */
export function dateRange(start: LocalDate, endInclusive: LocalDate): LocalDate[] {
  const count = daysBetween(start, endInclusive);
  if (count < 0) return [];
  if (count > 399) throw new RangeError("Date range exceeds 400 days");
  return Array.from({ length: count + 1 }, (_, index) => addDays(start, index));
}
export function weekdayOf(date: LocalDate): number {
  return new Date(utcDay(date)).getUTCDay();
}

const UTC = "UTC";
type DateStyle = "day" | "short" | "medium" | "long" | "weekday" | "weekdayLong";
/** Display a calendar date: day "10", short "Nov 10", medium "Nov 10, 2026", long "November 10, 2026", weekday "Tue 10", weekdayLong "Tuesday, November 10". */
export function formatDate(date: LocalDate, style: DateStyle = "short", locale = "en-US"): string {
  const value = new Date(utcDay(date));
  switch (style) {
    case "day": return String(value.getUTCDate());
    case "short": return formatter(UTC, { month: "short", day: "numeric" }, locale).format(value);
    case "medium": return formatter(UTC, { month: "short", day: "numeric", year: "numeric" }, locale).format(value);
    case "long": return formatter(UTC, { month: "long", day: "numeric", year: "numeric" }, locale).format(value);
    case "weekday": return `${formatter(UTC, { weekday: "short" }, locale).format(value)} ${value.getUTCDate()}`;
    case "weekdayLong": return formatter(UTC, { weekday: "long", month: "long", day: "numeric" }, locale).format(value);
  }
}
/** "November 9 to 14, 2026", "October 30 to November 2, 2026" or "December 30, 2026 to January 2, 2027". */
export function formatDateRange(start: LocalDate, endInclusive: LocalDate, locale = "en-US"): string {
  if (start === endInclusive) return formatDate(start, "long", locale);
  const a = new Date(utcDay(start)), b = new Date(utcDay(endInclusive));
  const month = (value: Date) => formatter(UTC, { month: "long" }, locale).format(value);
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${formatDate(start, "long", locale)} to ${formatDate(endInclusive, "long", locale)}`;
  if (a.getUTCMonth() === b.getUTCMonth()) return `${month(a)} ${a.getUTCDate()} to ${b.getUTCDate()}, ${a.getUTCFullYear()}`;
  return `${month(a)} ${a.getUTCDate()} to ${month(b)} ${b.getUTCDate()}, ${a.getUTCFullYear()}`;
}
/** "08:40", "Nov 10, 08:40" or "Tue, Nov 10, 08:40", with the zone label when asked. */
export function formatInstant(instant: string | Date, zone: string, options: { date?: "none" | "short" | "weekday"; zone?: boolean } = {}): string {
  const date = options.date ?? "short";
  const time = localTime(instant, zone);
  const day = localDate(instant, zone);
  const prefix = date === "none" ? "" : date === "weekday" ? `${formatter(UTC, { weekday: "short" }).format(new Date(utcDay(day)))}, ${formatDate(day, "short")}, ` : `${formatDate(day, "short")}, `;
  return `${prefix}${time}${options.zone ? ` ${zoneAbbreviation(instant, zone)}` : ""}`;
}
/** Today, Tomorrow or Yesterday, otherwise null. */
export function relativeDay(date: LocalDate, today: LocalDate): "Today" | "Tomorrow" | "Yesterday" | null {
  const delta = daysBetween(today, date);
  return delta === 0 ? "Today" : delta === 1 ? "Tomorrow" : delta === -1 ? "Yesterday" : null;
}
