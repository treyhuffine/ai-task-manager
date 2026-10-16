/**
 * Travel domain vocabulary shared by the backend and the view: kinds,
 * statuses, drafts (what a parser, the manual form or a reviewed AI
 * suggestion proposes) and the field paths a person can correct.
 */
import { z } from "zod/v4";
import { isLocalDate, isValidZone } from "@ri/app-kit/time";

export const BOOKING_KINDS = ["flight", "train", "lodging", "car", "activity"] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];
export const BOOKING_STATUSES = ["planned", "confirmed", "canceled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const TRIP_STATES = ["planning", "active", "completed", "archived"] as const;
export type TripState = (typeof TRIP_STATES)[number];
export const IDEA_KINDS = ["stay", "activity", "food", "transport", "place"] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];

export const KIND_LABELS: Record<BookingKind, string> = { flight: "Flight", train: "Train", lodging: "Stay", car: "Car rental", activity: "Activity" };
export const STATUS_LABELS: Record<BookingStatus, string> = { planned: "Planned", confirmed: "Confirmed", canceled: "Canceled" };

/** `YYYY-MM-DD` that is a real calendar date. */
export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isLocalDate, "Use a real calendar date");
/** `HH:MM` on a 24-hour clock. */
export const clockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time such as 08:40");
/** A local wall time `YYYY-MM-DDTHH:MM`, or a date alone for date-only items. */
export const localValueSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T([01]\d|2[0-3]):[0-5]\d)?$/, "Use YYYY-MM-DD or YYYY-MM-DDTHH:MM")
  .refine((value) => isLocalDate(value.slice(0, 10)), "Use a real calendar date");
/** An IANA zone such as Europe/Lisbon. */
export const zoneSchema = z.string().min(1).max(64).refine((value) => isValidZone(value), "Use a time zone such as Europe/Lisbon");
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, "Use a three letter currency code such as EUR");
const shortText = (max: number) => z.string().trim().max(max);

export const segmentDraftSchema = z
  .object({
    number: shortText(40).nullable().optional(),
    originLabel: shortText(200).nullable().optional(),
    originCode: shortText(8).nullable().optional(),
    destinationLabel: shortText(200).nullable().optional(),
    destinationCode: shortText(8).nullable().optional(),
    startLocal: localValueSchema,
    startZone: zoneSchema.nullable().optional(),
    /** Minutes east of UTC when a source states an offset but no zone. */
    startOffset: z.number().int().min(-900).max(900).nullable().optional(),
    endLocal: localValueSchema.nullable().optional(),
    endZone: zoneSchema.nullable().optional(),
    endOffset: z.number().int().min(-900).max(900).nullable().optional(),
    address: shortText(400).nullable().optional(),
    endAddress: shortText(400).nullable().optional(),
  })
  .strict();
export type SegmentDraft = z.infer<typeof segmentDraftSchema>;

export const stayDraftSchema = z
  .object({
    propertyName: shortText(200).min(1),
    address: shortText(400).nullable().optional(),
    checkInDate: localDateSchema,
    checkOutDate: localDateSchema,
    checkInTime: clockTimeSchema.nullable().optional(),
    checkOutTime: clockTimeSchema.nullable().optional(),
    zone: zoneSchema.nullable().optional(),
  })
  .strict()
  .refine((stay) => stay.checkOutDate > stay.checkInDate, "Check-out must be after check-in");
export type StayDraft = z.infer<typeof stayDraftSchema>;

export const bookingDraftSchema = z
  .object({
    kind: z.enum(BOOKING_KINDS),
    title: shortText(200).nullable().optional(),
    provider: shortText(200).nullable().optional(),
    providerCode: shortText(8).nullable().optional(),
    reference: shortText(60).nullable().optional(),
    /** A short source line such as "Table for one", "Seat 14A" or "Compact car". */
    detail: shortText(160).nullable().optional(),
    travelers: z.array(shortText(120).min(1)).max(20).optional(),
    status: z.enum(BOOKING_STATUSES).optional(),
    segments: z.array(segmentDraftSchema).max(12).optional(),
    stay: stayDraftSchema.nullable().optional(),
    notes: shortText(2000).nullable().optional(),
  })
  .strict();
export type BookingDraft = z.infer<typeof bookingDraftSchema>;

/** What deterministic or AI extraction proposes for one booking, with its exact evidence. */
export interface ParsedBooking {
  draft: BookingDraft;
  /** Exact passages from the source that support the fields. */
  passages: string[];
  /** Fields the source did not provide. */
  missing: string[];
  /** Fields that could be read more than one way, with the reason. */
  ambiguous: { field: string; reason: string }[];
  /** The source says this reservation changed. */
  change: boolean;
  /** The source says this reservation was canceled. */
  cancellation: boolean;
  method: "deterministic" | "ai" | "invite";
  /** The source did not say what kind of booking this is, so matching ignores the kind. */
  kindGuessed?: boolean;
  /** Values read for an incomplete booking, to prefill the review form. */
  partial?: { stay?: Partial<StayDraft>; segments?: Partial<SegmentDraft>[] };
}

export interface ParseResult {
  bookings: ParsedBooking[];
  forwarded: boolean;
  /** The text reads like travel mail even if nothing was extracted. */
  travelLike: boolean;
  /** Why nothing could be extracted, for the review queue. */
  notes: string[];
}

/** Paths a person can correct. Segment paths use the segment sequence: `segments.0.startLocal`. */
export const BOOKING_FIELDS = ["title", "provider", "reference", "travelers", "status"] as const;
export const STAY_FIELDS = ["propertyName", "address", "checkInDate", "checkOutDate", "checkInTime", "checkOutTime", "zone"] as const;
export const SEGMENT_FIELDS = ["number", "originLabel", "originCode", "destinationLabel", "destinationCode", "startLocal", "startZone", "endLocal", "endZone", "address", "endAddress"] as const;
export type SegmentField = (typeof SEGMENT_FIELDS)[number];
export type StayField = (typeof STAY_FIELDS)[number];

export const fieldPathSchema = z
  .string()
  .max(60)
  .refine((path) => {
    if ((BOOKING_FIELDS as readonly string[]).includes(path)) return true;
    const stay = /^stay\.(\w+)$/.exec(path);
    if (stay) return (STAY_FIELDS as readonly string[]).includes(stay[1]);
    const segment = /^segments\.(\d{1,2})\.(\w+)$/.exec(path);
    return !!segment && (SEGMENT_FIELDS as readonly string[]).includes(segment[2]);
  }, "Unknown booking field");

export function fieldLabel(path: string, kind: BookingKind): string {
  const segmentLabels: Record<string, [string, string]> = {
    number: [kind === "train" ? "Train" : "Flight number", "Number"],
    originLabel: [kind === "car" ? "Pick-up location" : "From", "From"],
    originCode: ["Departure airport", "From"],
    destinationLabel: [kind === "car" ? "Return location" : "To", "To"],
    destinationCode: ["Arrival airport", "To"],
    startLocal: [kind === "car" ? "Pick-up time" : kind === "activity" ? "Start time" : "Departure time", "Start"],
    startZone: [kind === "car" ? "Pick-up time zone" : "Departure time zone", "Start zone"],
    endLocal: [kind === "car" ? "Return time" : kind === "activity" ? "End time" : "Arrival time", "End"],
    endZone: [kind === "car" ? "Return time zone" : "Arrival time zone", "End zone"],
    address: [kind === "car" ? "Pick-up address" : "Address", "Address"],
    endAddress: ["Return address", "Return address"],
  };
  const labels: Record<string, string> = {
    title: "Title", provider: "Provider", reference: "Confirmation", travelers: "Travelers", status: "Status",
    "stay.propertyName": "Property", "stay.address": "Address", "stay.checkInDate": "Check-in date", "stay.checkOutDate": "Check-out date",
    "stay.checkInTime": "Check-in time", "stay.checkOutTime": "Check-out time", "stay.zone": "Time zone",
  };
  if (labels[path]) return labels[path];
  const segment = /^segments\.(\d+)\.(\w+)$/.exec(path);
  if (segment) {
    const label = segmentLabels[segment[2]]?.[0] ?? segment[2];
    return Number(segment[1]) > 0 ? `${label} (leg ${Number(segment[1]) + 1})` : label;
  }
  return path;
}

/** Reasons a review item exists. */
export const REVIEW_KINDS = ["assign", "change", "cancellation", "identity", "extraction", "unreadable"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];
export const REVIEW_DECISIONS = ["accept", "keep", "assign", "new_trip", "link", "separate", "dismiss"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** Source keys for collections that are not connected accounts. */
export const MANUAL_SOURCE = "manual";
export const IMPORTS_SOURCE = "imports";
export const COLLECTION_LABELS: Record<string, string> = {
  [MANUAL_SOURCE]: "Manual entries and ideas",
  [IMPORTS_SOURCE]: "Uploaded and pasted confirmations",
};
