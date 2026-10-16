import { describe, expect, it } from "vitest";
import { effectiveBooking, type BookingRow, type OverrideRow, type SegmentRow, type StayRow } from "../src/domain/booking.js";
import { describeEndpoint, resolveEndpoint } from "../src/domain/clock.js";
import { computeCoverage } from "../src/domain/coverage.js";
import { buildItinerary, compareBookings, dayZoneLine } from "../src/domain/itinerary.js";
import { datesCompatible, matchBookings, matchTrips, providerKey, travelerFit } from "../src/domain/match.js";
import { airport, cityZone, findCityZone } from "../src/domain/places.js";
import { tripState } from "../src/services/records.js";

let counter = 0;
const row = (input: Partial<BookingRow> & Pick<BookingRow, "kind" | "title">): BookingRow => ({
  id: input.id ?? `b${++counter}`, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", revision: 1, tripId: "trip", provider: null, providerCode: null, reference: null, detail: null,
  travelers: ["Alex Rivera"], status: "confirmed", notes: null, method: "deterministic", sourceKey: "account:a", sourceKeys: ["account:a"], fictional: true, ...input,
});
const segment = (input: Partial<SegmentRow> & Pick<SegmentRow, "startLocal">): SegmentRow => ({
  id: `s${++counter}`, sequence: 0, number: null, originLabel: null, originCode: null, destinationLabel: null, destinationCode: null, startZone: null, startOffset: null, endLocal: null, endZone: null, endOffset: null, address: null, endAddress: null, ...input,
});
const stay = (input: Partial<StayRow> & Pick<StayRow, "checkInDate" | "checkOutDate">): StayRow => ({ id: `st${++counter}`, propertyName: "Riverside House", address: "Rua da Prata 112, Lisbon", checkInTime: null, checkOutTime: null, zone: "Europe/Lisbon", ...input });
const flight = (id: string, number: string, from: string, startLocal: string, startZone: string | null, to: string, endLocal: string, endZone: string | null, extra: Partial<BookingRow> = {}) =>
  effectiveBooking(row({ id, kind: "flight", title: `Flight ${number}`, ...extra }), [segment({ number, originCode: from, destinationCode: to, startLocal, startZone, endLocal, endZone })], null, []);
const hotel = (id: string, checkInDate: string, checkOutDate: string, extra: Partial<BookingRow> = {}, stayExtra: Partial<StayRow> = {}) =>
  effectiveBooking(row({ id, kind: "lodging", title: stayExtra.propertyName ?? "Riverside House", ...extra }), [], stay({ checkInDate, checkOutDate, ...stayExtra }), []);
const train = (id: string, startLocal: string, endLocal: string, zone = "Europe/Lisbon") =>
  effectiveBooking(row({ id, kind: "train", title: "Night train" }), [segment({ number: "Lusitania 332", originLabel: "Lisbon", destinationLabel: "Madrid", startLocal, startZone: zone, endLocal, endZone: "Europe/Madrid" })], null, []);

describe("time and chronology", () => {
  it("An overnight Denver-to-Lisbon journey displays both local dates and sorts correctly", () => {
    const outbound = flight("out", "RA 204", "DEN", "2026-11-09T17:55", "America/Denver", "LIS", "2026-11-10T08:40", "Europe/Lisbon");
    const dinner = effectiveBooking(row({ id: "dinner", kind: "activity", title: "Dinner at Mesa" }), [segment({ startLocal: "2026-11-10T19:00", startZone: "Europe/Lisbon" })], null, []);
    const breakfast = effectiveBooking(row({ id: "breakfast", kind: "activity", title: "Breakfast" }), [segment({ startLocal: "2026-11-10T07:30", startZone: "Europe/Lisbon" })], null, []);
    const segmentOut = outbound.segments[0];
    expect(segmentOut.overnight).toBe(true);
    expect(segmentOut.start).toMatchObject({ date: "2026-11-09", time: "17:55", zoneLabel: "MST", instant: "2026-11-10T00:55:00.000Z" });
    expect(segmentOut.end).toMatchObject({ date: "2026-11-10", time: "08:40", zoneLabel: "WET", instant: "2026-11-10T08:40:00.000Z" });
    expect(describeEndpoint(segmentOut.start)).toBe("Nov 9, 17:55 MST");
    expect(describeEndpoint(segmentOut.end!)).toBe("Nov 10, 08:40 WET");
    const days = buildItinerary([dinner, outbound, breakfast]);
    expect(days.map((day) => day.date)).toEqual(["2026-11-09", "2026-11-10"]);
    expect(days[0].items.map((item) => [item.role, item.title, item.time, item.zoneLabel])).toEqual([["depart", "Depart Denver", "17:55", "MST"]]);
    expect(days[0].items[0].context).toBe("Overnight flight to Lisbon, arrives Nov 10, 08:40 WET");
    // The arrival at 08:40 WET sorts after a 07:30 breakfast in Lisbon and before dinner.
    expect(days[1].items.map((item) => item.title)).toEqual(["Breakfast", "Arrive in Lisbon", "Dinner at Mesa"]);
    expect(days[1].items[1].context).toBe("From Denver, overnight flight, departed Nov 9, 17:55 MST");
    expect(dayZoneLine(days[0])).toBe("Local times in Denver MST");
    expect(dayZoneLine(days[1])).toBe("Local times in Lisbon WET");
  });

  it("orders entries in different zones by instant within a local date, not by wall clock", () => {
    // Departs Lisbon 14:00 WET and lands in Madrid 16:30 CET, which is 15:30 UTC, before a 16:00 WET Lisbon entry.
    const hop = flight("hop", "TP 1018", "LIS", "2026-11-12T14:00", "Europe/Lisbon", "MAD", "2026-11-12T16:30", "Europe/Madrid");
    const tour = effectiveBooking(row({ id: "tour", kind: "activity", title: "Lisbon tour" }), [segment({ startLocal: "2026-11-12T16:00", startZone: "Europe/Lisbon" })], null, []);
    const [day] = buildItinerary([tour, hop]);
    expect(day.items.map((item) => item.title)).toEqual(["Lisbon to Madrid", "Lisbon tour"]);
    expect(day.items[0].subtitle).toBe("Flight TP 1018, arrives 16:30 CET");
    expect(compareBookings(hop, tour, null)).toBeLessThan(0);
  });

  it("A DST transition has explicit expected behavior: a skipped hour moves forward and a repeated hour uses the earlier one", () => {
    const gap = resolveEndpoint("2026-03-08T02:30", "America/Denver");
    expect(gap.resolution).toBe("gap");
    expect(gap.instant).toBe("2026-03-08T09:30:00.000Z");
    expect(gap.note).toBe("Clocks move forward on March 8, 2026, so 02:30 does not exist there. It is treated as 03:30 MDT. Check with the provider.");
    const repeated = resolveEndpoint("2026-11-01T01:30", "America/Denver");
    expect(repeated.resolution).toBe("ambiguous");
    expect(repeated.instant).toBe("2026-11-01T07:30:00.000Z");
    expect(repeated.zoneLabel).toBe("MDT");
    expect(repeated.note).toBe("01:30 happens twice on November 1, 2026 as clocks move back. The earlier one, MDT, is assumed.");
    const booking = flight("dst", "RA 9", "DEN", "2026-03-08T02:30", "America/Denver", "SEA", "2026-03-08T04:00", "America/Los_Angeles");
    expect(booking.timeNotes[0]).toContain("Clocks move forward");
  });

  it("A missing zone has explicit expected behavior: no instant, a plain note, local ordering and no overlap arithmetic", () => {
    const unknown = resolveEndpoint("2026-11-10T09:00", null);
    expect(unknown).toMatchObject({ instant: null, zoneLabel: null, resolution: "zone_missing" });
    expect(describeEndpoint(unknown)).toBe("Nov 10, 09:00 (zone not recorded)");
    const shuttle = effectiveBooking(row({ id: "shuttle", kind: "activity", title: "Airport shuttle" }), [segment({ startLocal: "2026-11-10T09:00", endLocal: "2026-11-10T10:00" })], null, []);
    const outbound = flight("out", "RA 204", "DEN", "2026-11-09T17:55", "America/Denver", "LIS", "2026-11-10T08:40", "Europe/Lisbon");
    const dinner = effectiveBooking(row({ id: "dinner", kind: "activity", title: "Dinner" }), [segment({ startLocal: "2026-11-10T19:00", startZone: "Europe/Lisbon" })], null, []);
    const [, day] = buildItinerary([dinner, shuttle, outbound]);
    // Placed by its local wall time in the day's zone, and marked as local order.
    expect(day.items.map((item) => [item.title, item.localOrder])).toEqual([["Arrive in Lisbon", false], ["Airport shuttle", true], ["Dinner", false]]);
    expect(day.zoneMissing).toBe(true);
    expect(dayZoneLine(day)).toBe("Local times in Lisbon WET. Some times have no recorded zone");
    const coverage = computeCoverage({ startDate: "2026-11-09", endDate: "2026-11-11", bookings: [outbound, shuttle], dismissals: [] });
    expect(coverage.gaps.filter((gap) => gap.kind === "overlap")).toEqual([]);
    expect(coverage.gaps.find((gap) => gap.kind === "zone_missing")?.message).toBe("Airport shuttle has a time without a recorded time zone, so overlaps with it cannot be checked precisely.");
  });

  it("uses a stated offset when a source gives one without a zone", () => {
    const endpoint = resolveEndpoint("2026-11-10T08:40", null, 0);
    expect(endpoint).toMatchObject({ instant: "2026-11-10T08:40:00.000Z", zoneLabel: "UTC", resolution: "offset" });
  });

  it("keeps date-only items as dates, never midnight timestamps", () => {
    const pass = effectiveBooking(row({ id: "pass", kind: "activity", title: "Museum pass" }), [segment({ startLocal: "2026-11-11", startZone: "Europe/Lisbon" })], null, []);
    expect(pass.segments[0]).toMatchObject({ dateOnly: true, start: { date: "2026-11-11", time: null, instant: null, resolution: "date_only" } });
    const [day] = buildItinerary([pass]);
    expect(day.items[0]).toMatchObject({ allDay: true, time: null, instant: null });
  });

  it("sorts identical times with a stable tie-breaker", () => {
    const a = effectiveBooking(row({ id: "a", kind: "activity", title: "A" }), [segment({ startLocal: "2026-11-10T10:00", startZone: "Europe/Lisbon" })], null, []);
    const b = effectiveBooking(row({ id: "b", kind: "activity", title: "B" }), [segment({ startLocal: "2026-11-10T10:00", startZone: "Europe/Lisbon" })], null, []);
    expect(buildItinerary([b, a])[0].items.map((item) => item.title)).toEqual(buildItinerary([a, b])[0].items.map((item) => item.title));
  });

  it("shows a hotel as a date span, not an hour block, with an exclusive check-out", () => {
    const stayBooking = hotel("h", "2026-11-10", "2026-11-14", {}, { checkInTime: "15:00", checkOutTime: "11:00" });
    expect(stayBooking.stay?.nights).toBe(4);
    const days = buildItinerary([stayBooking]);
    expect(days.map((day) => [day.date, day.items.map((item) => [item.role, item.subtitle])])).toEqual([
      ["2026-11-10", [["check_in", "Check in, 4 nights"]]],
      ["2026-11-11", [["staying", "Staying, night 2 of 4"]]],
      ["2026-11-12", [["staying", "Staying, night 3 of 4"]]],
      ["2026-11-13", [["staying", "Staying, night 4 of 4"]]],
      ["2026-11-14", [["check_out", "Check out"]]],
    ]);
    expect(days[1].items[0]).toMatchObject({ allDay: true, time: null });
  });

  it("applies corrections over source values and keeps the original", () => {
    const override: OverrideRow = { id: "o", field: "stay.checkInTime", value: "15:00", original: "14:00", actor: "owner-ui:owner", stale: false, createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z" };
    const booking = effectiveBooking(row({ id: "h", kind: "lodging", title: "Riverside House" }), [], stay({ checkInDate: "2026-11-10", checkOutDate: "2026-11-14", checkInTime: "14:00" }), [override]);
    expect(booking.stay?.checkInTime).toBe("15:00");
    expect(booking.corrections).toEqual([{ field: "stay.checkInTime", label: "Check-in time", value: "15:00", original: "14:00", stale: false, at: "2026-10-14T00:00:00.000Z" }]);
  });
});

describe("coverage and gaps", () => {
  it("Four hotel nights, one missing night and an intentional overnight train produce correct coverage with a durable dismissal", () => {
    // Trip November 9 to 15: nights 9 to 14. Hotel covers 9 to 12, nothing on 13, a night train on 14.
    const stayBooking = hotel("hotel", "2026-11-09", "2026-11-13");
    const nightTrain = train("train", "2026-11-14T22:10", "2026-11-15T08:40");
    const bookings = [stayBooking, nightTrain];
    const first = computeCoverage({ startDate: "2026-11-09", endDate: "2026-11-15", bookings, dismissals: [] });
    expect(first.nights.map((night) => [night.date, night.status, night.by.map((item) => item.how)])).toEqual([
      ["2026-11-09", "covered", ["lodging"]], ["2026-11-10", "covered", ["lodging"]], ["2026-11-11", "covered", ["lodging"]], ["2026-11-12", "covered", ["lodging"]],
      ["2026-11-13", "uncovered", []], ["2026-11-14", "covered", ["overnight"]],
    ]);
    const gap = first.gaps.find((item) => item.kind === "night")!;
    expect(gap.message).toBe("No booking recorded for the night of Friday, November 13.");
    expect(first.summary).toBe("1 night with no booking recorded");
    // Staying with friends: dismissed, and the dismissal holds on every later check.
    const dismissed = computeCoverage({ startDate: "2026-11-09", endDate: "2026-11-15", bookings, dismissals: [{ key: gap.key, fingerprint: gap.fingerprint, at: "2026-10-15T00:00:00.000Z" }] });
    expect(dismissed.nights[4].status).toBe("dismissed");
    expect(dismissed.open).toBe(0);
    expect(dismissed.summary).toBe("Every night has a booking recorded and no times overlap");
    // An unrelated change elsewhere keeps it dismissed. A change around that night brings it back.
    const dinner = effectiveBooking(row({ id: "dinner", kind: "activity", title: "Dinner" }), [segment({ startLocal: "2026-11-10T19:00", startZone: "Europe/Lisbon" })], null, []);
    expect(computeCoverage({ startDate: "2026-11-09", endDate: "2026-11-15", bookings: [...bookings, dinner], dismissals: [{ key: gap.key, fingerprint: gap.fingerprint, at: "x" }] }).open).toBe(0);
    const shorter = hotel("hotel", "2026-11-09", "2026-11-12");
    const changed = computeCoverage({ startDate: "2026-11-09", endDate: "2026-11-15", bookings: [shorter, nightTrain], dismissals: [{ key: gap.key, fingerprint: gap.fingerprint, at: "x" }] });
    expect(changed.gaps.filter((item) => item.kind === "night" && !item.dismissed).map((item) => item.date)).toEqual(["2026-11-12", "2026-11-13"]);
  });

  it("counts check-out as exclusive and an overnight flight as covering its night", () => {
    const outbound = flight("out", "RA 204", "DEN", "2026-11-09T17:55", "America/Denver", "LIS", "2026-11-10T08:40", "Europe/Lisbon");
    const coverage = computeCoverage({ startDate: "2026-11-09", endDate: "2026-11-14", bookings: [outbound, hotel("h", "2026-11-10", "2026-11-14")], dismissals: [] });
    expect(coverage.nights.map((night) => night.status)).toEqual(["covered", "covered", "covered", "covered", "covered"]);
    expect(coverage.nights[0].by[0]).toMatchObject({ how: "overnight", label: "Flight RA 204" });
  });

  it("leaves a canceled booking's nights uncovered so the gap shows", () => {
    const canceled = hotel("h", "2026-11-10", "2026-11-12", { status: "canceled" });
    const coverage = computeCoverage({ startDate: "2026-11-10", endDate: "2026-11-12", bookings: [canceled], dismissals: [] });
    expect(coverage.nights.map((night) => night.status)).toEqual(["uncovered", "uncovered"]);
  });

  it("finds overlapping timed bookings, treats a rental as pick-up and return only, and needs explicit trip dates for nights", () => {
    const outbound = flight("out", "RA 204", "DEN", "2026-11-09T17:55", "America/Denver", "LIS", "2026-11-10T08:40", "Europe/Lisbon");
    const call = effectiveBooking(row({ id: "call", kind: "activity", title: "Video call" }), [segment({ startLocal: "2026-11-10T07:00", startZone: "Europe/Lisbon", endLocal: "2026-11-10T08:00", endZone: "Europe/Lisbon" })], null, []);
    const car = effectiveBooking(row({ id: "car", kind: "car", title: "Car", provider: "Coastal Car Rental" }), [segment({ startLocal: "2026-11-10T09:00", startZone: "Europe/Lisbon", endLocal: "2026-11-13T18:00", endZone: "Europe/Lisbon" })], null, []);
    const dinner = effectiveBooking(row({ id: "dinner", kind: "activity", title: "Dinner" }), [segment({ startLocal: "2026-11-11T19:00", startZone: "Europe/Lisbon" })], null, []);
    const coverage = computeCoverage({ startDate: null, endDate: null, bookings: [outbound, call, car, dinner], dismissals: [] });
    expect(coverage.checked).toBe(false);
    expect(coverage.nights).toEqual([]);
    const overlaps = coverage.gaps.filter((gap) => gap.kind === "overlap");
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].message).toBe("Video call at Nov 10, 07:00 WET overlaps Flight RA 204 (Nov 9, 17:55 MST to Nov 10, 08:40 WET).");
    expect(coverage.summary).toBe("1 overlapping time");
  });
});

describe("places", () => {
  it("resolves airports and city names to zones and refuses ambiguous names", () => {
    expect(airport("lis")).toMatchObject({ city: "Lisbon", zone: "Europe/Lisbon" });
    expect(airport("XXX")).toBeNull();
    expect(cityZone("Lisboa")).toBe("Europe/Lisbon");
    expect(cityZone("Portland")).toBe("America/Los_Angeles");
    expect(cityZone("Kingston")).toBeNull();
    expect(findCityZone("Rua da Prata 112, 1100-420 Lisbon, Portugal")).toEqual({ city: "Lisbon", zone: "Europe/Lisbon" });
    expect(findCityZone("410 SW Alder Street, Portland, Oregon")?.zone).toBe("America/Los_Angeles");
    expect(findCityZone("Somewhere unknown")).toBeNull();
  });
});

describe("matching rules", () => {
  const recorded = (id: string, reference: string, travelers: string[], first = "2026-11-10", provider = "Riverside House") =>
    effectiveBooking(row({ id, kind: "lodging", title: provider, provider, reference, travelers }), [], stay({ checkInDate: first, checkOutDate: "2026-11-14" }), []);
  const draft = (reference: string | null, travelers: string[], checkIn = "2026-11-10", provider = "Riverside House", checkOut = "2026-11-14") => ({ kind: "lodging" as const, provider, reference, travelers, stay: { propertyName: provider, checkInDate: checkIn, checkOutDate: checkOut } });

  it("A booking reference alone is not a global ID: provider, travelers and dates must also fit", () => {
    const bookings = [recorded("a", "RH-4821", ["Alex Rivera"])];
    expect(matchBookings({ draft: draft("RH-4821", ["Alex Rivera"]), provider: null }, bookings).candidates.map((item) => item.id)).toEqual(["a"]);
    expect(matchBookings({ draft: draft("RH-4821", ["Alex Rivera"], "2026-11-10", "Harbor Hotel"), provider: null }, bookings).candidates).toEqual([]);
    // The same reference months later is a different reservation.
    expect(matchBookings({ draft: draft("RH-4821", ["Alex Rivera"], "2027-06-01", "Riverside House", "2027-06-04"), provider: null }, bookings).candidates).toEqual([]);
    expect(matchBookings({ draft: draft("RH-4821", ["Sam Okafor"]), provider: null }, bookings).candidates).toEqual([]);
    // Without a reference, only an identical stay is the same booking.
    expect(matchBookings({ draft: draft(null, ["Alex Rivera"]), provider: null }, bookings).candidates.map((item) => item.id)).toEqual(["a"]);
    expect(matchBookings({ draft: draft(null, ["Alex Rivera"], "2026-11-11"), provider: null }, bookings).candidates).toEqual([]);
  });

  it("Two travelers sharing a booking reference stay separate, and a message for both is ambiguous", () => {
    const bookings = [recorded("alex", "RH-4821", ["Alex Rivera"]), recorded("sam", "RH-4821", ["Sam Okafor"])];
    expect(matchBookings({ draft: draft("RH-4821", ["RIVERA/ALEX MR"]), provider: null }, bookings).candidates.map((item) => item.id)).toEqual(["alex"]);
    expect(matchBookings({ draft: draft("RH-4821", ["Alex Rivera", "Sam Okafor"]), provider: null }, bookings).candidates).toHaveLength(2);
  });

  it("compares names written differently and providers with common suffixes", () => {
    expect(travelerFit(["RIVERA/ALEX MR"], ["Alex Rivera"])).toBe("same");
    expect(travelerFit(["Alex Rivera", "Sam Okafor"], ["Alex Rivera"])).toBe("overlap");
    expect(travelerFit(["Sam Okafor"], ["Alex Rivera"])).toBe("different");
    expect(travelerFit(["Alex Rivera"], ["Alex Rivera"])).toBe("same");
    expect(travelerFit(["Alex J Rivera"], ["Alex Rivera"])).toBe("same");
    expect(travelerFit([], ["Alex Rivera"])).toBe("unknown");
    expect(providerKey("Riverline Air")).toBe(providerKey("RIVERLINE AIRLINES"));
    expect(datesCompatible({ first: "2026-11-10", last: "2026-11-14" }, { first: "2026-11-12", last: "2026-11-16" })).toBe(true);
    expect(datesCompatible({ first: "2026-11-10", last: "2026-11-14" }, { first: "2027-02-10", last: "2027-02-14" })).toBe(false);
  });

  it("joins a trip only when dates overlap or touch and travelers fit, and never picks between overlapping trips", () => {
    const trips = [
      { id: "lisbon", startDate: "2026-11-09", endDate: "2026-11-14", travelers: ["Alex Rivera"], destinations: ["Lisbon"], archived: false },
      { id: "work", startDate: "2026-11-12", endDate: "2026-11-16", travelers: ["Alex Rivera"], destinations: ["Lisbon"], archived: false },
      { id: "sam", startDate: "2026-11-01", endDate: "2026-11-30", travelers: ["Sam Okafor"], destinations: ["Porto"], archived: false },
    ];
    expect(matchTrips({ first: "2026-11-09", last: "2026-11-10", travelers: ["Alex Rivera"] }, trips).map((trip) => trip.id)).toEqual(["lisbon"]);
    expect(matchTrips({ first: "2026-11-13", last: "2026-11-13", travelers: ["Alex Rivera"] }, trips).map((trip) => trip.id)).toEqual(["lisbon", "work"]);
    expect(matchTrips({ first: "2026-11-15", last: "2026-11-15", travelers: ["Alex Rivera"] }, trips).map((trip) => trip.id)).toEqual(["lisbon", "work"]);
    expect(matchTrips({ first: "2026-12-01", last: "2026-12-02", travelers: ["Alex Rivera"] }, trips)).toEqual([]);
  });
});

describe("trip records", () => {
  it("derives planning, active, completed and archived states from inclusive trip dates", () => {
    expect(tripState({ archivedAt: null, startDate: "2026-11-09", endDate: "2026-11-14" }, "2026-10-15")).toBe("planning");
    expect(tripState({ archivedAt: null, startDate: "2026-11-09", endDate: "2026-11-14" }, "2026-11-14")).toBe("active");
    expect(tripState({ archivedAt: null, startDate: "2026-11-09", endDate: "2026-11-14" }, "2026-11-15")).toBe("completed");
    expect(tripState({ archivedAt: "2026-12-01T00:00:00Z", startDate: "2026-11-09", endDate: "2026-11-14" }, "2026-10-15")).toBe("archived");
    expect(tripState({ archivedAt: null, startDate: null, endDate: null }, "2026-10-15")).toBe("planning");
  });
});
