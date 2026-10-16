/**
 * Fictional contract examples. The build validates every example input and
 * output against the action schemas, so these double as documentation of the
 * record shapes. No real people, accounts or providers.
 */
import type { BookingRecord, FollowUpRecord, IdeaRecord, ReviewItemRecord, TripDetail, TripRecord } from "./schemas.js";

const AT = "2026-10-14T09:12:00.000Z";
export const EX_TRIP_ID = "4f1c2d3e-0000-4000-8000-000000000001";
export const EX_FLIGHT_ID = "4f1c2d3e-0000-4000-8000-000000000002";
export const EX_HOTEL_ID = "4f1c2d3e-0000-4000-8000-000000000003";
export const EX_IDEA_ID = "4f1c2d3e-0000-4000-8000-000000000004";
export const EX_IDEA_2_ID = "4f1c2d3e-0000-4000-8000-000000000005";
export const EX_REVIEW_ID = "4f1c2d3e-0000-4000-8000-000000000006";
export const EX_EVIDENCE_ID = "4f1c2d3e-0000-4000-8000-000000000007";
export const EX_FOLLOW_UP_ID = "4f1c2d3e-0000-4000-8000-000000000008";
export const EX_OPERATION_ID = "4f1c2d3e-0000-4000-8000-000000000009";
export const EX_INSTANCE_ID = "4f1c2d3e-0000-4000-8000-00000000000a";
export const EX_PREVIEW_ID = "4f1c2d3e-0000-4000-8000-00000000000b";
export const EX_DIGEST = "a3f1c0de".repeat(8);

const sourceRef = { evidenceId: EX_EVIDENCE_ID, role: "created" as const, origin: "gmail" as const, title: "Your stay at Riverside House is confirmed", sender: "Riverside House", receivedAt: AT, observedAt: AT, availability: "available" as const, sourceLabel: "Email from Riverside House", method: "deterministic", fictional: true };

export const exampleHotel: BookingRecord = {
  id: EX_HOTEL_ID, createdAt: AT, updatedAt: AT, revision: 2, tripId: EX_TRIP_ID, tripTitle: "Lisbon",
  kind: "lodging", kindLabel: "Stay", title: "Riverside House", provider: "Riverside House", providerCode: null, reference: "RH-4821", detail: "Deluxe double room",
  travelers: ["Alex Rivera"], status: "confirmed", statusLabel: "Confirmed", notes: null, method: "deterministic", segments: [],
  stay: {
    id: "4f1c2d3e-0000-4000-8000-00000000000c", propertyName: "Riverside House", address: "Rua da Prata 112, 1100-420 Lisbon, Portugal", checkInDate: "2026-11-10", checkOutDate: "2026-11-14",
    checkInTime: "15:00", checkOutTime: "11:00", zone: "Europe/Lisbon", nights: 4,
    checkIn: { local: "2026-11-10T15:00", date: "2026-11-10", time: "15:00", zone: "Europe/Lisbon", zoneLabel: "WET", instant: "2026-11-10T15:00:00.000Z", resolution: "exact", note: null },
    checkOut: { local: "2026-11-14T11:00", date: "2026-11-14", time: "11:00", zone: "Europe/Lisbon", zoneLabel: "WET", instant: "2026-11-14T11:00:00.000Z", resolution: "exact", note: null },
  },
  corrections: [{ field: "stay.checkInTime", label: "Check-in time", value: "15:00", original: "14:00", stale: false, at: AT }],
  firstDate: "2026-11-10", lastDate: "2026-11-14", dateLabel: "November 10 to 14, 2026", summary: "November 10 to 14, 2026, 4 nights, Rua da Prata 112, 1100-420 Lisbon, Portugal", timeNotes: [],
  sources: [sourceRef], coverage: { sources: 1, available: 1, unavailable: 0, missing: [], note: null }, openReviewIds: [], fictional: true,
};
export const exampleFlight: BookingRecord = {
  ...exampleHotel, id: EX_FLIGHT_ID, kind: "flight", kindLabel: "Flight", title: "Flight RA 204", provider: "Riverline Air", providerCode: "RA", reference: "RA-7416", detail: null, stay: null, corrections: [],
  segments: [{
    id: "4f1c2d3e-0000-4000-8000-00000000000d", sequence: 0, number: "RA 204", origin: { label: "Denver", code: "DEN" }, destination: { label: "Lisbon", code: "LIS" },
    start: { local: "2026-11-09T17:55", date: "2026-11-09", time: "17:55", zone: "America/Denver", zoneLabel: "MST", instant: "2026-11-10T00:55:00.000Z", resolution: "exact", note: null },
    end: { local: "2026-11-10T08:40", date: "2026-11-10", time: "08:40", zone: "Europe/Lisbon", zoneLabel: "WET", instant: "2026-11-10T08:40:00.000Z", resolution: "exact", note: null },
    dateOnly: false, address: null, endAddress: null, overnight: true, duration: "7h 45m",
  }],
  firstDate: "2026-11-09", lastDate: "2026-11-10", dateLabel: "November 9 to 10, 2026", summary: "DEN to LIS, Nov 9, 17:55 MST",
  sources: [{ ...sourceRef, title: "Your Riverline Air booking is confirmed", sender: "Riverline Air", sourceLabel: "Email from Riverline Air" }],
};
export const exampleTrip: TripRecord = {
  id: EX_TRIP_ID, createdAt: AT, updatedAt: AT, revision: 3, title: "Lisbon", destinations: ["Lisbon"], startDate: "2026-11-09", endDate: "2026-11-14", dateLabel: "November 9 to 14, 2026",
  datesSource: "derived", homeZone: "America/Denver", state: "planning", travelers: ["Alex Rivera"], notes: null, bookingCount: 3, canceledCount: 0, ideaCount: 2, reviewCount: 1,
  attention: "1 item to review", projection: "full", fictional: true,
};
export const exampleIdea: IdeaRecord = {
  id: EX_IDEA_ID, createdAt: AT, updatedAt: AT, revision: 1, tripId: EX_TRIP_ID, kind: "activity", title: "Sintra day tour", note: "Small group, includes the palace.", url: "https://tours.example/sintra-day",
  priceMinor: 6500, currency: "EUR", priceLabel: "EUR 65.00", observedAt: "2026-10-10", location: "Sintra", conditions: "Pick-up at 08:30", sourceLabel: "tours.example", fictional: true,
};
export const exampleIdea2: IdeaRecord = { ...exampleIdea, id: EX_IDEA_2_ID, title: "Sintra by train on my own", url: null, priceMinor: 1250, priceLabel: "EUR 12.50", observedAt: "2026-10-11", conditions: "Palace tickets not included", sourceLabel: "Your note" };
export const exampleReview: ReviewItemRecord = {
  id: EX_REVIEW_ID, createdAt: AT, updatedAt: AT, revision: 1, kind: "change", kindLabel: "Changed details", headline: "Riverside House changed",
  reason: "Riverside House changed check-in time. Your earlier correction is kept until you choose.", bookingId: EX_HOTEL_ID, bookingTitle: "Riverside House", tripId: EX_TRIP_ID, tripTitle: "Lisbon",
  candidates: [], comparison: [{ field: "stay.checkInTime", label: "Check-in time", current: "15:00", proposed: "16:00" }], correctionConflict: true,
  draft: null, prefill: {}, missing: [], passages: [], evidence: [{ ...sourceRef, role: "pending" }], decisions: ["accept", "keep"], decision: null, decidedAt: null, fictional: true,
};
export const exampleFollowUp: FollowUpRecord = {
  id: EX_FOLLOW_UP_ID, createdAt: AT, updatedAt: AT, subjectType: "trip", subjectId: EX_TRIP_ID, operationId: EX_OPERATION_ID, title: "Arrange the airport transfer in Lisbon",
  dueAt: "2026-11-02", taskId: "task-fictional-1", state: "created", availability: "available", checkedAt: AT, message: null,
};
export const exampleDetail: TripDetail = {
  trip: exampleTrip,
  days: [{
    date: "2026-11-10", label: "Tuesday, November 10", zones: [{ zone: "Europe/Lisbon", label: "WET", city: "Lisbon" }], zoneMissing: false, zoneLine: "Local times in Lisbon WET",
    items: [{
      id: `${EX_FLIGHT_ID}:arrive`, bookingId: EX_FLIGHT_ID, kind: "flight", role: "arrive", date: "2026-11-10", time: "08:40", zone: "Europe/Lisbon", zoneLabel: "WET", instant: "2026-11-10T08:40:00.000Z",
      title: "Arrive in Lisbon", subtitle: "Flight RA 204", context: "From Denver, overnight flight, departed Nov 9, 17:55 MST", location: "Lisbon", status: "confirmed", allDay: false, localOrder: false, notes: [],
      sourceLabel: "Confirmation email", sourceAvailable: true, corrected: false, needsReview: false,
    }],
    gapKeys: [], inTrip: true,
  }],
  bookings: [exampleFlight, exampleHotel],
  coverage: { checked: true, summary: "Every night has a booking recorded and no times overlap", open: 0, nights: [{ date: "2026-11-09", status: "covered", by: [{ bookingId: EX_FLIGHT_ID, kind: "flight", label: "Flight RA 204", how: "overnight" }] }], gaps: [] },
  review: [exampleReview],
  calendar: { status: "ready", message: "1 calendar event during this trip.", events: [{ id: "4f1c2d3e-0000-4000-8000-00000000000e", summary: "Quarterly planning", start: "2026-11-11T16:00:00.000Z", end: "2026-11-11T17:30:00.000Z", allDay: false, when: "Wed, Nov 11, 09:00 MST", relation: "during_trip", bookingId: null, note: "On your calendar while you are away.", sourceLabel: "Calendar" }], checkedThrough: AT },
  followUps: [exampleFollowUp], ideaCount: 2, localContext: "Times are local: Denver MST, Lisbon WET. Home zone America/Denver", revision: "r42",
};
export const exampleDraft = {
  kind: "flight" as const, title: "Flight RA 204", provider: "Riverline Air", reference: "RA-7416", travelers: ["Alex Rivera"], status: "confirmed" as const,
  segments: [{ number: "RA 204", originCode: "DEN", destinationCode: "LIS", startLocal: "2026-11-09T17:55", startZone: "America/Denver", endLocal: "2026-11-10T08:40", endZone: "Europe/Lisbon" }],
};
export const exampleSourceAccount = {
  id: "mail:conn-fictional-1", account: "conn-fictional-1", label: "alex.rivera@example.test", detail: null, kind: "mail" as const, granted: true, automatic: true, status: "ready" as const,
  coverage: { from: "2026-07-17", to: "2026-10-15", partial: false }, historyDays: 90 as const, lastSuccessAt: AT, pending: 0, failed: 0, error: null, paused: false, records: 4, skipped: 37, calendars: [], fictional: true,
  firstDetected: { tripId: EX_TRIP_ID, title: "Lisbon", dateLabel: "November 9 to 14, 2026", bookings: 3 },
};
export const exampleStep = { ran: true, kind: "mail_sync", source: "account:conn-fictional-1", more: true, summary: "Checked older mail, read 10 messages, added 2 bookings", read: 10, added: 2, review: 0, skipped: 3, removed: 0 };
