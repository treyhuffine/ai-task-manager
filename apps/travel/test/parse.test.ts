import { describe, expect, it } from "vitest";
import { htmlToText } from "@ri/app-kit/sources";
import { parseConfirmation } from "../src/domain/parse/extract.js";
import { cleanName, findDates, findReferences, findTimes, splitNames } from "../src/domain/parse/text.js";
import * as fx from "../src/fixtures/messages.js";

const parse = (message: fx.FixtureMessage) => {
  const [name, address] = /^(.*?)\s*<([^>]+)>$/.exec(message.from)!.slice(1);
  return parseConfirmation({ text: `Subject: ${message.subject}\n\n${message.text}`, subject: message.subject, senderName: name, senderAddress: address, receivedAt: message.receivedAt });
};

describe("text readers", () => {
  it("reads dates in common forms and flags a date that can be read two ways", () => {
    const dates = findDates("Mon, Nov 9, 2026 and 10 de novembro de 2026, 2026-11-11, 12.11.2026, 13/11/2026 and 11/12/2026", "2026-10-01");
    expect(dates.map((item) => item.date)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-12"]);
    expect(dates.at(-1)!.ambiguity).toBe("11/12/2026 could be November 12 or December 11");
    expect(findDates("Check-in Nov 9", "2026-10-01")[0]).toMatchObject({ date: "2026-11-09", inferredYear: true });
    expect(findDates("Check-in Jan 9", "2026-10-01")[0].date).toBe("2027-01-09");
    expect(findDates("Oct 10:30 is not a date", "2026-10-01")).toEqual([]);
    expect(findDates("email me", "2026-10-01")).toEqual([]);
  });
  it("reads 24-hour and 12-hour times", () => {
    expect(findTimes("17:55, 6:05 PM, 3 pm, 18h00, noon").map((item) => item.time)).toEqual(["17:55", "18:05", "15:00", "18:00", "12:00"]);
  });
  it("reads references and names without inventing them", () => {
    expect(findReferences("Booking reference: RH-4821. Your booking is confirmed. Record locator QXKZMV").map((item) => item.value)).toEqual(["RH-4821", "QXKZMV"]);
    expect(findReferences("Booking details below")).toEqual([]);
    expect(cleanName("RIVERA/ALEX MR")).toBe("Alex Rivera");
    expect(cleanName("Table for one")).toBeNull();
    expect(splitNames("Alex Rivera and Sam Okafor")).toEqual(["Alex Rivera", "Sam Okafor"]);
  });
});

describe("deterministic extraction", () => {
  it("reads an overnight Denver to Lisbon flight and its return with zones from the airports", () => {
    const result = parse(fx.LISBON_FLIGHT);
    expect(result.bookings).toHaveLength(1);
    const [booking] = result.bookings;
    expect(booking.draft).toMatchObject({ kind: "flight", reference: "RA-7416", travelers: ["Alex Rivera"], status: "confirmed", providerCode: "RA", title: "Flight RA 204", provider: "Riverline Air" });
    expect(booking.draft.segments).toEqual([
      { number: "RA 204", originLabel: "Denver", originCode: "DEN", destinationLabel: "Lisbon", destinationCode: "LIS", startLocal: "2026-11-09T17:55", startZone: "America/Denver", endLocal: "2026-11-10T08:40", endZone: "Europe/Lisbon" },
      { number: "RA 205", originLabel: "Lisbon", originCode: "LIS", destinationLabel: "Denver", destinationCode: "DEN", startLocal: "2026-11-14T13:30", startZone: "Europe/Lisbon", endLocal: "2026-11-14T18:20", endZone: "America/Denver" },
    ]);
    expect(booking.missing).toEqual([]);
    for (const passage of booking.passages) expect(`Subject: ${fx.LISBON_FLIGHT.subject}\n\n${fx.LISBON_FLIGHT.text}`).toContain(passage);
  });
  it("reads a hotel stay with exclusive check-out, times and an address zone", () => {
    const [booking] = parse(fx.LISBON_HOTEL).bookings;
    expect(booking.draft).toMatchObject({ kind: "lodging", reference: "RH-4821", travelers: ["Alex Rivera"], title: "Riverside House", detail: "Deluxe double room" });
    expect(booking.draft.stay).toEqual({ propertyName: "Riverside House", address: "Rua da Prata 112, 1100-420 Lisbon, Portugal", checkInDate: "2026-11-10", checkOutDate: "2026-11-14", checkInTime: "14:00", checkOutTime: "11:00", zone: "Europe/Lisbon" });
    expect(booking.change).toBe(false);
    expect(booking.cancellation).toBe(false);
  });
  it("recognizes a revised confirmation as a change", () => {
    const [booking] = parse(fx.LISBON_HOTEL_REVISED).bookings;
    expect(booking.change).toBe(true);
    expect(booking.draft.stay?.checkInTime).toBe("16:00");
  });
  it("reads a restaurant reservation as a timed activity", () => {
    const [booking] = parse(fx.LISBON_DINNER).bookings;
    expect(booking.draft).toMatchObject({ kind: "activity", title: "Dinner at Mesa", reference: "MS-1834", detail: "Table for one", travelers: ["Alex Rivera"] });
    expect(booking.draft.segments?.[0]).toMatchObject({ startLocal: "2026-11-10T19:00", startZone: "Europe/Lisbon", address: "Rua dos Fanqueiros 41, Lisbon" });
  });
  it("reads a forwarded car rental with two drivers and the original provider", () => {
    const result = parse(fx.LISBON_CAR_FORWARDED);
    expect(result.forwarded).toBe(true);
    const [booking] = result.bookings;
    expect(booking.draft).toMatchObject({ kind: "car", reference: "CR-55210", travelers: ["Alex Rivera", "Sam Okafor"], provider: "Coastal Car Rental", detail: "Compact, manual" });
    expect(booking.draft.segments?.[0]).toMatchObject({ startLocal: "2026-11-12T09:00", startZone: "Europe/Lisbon", endLocal: "2026-11-13T18:00", originCode: "LIS" });
  });
  it("reads a train with station zones", () => {
    const [booking] = parse(fx.PORTLAND_TRAIN).bookings;
    expect(booking.draft).toMatchObject({ kind: "train", reference: "CL8842", title: "Train Coast Line 11" });
    expect(booking.draft.segments?.[0]).toMatchObject({ number: "Coast Line 11", startLocal: "2026-12-04T08:20", startZone: "America/Los_Angeles", endLocal: "2026-12-04T11:55", endZone: "America/Los_Angeles" });
  });
  it("flags a pasted date that can be read two ways", () => {
    const result = parseConfirmation({ text: fx.SINTRA_TICKETS_PASTED, receivedAt: "2026-10-15T00:00:00Z" });
    const [booking] = result.bookings;
    expect(booking.draft.kind).toBe("activity");
    expect(booking.ambiguous[0].reason).toContain("could be November 12 or December 11");
  });
  it("reads a cancellation that states only the reference and never treats a cancellation policy as one", () => {
    const canceled = parseConfirmation({ text: "Your stay at Riverside House has been cancelled.\nBooking reference: RH-4821", subject: "Cancellation confirmation", senderName: "Riverside House", receivedAt: "2026-10-20T00:00:00Z" });
    expect(canceled.bookings[0]).toMatchObject({ cancellation: true, draft: { kind: "lodging", reference: "RH-4821", status: "canceled" } });
    const unknownKind = parseConfirmation({ text: "Reservation RH-4821 has been cancelled.", subject: "Cancelled", senderName: "Riverside House" });
    expect(unknownKind.bookings[0]).toMatchObject({ cancellation: true, kindGuessed: true, draft: { reference: "RH-4821" } });
    expect(parse(fx.LISBON_HOTEL).bookings[0].cancellation).toBe(false);
  });
  it("finds nothing in ordinary mail and says why", () => {
    const result = parseConfirmation({ text: "Hi, are we still on for lunch next week?", subject: "Catching up" });
    expect(result.bookings).toEqual([]);
    expect(result.travelLike).toBe(false);
  });

  it("reads HTML confirmations laid out as table rows or stacked labels", () => {
    const table = htmlToText(`<html><body><h1>Riverline Air</h1><p>Confirmation number: RA-7416</p><table>
      <tr><td>Passenger</td><td>RIVERA/ALEX MR</td></tr>
      <tr><td colspan="4">Flight RA 204</td></tr>
      <tr><td>Departure</td><td>Denver (DEN)</td><td>Mon, Nov 9, 2026</td><td>5:55 PM</td></tr>
      <tr><td>Arrival</td><td>Lisbon (LIS)</td><td>Tue, Nov 10, 2026</td><td>8:40 AM</td></tr></table></body></html>`);
    const [flight] = parseConfirmation({ text: table, subject: "Your booking", receivedAt: "2026-10-12T00:00:00Z" }).bookings;
    expect(flight.draft.segments?.[0]).toMatchObject({ number: "RA 204", startLocal: "2026-11-09T17:55", endLocal: "2026-11-10T08:40", startZone: "America/Denver", endZone: "Europe/Lisbon" });
    expect(flight.draft.travelers).toEqual(["Alex Rivera"]);
    const stacked = htmlToText(`<div><h2>Riverside House</h2><div>Booking reference</div><div>RH-4821</div><div>Check-in</div><div>Tuesday 10 November 2026, from 15:00</div><div>Check-out</div><div>Saturday 14 November 2026, until 11:00</div><div>Address</div><div>Rua da Prata 112, Lisbon</div></div>`);
    const [stay] = parseConfirmation({ text: stacked, subject: "Your stay at Riverside House is confirmed", receivedAt: "2026-10-12T00:00:00Z" }).bookings;
    expect(stay.draft.stay).toMatchObject({ propertyName: "Riverside House", checkInDate: "2026-11-10", checkInTime: "15:00", checkOutDate: "2026-11-14", checkOutTime: "11:00", zone: "Europe/Lisbon" });
    expect(stay.draft.reference).toBe("RH-4821");
  });

  it("uses a calendar invitation in the mail for zones, and suggests a booking from an invitation alone", () => {
    const invite = { method: "REQUEST", uid: "evt-1@riverline.example", summary: "Flight RA 204 to Lisbon", start: "2026-11-09T17:55:00[America/Denver]", end: "2026-11-10T08:40:00[Europe/Lisbon]", status: "CONFIRMED", sequence: 0 };
    const withText = parseConfirmation({ text: "Flight RA 204\nDeparture: Denver Mon, Nov 9, 2026 17:55\nArrival: Lisbon Tue, Nov 10, 2026 08:40\nConfirmation: RA-7416", subject: "Trip", receivedAt: "2026-10-12T00:00:00Z", invite });
    expect(withText.bookings[0].draft.segments?.[0]).toMatchObject({ startZone: "America/Denver", endZone: "Europe/Lisbon" });
    const alone = parseConfirmation({ text: "You have been invited.", subject: "Invitation: Flight RA 204 to Lisbon", receivedAt: "2026-10-12T00:00:00Z", invite });
    expect(alone.bookings[0]).toMatchObject({ method: "invite", draft: { kind: "flight", segments: [{ number: "RA 204", startLocal: "2026-11-09T17:55", startZone: "America/Denver", endLocal: "2026-11-10T08:40", endZone: "Europe/Lisbon" }] } });
    const utc = parseConfirmation({ text: "", subject: "Dinner reservation", invite: { ...invite, summary: "Dinner reservation at Mesa", start: "2026-11-10T19:00:00Z", end: null } });
    expect(utc.bookings[0].draft.segments?.[0]).toMatchObject({ startLocal: "2026-11-10T19:00", startZone: null, startOffset: 0 });
  });
});
