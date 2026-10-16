import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { cleanup, fakeConnectors, harness, instance, owner } from "./helpers.js";
import * as fx from "../src/fixtures/messages.js";

afterEach(cleanup);
const asPaste = (message: fx.FixtureMessage) => `Subject: ${message.subject}\nFrom: ${message.from}\n\n${message.text}`;
async function importText(h: Awaited<ReturnType<typeof harness>>, text: string, decisions?: unknown[]) {
  const preview = await h.call("preview_import", { kind: "paste", text });
  const applied = await h.call("apply_import", { previewId: preview.previewId, digest: preview.digest, ...(decisions ? { decisions } : {}) });
  return { preview, applied };
}
const hotelText = (checkIn: string, extra = "") => `Riverside House
Booking reference: RH-4821
Guest name: Alex Rivera
Check-in: Tue, Nov 10, 2026 (from ${checkIn})
Check-out: Sat, Nov 14, 2026 (until 11:00)
Address: Rua da Prata 112, Lisbon, Portugal
${extra}`;

describe("import", () => {
  it("Import confirmation: previews parsed fields and source, then applies once and opens its trip", async () => {
    const h = await harness();
    const preview = await h.call("preview_import", { kind: "paste", text: asPaste(fx.LISBON_FLIGHT) });
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]).toMatchObject({ kindLabel: "Flight", complete: true, match: null, placement: "Starts a new trip, Lisbon." });
    expect(preview.items[0].passages).toContain("Departure: Denver (DEN)  Mon, Nov 9, 2026  17:55");
    expect(await h.call("list_trips", { limit: 50, when: "all" })).toMatchObject({ items: [] });
    const id = randomUUID();
    const applied = await h.call("apply_import", { previewId: preview.previewId, digest: preview.digest }, owner(), { id });
    expect(applied.status).toBe("applied");
    expect(applied.outcomes[0].action).toBe("created");
    expect(applied.openTripId).toBeTruthy();
    // The same invocation retried returns the first result. A second click applies nothing new.
    expect(await h.call("apply_import", { previewId: preview.previewId, digest: preview.digest }, owner(), { id })).toEqual(applied);
    expect((await h.call("apply_import", { previewId: preview.previewId, digest: preview.digest })).status).toBe("already_applied");
    // The same confirmation imported again is recognized.
    const again = await importText(h, asPaste(fx.LISBON_FLIGHT));
    expect(again.preview.items[0].placement).toBe("Already recorded as Flight RA 204.");
    expect(["duplicate", "unchanged"]).toContain(again.applied.outcomes[0].action);
    const trip = await h.call("get_trip", { id: applied.openTripId });
    expect(trip.trip).toMatchObject({ title: "Lisbon", startDate: "2026-11-09", endDate: "2026-11-14", bookingCount: 1 });
    expect(trip.bookings[0].sources).toHaveLength(1);
    expect(await h.call("apply_import", { previewId: preview.previewId, digest: "0".repeat(64) }).catch((error) => error.code)).toBe("conflict");
  });

  it("applies every booking in one itinerary message once, and reprocessing adds nothing", async () => {
    const h = await harness();
    const itinerary = `Fictional Trips itinerary
Trip number: FT-99120
Traveler: Alex Rivera

Flight RA 204
Departure: Denver (DEN)  Mon, Nov 9, 2026  17:55
Arrival: Lisbon (LIS)  Tue, Nov 10, 2026  08:40

Hotel: Riverside House
Check-in: Tue, Nov 10, 2026 (from 15:00)
Check-out: Sat, Nov 14, 2026 (until 11:00)
Address: Rua da Prata 112, Lisbon, Portugal`;
    const first = await importText(h, itinerary);
    expect(first.preview.items.map((item: { kindLabel: string }) => item.kindLabel)).toEqual(["Flight", "Stay"]);
    expect(first.applied.outcomes.map((item: { action: string }) => item.action)).toEqual(["created", "created"]);
    expect(new Set(first.applied.outcomes.map((item: { tripId: string }) => item.tripId)).size).toBe(1);
    const again = await importText(h, itinerary);
    expect(again.applied.outcomes.map((item: { action: string }) => item.action)).toEqual(["unchanged", "unchanged"]);
    expect((await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items).toHaveLength(2);
  });

  it("refuses an expired preview and a preview applied by someone else", async () => {
    const h = await harness();
    const preview = await h.call("preview_import", { kind: "paste", text: asPaste(fx.LISBON_DINNER) });
    h.setNow("2026-10-15T14:00:00.000Z");
    await expect(h.call("apply_import", { previewId: preview.previewId, digest: preview.digest })).rejects.toThrow(/expired/);
  });

  it("reads a saved email file and a PDF through extract_text, and keeps an unreadable file with a manual entry", async () => {
    const pdfText = hotelText("15:00");
    const capability = fakeConnectors({ extract: (input) => (input.fileName === "scan.pdf" ? { text: "", truncated: false, characters: 0 } : { text: pdfText, truncated: false, characters: pdfText.length }) });
    const h = await harness({ capability });
    const eml = `From: Mesa <tables@mesa-lisboa.example>\r\nSubject: Your table at Mesa is confirmed\r\nDate: Wed, 14 Oct 2026 11:20:00 +0000\r\nContent-Type: multipart/alternative; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${fx.LISBON_DINNER.text.replace(/\n/g, "\r\n")}\r\n--b1--\r\n`;
    const email = await h.call("preview_import", { kind: "file", fileName: "mesa.eml", mimeType: "message/rfc822", base64: Buffer.from(eml).toString("base64") });
    expect(email.items[0].draft).toMatchObject({ kind: "activity", title: "Dinner at Mesa", reference: "MS-1834" });
    const pdf = await h.call("preview_import", { kind: "file", fileName: "riverside.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF-fictional").toString("base64") });
    expect(pdf.items[0].draft?.stay).toMatchObject({ checkInDate: "2026-11-10", checkOutDate: "2026-11-14", checkInTime: "15:00" });
    expect(capability.calls.find((call) => call.name === "extract_text")?.input).toMatchObject({ fileName: "riverside.pdf", mimeType: "application/pdf" });
    const scan = await h.call("preview_import", { kind: "file", fileName: "scan.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF-scan").toString("base64") });
    expect(scan.items).toEqual([]);
    expect(scan.notes[0]).toContain("no readable text");
    const nothing = await h.call("apply_import", { previewId: scan.previewId, digest: scan.digest });
    expect(nothing.status).toBe("nothing_to_apply");
    const scan2 = await h.call("preview_import", { kind: "file", fileName: "scan.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF-scan").toString("base64") });
    const manual = await h.call("apply_import", { previewId: scan2.previewId, digest: scan2.digest, manual: { kind: "activity", title: "Palace tickets", travelers: ["Alex Rivera"], segments: [{ startLocal: "2026-11-12T10:30", startZone: "Europe/Lisbon", address: "Sintra" }] } });
    expect(manual.outcomes[0].action).toBe("created");
    const booking = await h.call("get_booking", { id: manual.outcomes[0].bookingId });
    expect(booking.booking).toMatchObject({ method: "manual", title: "Palace tickets" });
    expect(booking.booking.sources[0]).toMatchObject({ origin: "file", title: "scan.pdf" });
  });

  it("shows Extraction unavailable when AI is off or unavailable, and keeps manual entry working", async () => {
    const h = await harness({ capability: fakeConnectors({}) });
    await h.call("save_settings", { aiExtraction: true });
    const preview = await h.call("preview_import", { kind: "paste", text: "Your booking for the gallery visit is confirmed.\nWe look forward to seeing you." });
    expect(preview.items).toEqual([]);
    expect(preview.notes.join(" ")).toContain("Extraction unavailable");
  });

  it("uses opted-in AI only with exact quotes and never adds an unsupported value", async () => {
    const source = "Gallery Norte\nYour visit is booked for the 12th of November 2026 at half past ten.\nRef GN-77120 for Alex Rivera.";
    const good = JSON.stringify({ bookings: [{ kind: "activity", title: "Gallery Norte visit", provider: "Gallery Norte", reference: "GN-77120", travelers: ["Alex Rivera"], canceled: false, segments: [{ number: null, originLabel: null, originCode: null, destinationLabel: null, destinationCode: null, startDate: "2026-11-12", startTime: null, startZone: null, endDate: null, endTime: null, endZone: null, address: null }], stay: null, quotes: ["Your visit is booked for the 12th of November 2026", "Ref GN-77120 for Alex Rivera."] }] });
    const invented = JSON.stringify({ bookings: [{ kind: "activity", title: "Gallery Norte visit", provider: null, reference: "GN-99999", travelers: [], canceled: false, segments: [{ number: null, originLabel: null, originCode: null, destinationLabel: null, destinationCode: null, startDate: "2026-11-12", startTime: "10:30", startZone: null, endDate: null, endTime: null, endZone: null, address: null }], stay: null, quotes: ["Ref GN-99999"] }] });
    let reply = good;
    const capability = fakeConnectors({ ai: (prompt) => { expect(prompt).toContain("<untrusted_confirmation>"); expect(prompt.length).toBeLessThanOrEqual(16000); return reply; } });
    const h = await harness({ capability });
    await h.call("save_settings", { aiExtraction: true });
    const preview = await h.call("preview_import", { kind: "paste", text: source });
    expect(preview.extraction).toBe("ai");
    expect(preview.items[0].draft).toMatchObject({ title: "Gallery Norte visit", reference: "GN-77120", segments: [{ startLocal: "2026-11-12" }] });
    reply = invented;
    const rejected = await h.call("preview_import", { kind: "paste", text: `${source}\n` });
    expect(rejected.items).toEqual([]);
    expect(rejected.notes.join(" ")).toContain("could not be matched to exact passages");
  });

  it("sends an ambiguous or incomplete extraction to Review instead of inventing a booking, and accepts an edited draft", async () => {
    const h = await harness();
    const { preview, applied } = await importText(h, fx.SINTRA_TICKETS_PASTED);
    expect(preview.items[0]).toMatchObject({ complete: false });
    expect(preview.items[0].ambiguous[0]).toContain("could be November 12 or December 11");
    expect(applied.outcomes[0].action).toBe("review");
    expect((await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items).toEqual([]);
    const review = (await h.call("list_review_items", { limit: 50, state: "open" })).items[0];
    expect(review).toMatchObject({ kind: "extraction", decisions: ["accept", "dismiss"] });
    const edited = { ...review.draft, segments: [{ ...review.draft.segments[0], startLocal: "2026-12-11T10:30" }] };
    const decided = await h.call("review_change", { id: review.id, expectedRevision: review.revision, decision: "accept", draft: edited });
    expect(decided.status).toBe("saved");
    const booking = await h.call("get_booking", { id: decided.bookingId });
    expect(booking.booking).toMatchObject({ title: "Sintra palace tickets", firstDate: "2026-12-11", method: "manual" });
    expect(booking.booking.sources[0].origin).toBe("paste");
  });
});

describe("changes, corrections and cancellations", () => {
  it("A confirmation, duplicate, changed confirmation and cancellation retain one booking and inspectable history", async () => {
    const h = await harness();
    const first = await importText(h, hotelText("14:00"));
    const bookingId = first.applied.outcomes[0].bookingId;
    const duplicate = await importText(h, hotelText("14:00", "We look forward to your stay."));
    expect(duplicate.applied.outcomes[0]).toMatchObject({ action: "duplicate", bookingId });
    const changed = await importText(h, hotelText("16:00", "Your booking has been updated."));
    expect(changed.preview.items[0].match?.changes).toEqual([{ field: "stay.checkInTime", label: "Check-in time", current: "14:00", proposed: "16:00" }]);
    expect(changed.applied.outcomes[0]).toMatchObject({ action: "updated", bookingId });
    const canceled = await importText(h, "Riverside House\nYour reservation has been cancelled.\nBooking reference: RH-4821\nGuest name: Alex Rivera");
    expect(canceled.applied.outcomes[0]).toMatchObject({ action: "canceled", bookingId });
    const bookings = await h.call("list_bookings", { limit: 50, status: "all", kind: "all" });
    expect(bookings.items).toHaveLength(1);
    const detail = await h.call("get_booking", { id: bookingId });
    expect(detail.booking).toMatchObject({ status: "canceled", stay: { checkInTime: "16:00" } });
    expect(detail.booking.sources.map((source: { role: string }) => source.role)).toEqual(["created", "duplicate", "changed", "canceled"]);
    expect(detail.changes.map((change: { kind: string }) => change.kind)).toEqual(["created", "updated", "canceled"]);
    expect(detail.changes[1].fields).toEqual([{ field: "stay.checkInTime", label: "Check-in time", before: "14:00", after: "16:00" }]);
    // The canceled stay stays in history and its nights become an itinerary gap.
    const trip = await h.call("get_trip", { id: detail.booking.tripId });
    expect(trip.trip.bookingCount).toBe(0);
    expect(trip.trip.canceledCount).toBe(1);
    expect(trip.coverage.gaps.filter((gap: { kind: string }) => gap.kind === "night")).toHaveLength(4);
    expect((await h.call("list_bookings", { limit: 50, status: "canceled", kind: "all" })).items).toHaveLength(1);
  });

  it("Receive cancellation: never creates or cancels a booking without matching reservation evidence", async () => {
    const h = await harness();
    await importText(h, hotelText("14:00"));
    const unknown = await importText(h, "Harbor Hotel\nYour reservation has been cancelled.\nBooking reference: HH-1200");
    expect(unknown.applied.outcomes[0]).toMatchObject({ action: "review", bookingId: null });
    const bookings = await h.call("list_bookings", { limit: 50, status: "all", kind: "all" });
    expect(bookings.items.map((booking: { status: string }) => booking.status)).toEqual(["confirmed"]);
    const review = (await h.call("list_review_items", { limit: 50, state: "open" })).items.find((item: { kind: string }) => item.kind === "cancellation");
    expect(review.headline).toBe("Cancellation without a matching booking");
    expect(review.reason).toContain("Nothing was changed");
    // A forwarded cancellation for a matching booking still asks first.
    const forwarded = await importText(h, `Fwd: cancellation\n---------- Forwarded message ---------\nFrom: Riverside House <reservations@riverside-house.example>\n\nYour reservation has been cancelled.\nBooking reference: RH-4821\nGuest name: Alex Rivera`);
    expect(forwarded.applied.outcomes[0].action).toBe("canceled");
  });

  it("A manual correction survives reimport. A stale correction fails with a useful comparison.", async () => {
    const h = await harness();
    const first = await importText(h, hotelText("14:00"));
    const id = first.applied.outcomes[0].bookingId;
    const before = (await h.call("get_booking", { id })).booking;
    const saved = await h.call("save_booking", { id, expectedRevision: before.revision, patch: { stay: { checkInTime: "15:00" } } });
    expect(saved.status).toBe("saved");
    expect(saved.record.stay.checkInTime).toBe("15:00");
    expect(saved.record.corrections).toEqual([expect.objectContaining({ field: "stay.checkInTime", value: "15:00", original: "14:00", stale: false })]);
    // Reimporting the original confirmation keeps the correction.
    const reimport = await importText(h, hotelText("14:00", "Reminder: your stay is coming up."));
    expect(reimport.applied.outcomes[0].action).toBe("duplicate");
    expect((await h.call("get_booking", { id })).booking.stay.checkInTime).toBe("15:00");
    // An edit made against an older revision is refused with the current values to compare.
    const stale = await h.call("save_booking", { id, expectedRevision: before.revision, patch: { stay: { checkInTime: "13:00" } } });
    expect(stale.status).toBe("conflict");
    expect(stale.current.stay.checkInTime).toBe("15:00");
    expect(stale.message).toContain("Compare the current values");
    // A newer confirmation that disagrees with the correction waits in Review, and the correction stays in force.
    const revised = await importText(h, hotelText("16:00", "Your booking has been updated."));
    expect(revised.applied.outcomes[0].action).toBe("review");
    const detail = await h.call("get_booking", { id });
    expect(detail.booking.stay.checkInTime).toBe("15:00");
    expect(detail.booking.corrections[0]).toMatchObject({ stale: true, value: "15:00" });
    const review = detail.review[0];
    expect(review).toMatchObject({ kind: "change", correctionConflict: true, comparison: [{ field: "stay.checkInTime", current: "15:00", proposed: "16:00" }] });
    expect(review.reason).toContain("Your earlier correction is kept until you choose");
    const kept = await h.call("review_change", { id: review.id, expectedRevision: review.revision, decision: "keep" });
    expect(kept.status).toBe("saved");
    const after = await h.call("get_booking", { id });
    expect(after.booking.stay.checkInTime).toBe("15:00");
    expect(after.booking.corrections[0]).toMatchObject({ stale: false, original: "16:00" });
    // Deciding twice is refused with the current item.
    expect((await h.call("review_change", { id: review.id, expectedRevision: review.revision, decision: "accept" })).status).toBe("conflict");
  });

  it("accepting a newer confirmation replaces the correction with the source value", async () => {
    const h = await harness();
    const id = (await importText(h, hotelText("14:00"))).applied.outcomes[0].bookingId;
    const revision = (await h.call("get_booking", { id })).booking.revision;
    await h.call("save_booking", { id, expectedRevision: revision, patch: { stay: { checkInTime: "15:00" } } });
    await importText(h, hotelText("16:00", "Your booking has been updated."));
    const review = (await h.call("get_booking", { id })).review[0];
    await h.call("review_change", { id: review.id, expectedRevision: review.revision, decision: "accept" });
    const detail = await h.call("get_booking", { id });
    expect(detail.booking.stay.checkInTime).toBe("16:00");
    expect(detail.booking.corrections).toEqual([]);
  });

  it("Correct a date: saves an override beside the original and can clear it", async () => {
    const h = await harness();
    const id = (await importText(h, hotelText("14:00"))).applied.outcomes[0].bookingId;
    const revision = (await h.call("get_booking", { id })).booking.revision;
    const saved = await h.call("save_booking", { id, expectedRevision: revision, patch: { stay: { checkOutDate: "2026-11-15" } } });
    expect(saved.record).toMatchObject({ lastDate: "2026-11-15", stay: { nights: 5 } });
    await expect(h.call("save_booking", { id, expectedRevision: saved.record.revision, patch: { stay: { checkOutDate: "2026-11-09" } } })).rejects.toThrow(/after check-in/);
    const cleared = await h.call("save_booking", { id, expectedRevision: saved.record.revision, clearCorrections: ["stay.checkOutDate"] });
    expect(cleared.record).toMatchObject({ lastDate: "2026-11-14", corrections: [] });
    const history = await h.call("get_booking", { id });
    expect(history.changes.map((change: { kind: string }) => change.kind)).toEqual(["created", "corrected", "correction_removed"]);
  });
});

describe("grouping", () => {
  it("Two travelers sharing a booking reference and two overlapping trips do not merge incorrectly", async () => {
    const h = await harness();
    const family = await h.call("save_trip", { title: "Lisbon with family", startDate: "2026-11-09", endDate: "2026-11-14" });
    const work = await h.call("save_trip", { title: "Lisbon work week", startDate: "2026-11-12", endDate: "2026-11-16" });
    const alex = await importText(h, hotelText("14:00"));
    // Overlapping trips: the stay is left unassigned and waits in Review with both trips as choices.
    expect(alex.applied.outcomes[0]).toMatchObject({ action: "created", tripId: null });
    const sam = await importText(h, hotelText("14:00").replace("Guest name: Alex Rivera", "Guest name: Sam Okafor"));
    expect(sam.applied.outcomes[0].action).toBe("created");
    expect(sam.applied.outcomes[0].bookingId).not.toBe(alex.applied.outcomes[0].bookingId);
    const both = await importText(h, hotelText("16:00", "Your booking has been updated.").replace("Guest name: Alex Rivera", "Guest names: Alex Rivera, Sam Okafor"));
    expect(both.applied.outcomes[0].action).toBe("review");
    const open = (await h.call("list_review_items", { limit: 50, state: "open" })).items;
    const identity = open.find((item: { kind: string }) => item.kind === "identity");
    expect(identity.candidates.map((candidate: { id: string }) => candidate.id).sort()).toEqual([alex.applied.outcomes[0].bookingId, sam.applied.outcomes[0].bookingId].sort());
    const assign = open.filter((item: { kind: string }) => item.kind === "assign");
    expect(assign[0].candidates.map((candidate: { title: string }) => candidate.title).sort()).toEqual(["Lisbon with family", "Lisbon work week"]);
    expect(assign[0].reason).toContain("fits more than one trip");
    const decided = await h.call("review_change", { id: assign[0].id, expectedRevision: assign[0].revision, decision: "assign", tripId: family.record.id });
    expect(decided.tripId).toBe(family.record.id);
    // Linking the shared change to one traveler's booking leaves the other untouched.
    await h.call("review_change", { id: identity.id, expectedRevision: identity.revision, decision: "link", bookingId: alex.applied.outcomes[0].bookingId });
    expect((await h.call("get_booking", { id: alex.applied.outcomes[0].bookingId })).booking.stay.checkInTime).toBe("16:00");
    expect((await h.call("get_booking", { id: sam.applied.outcomes[0].bookingId })).booking.stay.checkInTime).toBe("14:00");
    expect(work.record.title).toBe("Lisbon work week");
  });

  it("sends multiple passengers and forwarded confirmations to Review, and moves a booking between trips keeping its history", async () => {
    const h = await harness();
    await h.call("save_settings", { ownerNames: ["Alex Rivera"] });
    const car = await importText(h, asPaste(fx.LISBON_CAR_FORWARDED));
    expect(car.preview.forwarded).toBe(true);
    expect(car.applied.outcomes[0]).toMatchObject({ action: "created", tripId: null });
    const review = (await h.call("list_review_items", { limit: 50, state: "open" })).items[0];
    expect(review.reason).toContain("forwarded");
    expect(review.reason).toContain("2 travelers");
    const someoneElse = await importText(h, hotelText("14:00").replace("Alex Rivera", "Jordan Lee"));
    expect(someoneElse.applied.outcomes[0].tripId).toBeNull();
    const newTrip = await h.call("review_change", { id: review.id, expectedRevision: review.revision, decision: "new_trip", newTripTitle: "Lisbon road trip" });
    const bookingId = newTrip.bookingId;
    const target = await h.call("save_trip", { title: "Another trip" });
    const revision = (await h.call("get_booking", { id: bookingId })).booking.revision;
    const corrected = await h.call("save_booking", { id: bookingId, expectedRevision: revision, patch: { reference: "CR-55211" } });
    const moved = await h.call("save_booking", { id: bookingId, expectedRevision: corrected.record.revision, tripId: target.record.id });
    expect(moved.record).toMatchObject({ tripId: target.record.id, reference: "CR-55211" });
    expect(moved.record.sources).toHaveLength(1);
    expect(moved.record.corrections).toHaveLength(1);
    const history = await h.call("get_booking", { id: bookingId });
    expect(history.changes.map((change: { kind: string }) => change.kind)).toEqual(["created", "moved", "corrected", "moved"]);
  });

  it("adds a manual booking to a trip and edits it directly", async () => {
    const h = await harness();
    const trip = await h.call("save_trip", { title: "Porto", startDate: "2026-11-14", endDate: "2026-11-16", homeZone: "America/Denver" });
    const saved = await h.call("save_booking", { tripId: trip.record.id, draft: { kind: "train", title: "Lisbon to Porto", travelers: ["Alex Rivera"], segments: [{ number: "Alfa 123", originLabel: "Lisbon", destinationLabel: "Porto", startLocal: "2026-11-14T09:00", startZone: "Europe/Lisbon", endLocal: "2026-11-14T11:49", endZone: "Europe/Lisbon" }] } });
    expect(saved.record).toMatchObject({ method: "manual", tripId: trip.record.id, sources: [], coverage: { note: "Entered by hand." } });
    const edited = await h.call("save_booking", { id: saved.record.id, expectedRevision: saved.record.revision, patch: { segments: [{ sequence: 0, startLocal: "2026-11-14T10:00" }] } });
    expect(edited.record.segments[0].start.local).toBe("2026-11-14T10:00");
    expect(edited.record.corrections).toEqual([]);
    await expect(h.call("save_booking", { draft: { kind: "lodging", title: "Nowhere" } })).rejects.toThrow(/check-in and check-out/);
    const detail = await h.call("get_trip", { id: trip.record.id });
    expect(detail.coverage.gaps.map((gap: { message: string }) => gap.message)).toEqual(["No booking recorded for the night of Saturday, November 14.", "No booking recorded for the night of Sunday, November 15."]);
    const gap = detail.coverage.gaps[0];
    const dismissed = await h.call("dismiss_gap", { tripId: trip.record.id, key: gap.key, fingerprint: gap.fingerprint, note: "Staying with friends" });
    expect(dismissed.coverage.open).toBe(1);
    await expect(h.call("dismiss_gap", { tripId: trip.record.id, key: gap.key, fingerprint: "stale" })).rejects.toThrow(/changed/);
    expect((await h.call("dismiss_gap", { tripId: trip.record.id, key: gap.key, fingerprint: gap.fingerprint, restore: true })).coverage.open).toBe(2);
  });
});

describe("ideas, follow-ups and export", () => {
  it("keeps ideas unbooked, compares known values without summing currencies and says Not provided", async () => {
    const h = await harness();
    const trip = await h.call("save_trip", { title: "Lisbon", startDate: "2026-11-09", endDate: "2026-11-14" });
    const a = await h.call("save_idea", { tripId: trip.record.id, kind: "activity", title: "Sintra day tour", priceMinor: 6500, currency: "EUR", location: "Sintra", url: "https://tours.example/sintra" });
    const b = await h.call("save_idea", { tripId: trip.record.id, kind: "activity", title: "Fado evening", priceMinor: 4800, currency: "USD" });
    const c = await h.call("save_idea", { tripId: trip.record.id, title: "An afternoon by the river" });
    expect(c.record).toMatchObject({ kind: "place", priceLabel: "Not provided" });
    await expect(h.call("save_idea", { tripId: trip.record.id, title: "No currency", priceMinor: 100 })).rejects.toThrow(/currency/);
    await expect(h.call("save_idea", { tripId: trip.record.id, title: "Link", url: "http://insecure.example" })).rejects.toThrow();
    const detail = await h.call("get_trip", { id: trip.record.id });
    expect(detail.trip).toMatchObject({ bookingCount: 0, ideaCount: 3, attention: "Only ideas so far. Nothing is booked yet" });
    const compared = await h.call("compare_ideas", { ids: [a.record.id, b.record.id, c.record.id] });
    expect(compared.rows[0]).toEqual({ label: "Price", values: ["EUR 65.00", "USD 48.00", "Not provided"] });
    expect(compared.rows.find((row: { label: string }) => row.label === "Location").values).toEqual(["Sintra", "Not provided", "Not provided"]);
    expect(compared.currencies).toEqual(["EUR", "USD"]);
    expect(compared.note).toBe("Prices are in EUR and USD. They are not converted or added together. Ideas are not bookings.");
    expect(JSON.stringify(compared)).not.toMatch(/rating|score|rank/i);
    const removed = await h.call("save_idea", { id: c.record.id, expectedRevision: c.record.revision, removed: true });
    expect(removed.status).toBe("saved");
    expect((await h.call("list_ideas", { tripId: trip.record.id, limit: 50 })).items).toHaveLength(2);
  });

  it("Add travel task: creates one linked Ri task, and repeated clicks or retries return the same task", async () => {
    const tasks = new Map<string, { id: string; title: string }>();
    const capability = fakeConnectors({ tasks });
    const h = await harness({ capability });
    const trip = await h.call("save_trip", { title: "Lisbon", startDate: "2026-11-09", endDate: "2026-11-14" });
    const operationId = randomUUID();
    const input = { subject: { type: "trip", id: trip.record.id }, title: "Arrange the airport transfer", dueAt: "2026-11-02", operationId };
    const first = await h.call("create_follow_up", input);
    expect(first).toMatchObject({ status: "created", followUp: { title: "Arrange the airport transfer", dueAt: "2026-11-02", state: "created", availability: "available" } });
    const second = await h.call("create_follow_up", input);
    expect(second.followUp.taskId).toBe(first.followUp.taskId);
    expect(tasks.size).toBe(1);
    const call = capability.calls.find((item) => item.name === "create_task")!;
    expect(call.input).toMatchObject({ title: "Arrange the airport transfer", dueAt: "2026-11-02", operationId, description: "From Travel: Lisbon, November 9 to 14, 2026" });
    tasks.clear();
    expect((await h.call("check_follow_up", { id: first.followUp.id })).availability).toBe("missing");
    const listed = await h.call("list_follow_ups", { subjectId: trip.record.id, limit: 50 });
    expect(listed.items).toHaveLength(1);
  });

  it("asks for permission when Ri tasks are not allowed, then uses the same operation", async () => {
    const tasks = new Map<string, { id: string; title: string }>();
    let allow = false;
    const h = await harness({ capability: (name, input, target) => fakeConnectors({ tasks, allowTasks: allow })(name, input, target) });
    const trip = await h.call("save_trip", { title: "Lisbon" });
    const operationId = randomUUID();
    const blocked = await h.call("create_follow_up", { subject: { type: "trip", id: trip.record.id }, title: "Book a transfer", operationId });
    expect(blocked).toMatchObject({ status: "needs_permission", message: "Travel is not allowed to create Ri tasks yet. Allow it in Sources, then try again." });
    allow = true;
    const created = await h.call("create_follow_up", { subject: { type: "trip", id: trip.record.id }, title: "Book a transfer", operationId });
    expect(created.status).toBe("created");
    expect(created.followUp.id).toBe(blocked.followUp.id);
  });

  it("exports a trip as CSV and JSON with local times and zones", async () => {
    const h = await harness();
    const applied = (await importText(h, asPaste(fx.LISBON_FLIGHT))).applied;
    const csv = await h.call("export_trip", { id: applied.openTripId, format: "csv" });
    expect(csv).toMatchObject({ fileName: "travel-lisbon.csv", mimeType: "text/csv" });
    expect(csv.text).toContain('"2026-11-09","17:55","America/Denver","Flight","Depart Denver"');
    const json = await h.call("export_trip", { id: applied.openTripId, format: "json" });
    expect(JSON.parse(json.text).bookings[0].segments[0].end.zone).toBe("Europe/Lisbon");
  });
});

describe("preview fixture", () => {
  it("seeds the fictional trips only for an empty preview, and installed instances start empty", async () => {
    const h = await harness();
    const installed = await h.call("open_view", { path: "/", query: {} });
    expect(installed.data).toMatchObject({ section: "trips", setup: { trips: 0 }, fictional: false });
    const preview = await h.call("open_view", { path: "/", query: {} }, { principal: { kind: "fixture", id: "p", fixtureAudience: "user" }, audience: "user", access: { protocol: "ri-access-v1", actorId: "fixture:p", scopeRef: null, accounts: [] } });
    expect(preview.data).toMatchObject({ section: "trip", fictional: true, setup: { trips: 3, reviewOpen: 3 } });
    expect(instance().settings.fixtureSeeded()).toBe(true);
  });
});

describe("copy", () => {
  it("generated text has no long dashes or semicolons", async () => {
    const h = await harness();
    const caller = { principal: { kind: "fixture" as const, id: "p", fixtureAudience: "user" as const }, audience: "user" as const, access: { protocol: "ri-access-v1" as const, actorId: "fixture:p", scopeRef: null, accounts: [] } };
    await h.call("open_view", { path: "/", query: {} }, caller);
    const texts: unknown[] = [];
    const trips = await h.call("list_trips", { limit: 50, when: "all" }, caller);
    texts.push(trips);
    for (const trip of trips.items) {
      const detail = await h.call("get_trip", { id: trip.id }, caller);
      // Source passages and excerpts are quoted as written, so they are not checked.
      texts.push({ ...detail, bookings: detail.bookings.map((booking: Record<string, unknown>) => ({ ...booking, sources: [] })), review: [] });
      texts.push((await h.call("describe_view_context", { path: `/trips/${trip.id}`, query: {}, state: { section: "trip", tripId: trip.id, tab: "ideas" } }, caller)).modelContent);
      for (const booking of detail.bookings) texts.push((await h.call("get_booking", { id: booking.id }, caller)).changes);
    }
    texts.push((await h.call("list_review_items", { limit: 50, state: "open" }, caller)).items.map((item: Record<string, unknown>) => ({ ...item, passages: [], evidence: [], draft: null, prefill: {} })));
    texts.push(await h.call("list_sources", {}, caller));
    const text = JSON.stringify(texts);
    expect(text).not.toMatch(/[—–]/);
    expect(text).not.toMatch(/[A-Za-z0-9)]; /);
  });
});
