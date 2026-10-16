/** Small view helpers: routes, labels, tones and Ask Ri prompts. */
import type { Tone } from "@ri/app-kit/ui";
import { formatDate } from "@ri/app-kit/time";
import type { Booking, Gap, Item, OpenData, Route, StatusFilter, TripTab } from "./types.js";

export const KIND_LABELS: Record<Booking["kind"], string> = { flight: "Flight", train: "Train", lodging: "Stay", car: "Car rental", activity: "Activity" };
export const STATUS_TONES: Record<Booking["status"], Tone> = { confirmed: "success", planned: "neutral", canceled: "danger" };
export const STATUS_LABELS: Record<Booking["status"], string> = { confirmed: "Confirmed", planned: "Planned", canceled: "Canceled" };

/** A message for people: no bridge protocol prefixes such as "MCP error -32603:". */
export function cleanError(message: string | null | undefined): string | null {
  if (!message) return null;
  return message.replace(/^(?:MCP error\s*-?\d+:\s*)+/i, "").trim() || null;
}
export function errorText(error: unknown, fallback = "That did not work. Try again."): string {
  if (error instanceof Error && error.message) return cleanError(error.message) ?? fallback;
  if (typeof error === "string" && error) return cleanError(error) ?? fallback;
  return fallback;
}

export function pathOf(route: Route): string {
  switch (route.section) {
    case "trips": return "/trips";
    case "review": return route.tripId ? `/review?trip=${encodeURIComponent(route.tripId)}` : "/review";
    case "sources": return "/sources";
    case "access": return "/access";
    case "trip": {
      const query = new URLSearchParams();
      if (route.tab !== "itinerary") query.set("tab", route.tab);
      if (route.day) query.set("day", route.day);
      if (route.selected) query.set("selected", route.selected);
      if (route.status !== "all") query.set("status", route.status);
      if (route.q) query.set("q", route.q);
      const text = query.toString();
      return `/trips/${encodeURIComponent(route.tripId)}${text ? `?${text}` : ""}`;
    }
  }
}

export function routeFromData(data: OpenData | undefined): Route {
  if (!data) return { section: "trips" };
  const status = (["all", "confirmed", "planned", "canceled", "needs_review"] as const).includes(data.filters.status as StatusFilter) ? (data.filters.status as StatusFilter) : "all";
  switch (data.section) {
    case "trip":
    case "booking":
      if (!data.tripId) return { section: "trips" };
      return { section: "trip", tripId: data.tripId, tab: (data.tab ?? "itinerary") as TripTab, day: data.day, selected: data.bookingId ?? data.selected, status, q: data.filters.q ?? "" };
    case "review": return { section: "review", tripId: data.filters.trip ?? null };
    case "sources": return { section: "sources" };
    case "access": return { section: "access" };
    default: return { section: "trips" };
  }
}

export function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** "08:40" with its zone label beneath, or "All day". */
export function timeLabel(item: Pick<Item, "time" | "zoneLabel" | "localOrder">) {
  if (!item.time) return { time: "All day", zone: null };
  return { time: item.time, zone: item.zoneLabel ?? (item.localOrder ? "Zone not recorded" : null) };
}

export function dayChip(date: string) {
  const weekday = formatDate(date, "weekday").split(" ")[0];
  return { weekday, day: formatDate(date, "day"), month: formatDate(date, "short").split(" ")[0] };
}

export function travelersLine(travelers: string[]) {
  if (!travelers.length) return null;
  if (travelers.length === 1) return "One traveler";
  return `${travelers.length} travelers`;
}

// ─── Ask Ri prompts. Staged in the composer, never sent. ─────────────────────

export function tripPrompt(title: string) {
  return `Review my ${title} itinerary. What is still missing, based on my recorded bookings?`;
}
export function bookingPrompt(booking: Booking, tripTitle: string | null) {
  const trip = tripTitle ? `my ${tripTitle} trip` : "my trip";
  switch (booking.kind) {
    case "lodging": return `Check ${booking.title} against ${trip}. Are all of my nights covered?`;
    case "flight": return `Explain the dates and local times for ${booking.title}${booking.segments.some((segment) => segment.overnight) ? ", including the overnight arrival" : ""}.`;
    case "activity": return `Help me plan around ${booking.title} on ${booking.dateLabel}. Distinguish saved plans from suggestions.`;
    case "car": return `Walk me through ${booking.title}: pick-up, return and how it fits ${trip}.`;
    case "train": return `Explain the times and stations for ${booking.title} and how it fits ${trip}.`;
  }
}
export function dayPrompt(date: string, tripTitle: string) {
  return `Help me plan ${formatDate(date, "weekdayLong")} in ${tripTitle} using my recorded bookings. Keep suggestions separate from confirmed plans.`;
}
export function gapPrompt(gap: Gap, tripTitle: string) {
  if (gap.kind === "night") return `${gap.message.replace(/\.$/, "")} in my ${tripTitle} trip. What should I check, and what are my options?`;
  if (gap.kind === "overlap") return `In my ${tripTitle} trip: ${gap.message} Help me sort this out.`;
  return `In my ${tripTitle} trip: ${gap.message} Help me find the right time zone.`;
}
export function ideaPrompt(title: string, tripTitle: string) {
  return `Help me consider ${title} during my ${tripTitle} trip. Keep suggestions separate from confirmed plans.`;
}
export function comparePrompt(titles: string[], tripTitle: string) {
  return `Compare these ${tripTitle} ideas using their saved prices and details: ${titles.join(", ")}. Do not rank them with invented ratings.`;
}

/** A version 4 UUID that also works where crypto.randomUUID is unavailable. */
export function uuid(): string {
  if (typeof crypto.randomUUID === "function") {
    try { return crypto.randomUUID(); } catch { /* Not a secure context. */ }
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Run a write for a kit component that shows the thrown message, with a clean message. */
export async function cleanly<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new Error(errorText(error));
  }
}
