/**
 * The fictional preview: a Lisbon trip with an overnight flight, a hotel
 * whose revised check-in conflicts with a correction, a dinner, a forwarded
 * car rental waiting for a trip, a pasted ticket with an ambiguous date,
 * saved ideas and calendar events; a Portland trip with one uncovered night;
 * and a past Mexico City trip. Seeded only into an empty preview database.
 * Every record is marked fictional. No account is read.
 */
import { accountSource, transaction, type AccessScope } from "@ri/app-kit/data";
import { newMailCheckpoint } from "@ri/app-kit/sources";
import { parseConfirmation } from "../domain/parse/extract.js";
import type { Travel } from "../services/core.js";
import { createIntake } from "../services/evidence.js";
import { createWrites } from "../services/writes.js";
import * as fx from "./messages.js";

export const FIXTURE_ACCOUNT = "fictional-mailbox";
export const FIXTURE_ACCOUNT_LABEL = "alex.rivera@example.test (fictional)";
const OWNER: AccessScope = { kind: "owner", actorId: "fixture:preview" };

export function isEmpty(t: Travel): boolean {
  return !t.repo.get("SELECT 1 AS any FROM trips LIMIT 1") && !t.repo.get("SELECT 1 AS any FROM bookings LIMIT 1") && !t.repo.get("SELECT 1 AS any FROM evidence LIMIT 1");
}

export function seedFixtures(t: Travel, actor = "fixture:preview") {
  if (t.settings.fixtureSeeded() || !isEmpty(t)) return false;
  const intake = createIntake(t);
  const writes = createWrites(t);
  const source = accountSource(FIXTURE_ACCOUNT);
  transaction(t.db, () => {
    t.settings.set({ homeZone: "America/Denver", ownerNames: [fx.FIXTURE_TRAVELER] });
    t.accounts.setup({ account: FIXTURE_ACCOUNT, kind: "mail", historyDays: 90, label: FIXTURE_ACCOUNT_LABEL });
    const checkpoint = { ...newMailCheckpoint(90, new Date("2026-10-15T12:00:00Z")), emailAddress: "alex.rivera@example.test", backfill: { pageToken: null, pages: 2, complete: true, completedAt: "2026-10-15T12:00:00.000Z", oldestAt: "2026-07-20T12:00:00.000Z" }, history: { historyId: "fictional", pageToken: null, checkedAt: "2026-10-15T12:00:00.000Z" }, lane: "history" as const, lastSuccessAt: "2026-10-15T12:00:00.000Z" };
    t.accounts.commit(FIXTURE_ACCOUNT, "mail", checkpoint, "ready", FIXTURE_ACCOUNT_LABEL);

    const flight = intake.fixtureMessage(source, FIXTURE_ACCOUNT, fx.LISBON_FLIGHT, actor);
    const hotel = intake.fixtureMessage(source, FIXTURE_ACCOUNT, fx.LISBON_HOTEL, actor);
    // The traveler phoned the hotel and corrected check-in to 15:00 before the revised confirmation arrived.
    const hotelId = hotel.outcomes[0].bookingId!;
    writes.saveBooking(OWNER, actor, { id: hotelId, expectedRevision: t.repo.bookingRow(hotelId)!.revision, patch: { stay: { checkInTime: "15:00" } } });
    intake.fixtureMessage(source, FIXTURE_ACCOUNT, fx.LISBON_DINNER, actor);
    intake.fixtureMessage(source, FIXTURE_ACCOUNT, fx.LISBON_CAR_FORWARDED, actor);
    intake.fixtureMessage(source, FIXTURE_ACCOUNT, fx.LISBON_HOTEL_REVISED, actor);
    const pasted = parseConfirmation({ text: fx.SINTRA_TICKETS_PASTED, receivedAt: "2026-10-15T09:00:00.000Z" });
    const evidence = intake.imported({ kind: "paste", text: fx.SINTRA_TICKETS_PASTED, fileName: null, mimeType: "text/plain", bytes: null, receivedAt: "2026-10-15T09:00:00.000Z" }, pasted, true);
    intake.applyAll(evidence, pasted, actor, { fictional: true });

    for (const message of [fx.PORTLAND_TRAIN, fx.PORTLAND_HOTEL, fx.PORTLAND_RETURN_TRAIN, fx.MEXICO_FLIGHT, fx.MEXICO_HOTEL]) intake.fixtureMessage(source, FIXTURE_ACCOUNT, message, actor);

    const lisbon = flight.outcomes[0].tripId!;
    t.repo.updateTrip(lisbon, { notes: "First visit. Fictional preview trip." });
    const idea = (input: Parameters<typeof t.repo.insertIdea>[0]) => t.repo.insertIdea(input);
    idea({ tripId: lisbon, kind: "place", title: "A morning in Belem", note: "Pastries and the monastery. Travel time not checked.", url: null, priceMinor: null, currency: null, observedAt: null, location: "Belem, Lisbon", conditions: null, sourceLabel: "Your note", sourceKey: "manual", fictional: true });
    idea({ tripId: lisbon, kind: "activity", title: "Sintra day tour", note: "Small group, includes the palace.", url: "https://tours.example/sintra-day", priceMinor: 6500, currency: "EUR", observedAt: "2026-10-10", location: "Sintra, pick-up in central Lisbon", conditions: "Pick-up at 08:30. Free cancellation until the day before.", sourceLabel: "tours.example", sourceKey: "manual", fictional: true });
    idea({ tripId: lisbon, kind: "activity", title: "Sintra by train on my own", note: "Train from Rossio, about 40 minutes.", url: null, priceMinor: 1250, currency: "EUR", observedAt: "2026-10-11", location: "Sintra", conditions: "Palace tickets not included.", sourceLabel: "Your note", sourceKey: "manual", fictional: true });
    idea({ tripId: lisbon, kind: "activity", title: "Fado evening in Alfama", note: null, url: "https://events.example/fado", priceMinor: 4800, currency: "USD", observedAt: "2026-10-12", location: "Alfama, Lisbon", conditions: null, sourceLabel: "events.example", sourceKey: "manual", fictional: true });
    idea({ tripId: lisbon, kind: "place", title: "An afternoon by the river", note: "Flexible timing.", url: null, priceMinor: null, currency: null, observedAt: null, location: "Cais do Sodre", conditions: null, sourceLabel: "Your idea", sourceKey: "manual", fictional: true });

    // A fictional calendar on the same mailbox: one event matches the flight, two fall during the trip.
    t.accounts.setup({ account: FIXTURE_ACCOUNT, kind: "calendar", historyDays: 90, label: FIXTURE_ACCOUNT_LABEL, calendars: ["primary"] });
    t.accounts.commit(FIXTURE_ACCOUNT, "calendar", { primary: { version: 1, calendarId: "primary", pastDays: 30, futureDays: 365, window: { from: "2026-09-15T12:00:00.000Z", to: "2027-10-15T12:00:00.000Z" }, phase: "incremental", pageToken: null, syncToken: "fictional", completedAt: "2026-10-15T12:00:00.000Z", lastSuccessAt: "2026-10-15T12:00:00.000Z", resets: 0, timeZone: "America/Denver" } }, "ready", FIXTURE_ACCOUNT_LABEL);
    const event = (occurrenceKey: string, summary: string, startValue: string, endValue: string, allDay = false) => t.repo.upsertCalendarEvent({ account: FIXTURE_ACCOUNT, calendarId: "primary", occurrenceKey, summary, location: null, startValue, endValue, allDay, startZone: allDay ? null : "America/Denver", status: "confirmed", cancelled: false, transparent: false, response: "accepted", sourceKey: source });
    event("fx-cal-flight", "Flight RA 204 to Lisbon", "2026-11-10T00:55:00.000Z", "2026-11-10T08:40:00.000Z");
    event("fx-cal-planning", "Quarterly planning", "2026-11-11T16:00:00.000Z", "2026-11-11T17:30:00.000Z");
    event("fx-cal-dentist", "Dentist", "2026-11-13T15:00:00.000Z", "2026-11-13T16:00:00.000Z");
    event("fx-cal-birthday", "Sam's birthday dinner", "2026-12-05", "2026-12-06", true);
    t.settings.setLastTripId(lisbon);
    t.settings.markFixtureSeeded();
  });
  return true;
}
