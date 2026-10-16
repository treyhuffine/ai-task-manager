import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { calendarGrant, cleanup, fakeConnectors, gmailAccount, harness, instance, job, mailGrant, owner, type FakeMail, type GmailAccount } from "./helpers.js";
import * as fx from "../src/fixtures/messages.js";
import { GMAIL_QUERY, headerRelevant } from "../src/services/sync.js";
import { openTravel } from "../src/services/core.js";

afterEach(cleanup);
const mail = (message: fx.FixtureMessage, extra: Partial<FakeMail> = {}): FakeMail => ({ id: message.id, subject: message.subject, from: message.from, receivedAt: message.receivedAt, text: message.text, ...extra });
const newsletter: FakeMail = { id: "news-1", subject: "Autumn deals for you", from: "Deals <offers@shop.example>", receivedAt: "2026-10-10T10:00:00Z", text: "Save on sweaters this week." };

async function run(h: Awaited<ReturnType<typeof harness>>, account: string, steps: number, caller = owner([mailGrant(account)])) {
  const results = [];
  for (let step = 0; step < steps; step++) results.push((await h.call("continue_import", { source: `account:${account}`, kind: "mail" }, caller)).step);
  return results;
}

describe("Gmail import", () => {
  it("targets travel confirmations and checks headers before reading new mail", () => {
    expect(GMAIL_QUERY).toContain("subject:confirmation");
    expect(GMAIL_QUERY).toContain("subject:itinerary");
    expect(GMAIL_QUERY).toContain("subject:reservation");
    expect(GMAIL_QUERY).toContain("subject:booking");
    expect(GMAIL_QUERY).toContain("from:airbnb");
    expect(GMAIL_QUERY).toContain("from:amtrak");
    expect(GMAIL_QUERY).toContain("-category:promotions");
    const headers = (subject: string, from = "x@example.test", labelIds = ["INBOX"], snippet = "") => ({ id: "m", threadId: "t", labelIds, subject, from: { name: null, address: from, normalized: from }, to: [], cc: [], snippet, listId: null });
    expect(headerRelevant(headers("Your booking is confirmed"))).toBe(true);
    expect(headerRelevant(headers("Lunch?"))).toBe(false);
    expect(headerRelevant(headers("Hello", "x@example.test", ["INBOX"], "Your confirmation number is AB123"))).toBe(true);
    expect(headerRelevant(headers("Your booking is confirmed", "x@example.test", ["CATEGORY_PROMOTIONS"]))).toBe(false);
  });

  it("imports two accounts separately, skips unrelated mail without keeping it, and makes duplicate delivery idempotent", async () => {
    const a = gmailAccount([mail(fx.LISBON_FLIGHT), newsletter, mail(fx.LISBON_HOTEL)]);
    const b = gmailAccount([mail(fx.PORTLAND_TRAIN)]);
    const capability = fakeConnectors({ gmail: { "acct-a": a, "acct-b": b } });
    const h = await harness({ capability });
    const both = owner([mailGrant("acct-a"), mailGrant("acct-b")]);
    await run(h, "acct-a", 4, both);
    await run(h, "acct-b", 4, both);
    const bookings = (await h.call("list_bookings", { limit: 50, status: "all", kind: "all" }, both)).items;
    expect(bookings.map((booking: { title: string }) => booking.title).sort()).toEqual(["Flight RA 204", "Riverside House", "Train Coast Line 11"]);
    expect(bookings.find((booking: { title: string }) => booking.title === "Train Coast Line 11").sources[0].sourceLabel).toContain("Email from Coast Line Rail");
    expect(instance().repo.evidenceByExternal("account:acct-a", "news-1")).toBeNull();
    expect(instance().mailIndex.counts("acct-a")).toEqual({ kept: 2, skipped: 1, removed: 0 });
    // The same messages delivered again through history are not read twice.
    const reads = () => capability.calls.filter((call) => call.name === "gmail.read_message").length;
    const before = reads();
    a.history.push([{ messagesAdded: [{ message: { id: fx.LISBON_HOTEL.id, threadId: "t" } }, { message: { id: fx.LISBON_FLIGHT.id } }] }]);
    await run(h, "acct-a", 1, both);
    expect(reads()).toBe(before);
    expect((await h.call("list_bookings", { limit: 50, status: "all", kind: "all" }, both)).items).toHaveLength(3);
    const sources = await h.call("list_sources", {}, both);
    const accountA = sources.accounts.find((item: { id: string }) => item.id === "mail:acct-a");
    expect(accountA).toMatchObject({ granted: true, automatic: false, status: "ready", records: 2, skipped: 1, historyDays: 90, coverage: { partial: false } });
    expect(accountA.label).toBe("acct-a@example.test");
    expect(accountA.firstDetected).toMatchObject({ title: "Lisbon", bookings: 2 });
  });

  it("A confirmation, duplicate, changed confirmation and cancellation from the provider retain one booking with history", async () => {
    const revised = mail(fx.LISBON_HOTEL_REVISED);
    const cancellation: FakeMail = { id: "hotel-cancel", subject: "Cancellation confirmation", from: fx.LISBON_HOTEL.from, receivedAt: "2026-10-20T09:00:00Z", text: "Your reservation has been cancelled.\nBooking reference: RH-4821\nGuest name: Alex Rivera" };
    const duplicate: FakeMail = { ...mail(fx.LISBON_HOTEL), id: "hotel-again", receivedAt: "2026-10-14T09:30:00Z" };
    const a = gmailAccount([mail(fx.LISBON_FLIGHT), mail(fx.LISBON_HOTEL), duplicate]);
    a.messages.set(revised.id, revised);
    a.messages.set(cancellation.id, cancellation);
    const h = await harness({ capability: fakeConnectors({ gmail: { "acct-a": a } }) });
    await run(h, "acct-a", 4);
    a.history.push([{ messagesAdded: [{ message: { id: revised.id } }] }]);
    await run(h, "acct-a", 1);
    a.history.push([{ messagesAdded: [{ message: { id: cancellation.id } }] }]);
    await run(h, "acct-a", 1);
    const hotels = (await h.call("list_bookings", { limit: 50, status: "all", kind: "lodging" })).items;
    expect(hotels).toHaveLength(1);
    const detail = await h.call("get_booking", { id: hotels[0].id });
    expect(detail.booking).toMatchObject({ status: "canceled", stay: { checkInTime: "16:00" } });
    expect(detail.booking.sources.map((source: { role: string }) => source.role)).toEqual(["created", "duplicate", "changed", "canceled"]);
    expect(detail.changes.map((change: { kind: string; actorLabel: string }) => [change.kind, change.actorLabel])).toEqual([["created", "Travel"], ["updated", "Travel"], ["canceled", "Travel"]]);
  });

  it("A source deleted upstream becomes Source unavailable and never a cancellation", async () => {
    const a = gmailAccount([mail(fx.LISBON_HOTEL)]);
    const h = await harness({ capability: fakeConnectors({ gmail: { "acct-a": a } }) });
    await run(h, "acct-a", 4);
    const [hotel] = (await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items;
    a.history.push([{ messagesDeleted: [{ message: { id: fx.LISBON_HOTEL.id } }] }]);
    const [step] = await run(h, "acct-a", 1);
    expect(step.removed).toBe(1);
    const detail = await h.call("get_booking", { id: hotel.id });
    expect(detail.booking.status).toBe("confirmed");
    expect(detail.booking.sources[0].availability).toBe("unavailable");
    expect(detail.booking.coverage).toMatchObject({ unavailable: 1, note: "Source unavailable. The original was deleted or moved to Trash. Details recorded earlier are kept." });
    expect(detail.changes.at(-1).kind).toBe("source_unavailable");
    const evidence = await h.call("get_evidence", { id: detail.booking.sources[0].evidenceId });
    expect(evidence.note).toContain("Source unavailable");
    expect(evidence.openUrl).toBeNull();
    // Restored from Trash: available again.
    a.history.push([{ labelsRemoved: [{ message: { id: fx.LISBON_HOTEL.id }, labelIds: ["TRASH"] }] }]);
    await run(h, "acct-a", 1);
    expect((await h.call("get_booking", { id: hotel.id })).booking.sources[0].availability).toBe("available");
  });

  it("A user correction survives re-ingestion", async () => {
    const a = gmailAccount([mail(fx.LISBON_HOTEL)]);
    const capability = fakeConnectors({ gmail: { "acct-a": a } });
    const h = await harness({ capability });
    await run(h, "acct-a", 4);
    const [hotel] = (await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items;
    await h.call("save_booking", { id: hotel.id, expectedRevision: hotel.revision, patch: { stay: { checkInTime: "15:00" } } });
    // History expires: a bounded rescan of the window re-reads nothing already seen and keeps the correction.
    a.expireHistory = true;
    const reads = capability.calls.filter((call) => call.name === "gmail.read_message").length;
    await run(h, "acct-a", 5);
    expect(capability.calls.filter((call) => call.name === "gmail.read_message").length).toBe(reads);
    expect((await h.call("get_booking", { id: hotel.id })).booking.stay.checkInTime).toBe("15:00");
    // A new copy of the same confirmation (another message) is a duplicate and keeps the correction.
    const copy = { ...mail(fx.LISBON_HOTEL), id: "hotel-copy" };
    a.messages.set(copy.id, copy);
    a.history.push([{ messagesAdded: [{ message: { id: copy.id } }] }]);
    await run(h, "acct-a", 1);
    const detail = await h.call("get_booking", { id: hotel.id });
    expect(detail.booking.stay.checkInTime).toBe("15:00");
    expect(detail.booking.corrections[0]).toMatchObject({ value: "15:00", original: "14:00", stale: false });
    expect(detail.review).toEqual([]);
  });

  it("recovers from an interrupted page without rereading committed messages", async () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({ ...mail(fx.LISBON_DINNER), id: `dinner-${index}`, text: fx.LISBON_DINNER.text.replace("MS-1834", `MS-18${String(index).padStart(2, "0")}`).replace("19:00", `${String(12 + (index % 10)).padStart(2, "0")}:00`) }));
    const a = gmailAccount(messages);
    a.failNextRead = "dinner-4";
    const capability = fakeConnectors({ gmail: { "acct-a": a } });
    const h = await harness({ capability });
    const steps = await run(h, "acct-a", 3);
    expect(steps[2].summary).toBe("The account was busy. Travel will try again shortly.");
    const sources = await h.call("list_sources", {}, owner([mailGrant("acct-a")]));
    expect(sources.accounts[0]).toMatchObject({ status: "error", error: "The account was busy. Travel will try again shortly." });
    expect(instance().mailIndex.counts("acct-a").kept).toBe(4);
    // Continue retries now, reading only what is left, at most ten bodies a step.
    await run(h, "acct-a", 4);
    const reads = capability.calls.filter((call) => call.name === "gmail.read_message").map((call) => call.input.messageId);
    expect(new Set(reads).size).toBe(12);
    expect(reads.filter((id) => id === "dinner-0")).toHaveLength(1);
    expect((await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items).toHaveLength(12);
  });

  it("keeps imported records readable when the account needs reconnecting, and resumes from its checkpoint", async () => {
    const a = gmailAccount([mail(fx.LISBON_FLIGHT), mail(fx.LISBON_HOTEL)], 1);
    const capability = fakeConnectors({ gmail: { "acct-a": a } });
    const h = await harness({ capability });
    await run(h, "acct-a", 3);
    expect((await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items).toHaveLength(1);
    a.revoked = true;
    const steps = await run(h, "acct-a", 2);
    expect(steps[0].summary).toBe("Reconnect this account in Ri to continue updates. Records already imported are kept.");
    const sources = await h.call("list_sources", {}, owner([mailGrant("acct-a")]));
    expect(sources.accounts[0].status).toBe("reconnect");
    expect((await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items).toHaveLength(1);
    // Disconnected in Ri: the account disappears from access. Records stay and Sources says so.
    const disconnected = await h.call("list_sources", {}, owner([]));
    expect(disconnected.accounts[0]).toMatchObject({ granted: false, status: "reconnect" });
    // Reconnected: Continue picks up at the second page, without reading the first again.
    a.revoked = false;
    await run(h, "acct-a", 3);
    expect((await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items).toHaveLength(2);
    expect(capability.calls.filter((call) => call.name === "gmail.read_message" && call.input.messageId === fx.LISBON_FLIGHT.id)).toHaveLength(1);
  });

  it("pauses an account so the schedule skips it, rotates fairly between accounts, and resumes", async () => {
    const a = gmailAccount([mail(fx.LISBON_FLIGHT)]);
    const b = gmailAccount([mail(fx.PORTLAND_TRAIN)]);
    const capability = fakeConnectors({ gmail: { "acct-a": a, "acct-b": b } });
    const h = await harness({ capability });
    const schedule = job(["acct-a", "acct-b"]);
    const sources: string[] = [];
    // Steps run minutes apart in Ri. A few milliseconds keep last-run times distinct here.
    for (let step = 0; step < 4; step++) { sources.push((await h.call("run_background_step", {}, schedule)).source); await new Promise((resolve) => setTimeout(resolve, 5)); }
    expect(sources.filter((item) => item === "account:acct-a")).toHaveLength(2);
    expect(sources.filter((item) => item === "account:acct-b")).toHaveLength(2);
    await h.call("pause_source", { account: "acct-a", paused: true });
    capability.calls.length = 0;
    for (let step = 0; step < 4; step++) await h.call("run_background_step", {}, schedule);
    expect(capability.calls.every((call) => call.account === "acct-b")).toBe(true);
    const listed = await h.call("list_sources", {}, owner([mailGrant("acct-a", true), mailGrant("acct-b", true)]));
    expect(listed.accounts.find((item: { account: string }) => item.account === "acct-a")).toMatchObject({ status: "paused", paused: true, automatic: true });
    expect((await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items.length).toBeGreaterThan(0);
    await h.call("pause_source", { account: "acct-a", paused: false });
    for (let step = 0; step < 6; step++) await h.call("run_background_step", {}, schedule);
    expect((await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items).toHaveLength(2);
  });

  it("widens the history window and resumes backfill for older mail only", async () => {
    const a = gmailAccount([mail(fx.LISBON_FLIGHT)]);
    const capability = fakeConnectors({ gmail: { "acct-a": a } });
    const h = await harness({ capability });
    await run(h, "acct-a", 4);
    await h.call("setup_source", { account: "acct-a", kind: "mail", historyDays: 365 });
    await run(h, "acct-a", 2);
    const searches = capability.calls.filter((call) => call.name === "gmail.search_messages");
    expect(searches).toHaveLength(2);
    expect(String(searches[1].input.query)).toContain(`after:${Math.floor((Date.parse("2026-10-15T12:00:00Z") - 365 * 864e5) / 1000)}`);
    expect((await h.call("list_sources", {}, owner([mailGrant("acct-a")]))).accounts[0].historyDays).toBe(365);
  });
});

describe("enrichment", () => {
  it("reads a booking attachment through extract_text when the body has no details", async () => {
    const pdfText = fx.LISBON_HOTEL.text;
    const withPdf: FakeMail = { id: "pdf-1", subject: "Your booking confirmation", from: "Riverside House <reservations@riverside-house.example>", receivedAt: "2026-10-14T09:12:00Z", text: "Thank you for your booking. Your confirmation is attached.", attachments: [{ attachmentId: "att-1", filename: "booking-confirmation.pdf", mimeType: "application/pdf", data: "%PDF-1.4 fictional" }] };
    const capability = fakeConnectors({ gmail: { "acct-a": gmailAccount([withPdf]) }, extract: () => ({ text: pdfText, truncated: false, characters: pdfText.length }) });
    const h = await harness({ capability });
    await run(h, "acct-a", 3);
    expect((await h.call("list_sources", {}, owner([mailGrant("acct-a")]))).accounts[0].pending).toBe(1);
    expect(capability.calls.some((call) => call.name === "gmail.get_attachment")).toBe(false);
    await run(h, "acct-a", 2);
    expect((await h.call("list_sources", {}, owner([mailGrant("acct-a")]))).accounts[0].pending).toBe(0);
    expect(capability.calls.find((call) => call.name === "gmail.get_attachment")?.input).toEqual({ messageId: "pdf-1", attachmentId: "att-1" });
    const extract = capability.calls.find((call) => call.name === "extract_text")!;
    expect(extract.input).toMatchObject({ fileName: "booking-confirmation.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF-1.4 fictional").toString("base64") });
    const bookings = (await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items;
    expect(bookings.map((booking: { title: string }) => booking.title)).toEqual(["Riverside House"]);
  });

  it("AI unavailable: a travel message waits with Extraction unavailable and never becomes a fabricated booking", async () => {
    const vague: FakeMail = { id: "vague-1", subject: "Your reservation details", from: "Casa Azul <hello@casa-azul.example>", receivedAt: "2026-10-14T09:12:00Z", text: "We are delighted to host you next month. Reservation 88231. See you soon." };
    const capability = fakeConnectors({ gmail: { "acct-a": gmailAccount([vague]) } });
    const h = await harness({ capability });
    await h.call("save_settings", { aiExtraction: true });
    await run(h, "acct-a", 6);
    expect(capability.calls.some((call) => call.name === "ai_text")).toBe(true);
    expect((await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items).toEqual([]);
    const evidence = instance().repo.evidenceByExternal("account:acct-a", "vague-1")!;
    expect(evidence.parseStatus).toBe("pending_ai");
    expect(evidence.parseNote).toBe("Extraction unavailable. The qualified AI harness is not available.");
  });

  it("with AI off, an unreadable travel message waits in Review for manual details", async () => {
    const vague: FakeMail = { id: "vague-2", subject: "Your reservation confirmation 88231", from: "Casa Azul <hello@casa-azul.example>", receivedAt: "2026-10-14T09:12:00Z", text: "We are delighted to host you next month. Reservation 88231." };
    const h = await harness({ capability: fakeConnectors({ gmail: { "acct-a": gmailAccount([vague]) } }) });
    await run(h, "acct-a", 4);
    const review = (await h.call("list_review_items", { limit: 50, state: "open" })).items;
    expect(review.map((item: { kind: string }) => item.kind)).toEqual(["unreadable"]);
    expect((await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items).toEqual([]);
  });
});

describe("calendar conflicts", () => {
  it("reads chosen calendars and shows events during the trip, events matching a booking and expired sync tokens", async () => {
    const events = [
      { id: "e1", summary: "Flight RA 204 to Lisbon", start: "2026-11-09T17:55:00-07:00", end: "2026-11-10T08:40:00Z", allDay: false, attendees: [], attendeesOmitted: false, cancelled: false },
      { id: "e2", summary: "Quarterly planning", start: "2026-11-11T09:00:00-07:00", end: "2026-11-11T10:30:00-07:00", allDay: false, attendees: [{ self: true, organizer: false, resource: false, optional: false, responseStatus: "accepted" }], attendeesOmitted: false, cancelled: false },
      { id: "e3", summary: "Declined lunch", start: "2026-11-12T12:00:00-07:00", end: "2026-11-12T13:00:00-07:00", allDay: false, attendees: [{ self: true, organizer: false, resource: false, optional: false, responseStatus: "declined" }], attendeesOmitted: false, cancelled: false },
      { id: "e4", summary: "Moved meeting", start: "2026-11-13T09:00:00-07:00", end: "2026-11-13T10:00:00-07:00", allDay: false, attendees: [], attendeesOmitted: false, cancelled: true },
      { id: "e5", summary: "Long weekend", start: "2026-11-13", end: "2026-11-14", allDay: true, attendees: [], attendeesOmitted: false, cancelled: false },
      { id: "e6", summary: "After the trip", start: "2026-11-20T09:00:00-07:00", end: "2026-11-20T10:00:00-07:00", allDay: false, attendees: [], attendeesOmitted: false, cancelled: false },
    ];
    const calendars = { "acct-a": { calendars: [{ id: "primary", summary: "Alex", primary: true }, { id: "work", summary: "Work" }], events, expireSync: true } };
    const capability = fakeConnectors({ gmail: { "acct-a": gmailAccount([mail(fx.LISBON_FLIGHT)]) }, calendars });
    const h = await harness({ capability });
    const caller = owner([mailGrant("acct-a"), calendarGrant("acct-a")]);
    await run(h, "acct-a", 4, caller);
    const trip = (await h.call("list_trips", { limit: 50, when: "all" }, caller)).items[0];
    expect((await h.call("get_trip", { id: trip.id }, caller)).calendar.status).toBe("not_connected");
    const listed = await h.call("list_calendars", { account: "acct-a" }, caller);
    expect(listed.calendars.map((item: { id: string }) => item.id)).toEqual(["primary", "work"]);
    await h.call("setup_source", { account: "acct-a", kind: "calendar", calendars: ["primary"] }, caller);
    await h.call("save_trip", { id: trip.id, expectedRevision: trip.revision, homeZone: "America/Denver" }, caller);
    await h.call("continue_import", { source: "account:acct-a", kind: "calendar" }, caller);
    const detail = await h.call("get_trip", { id: trip.id }, caller);
    expect(detail.calendar.status).toBe("ready");
    expect(detail.calendar.events.map((event: { summary: string; relation: string }) => [event.summary, event.relation])).toEqual([
      ["Flight RA 204 to Lisbon", "matches_booking"], ["Quarterly planning", "during_trip"], ["Long weekend", "during_trip"],
    ]);
    expect(detail.calendar.events[1].when).toBe("Wed, Nov 11, 09:00 MST");
    expect(detail.calendar.message).toBe("2 calendar events during this trip.");
    // An expired sync token restarts the window with a full read.
    await h.call("continue_import", { source: "account:acct-a", kind: "calendar" }, caller);
    await h.call("continue_import", { source: "account:acct-a", kind: "calendar" }, caller);
    const syncs = capability.calls.filter((call) => call.name === "google_calendar.sync_events");
    expect(syncs.map((call) => (call.input.syncToken ? "token" : "window"))).toEqual(["window", "token", "window"]);
  });
});

describe("lifecycle", () => {
  it("Delete imported data removes one account's records, keeps written notes and other sources, and pauses that account", async () => {
    const a = gmailAccount([mail(fx.LISBON_FLIGHT), mail(fx.LISBON_HOTEL)]);
    const b = gmailAccount([mail(fx.PORTLAND_TRAIN)]);
    const h = await harness({ capability: fakeConnectors({ gmail: { "acct-a": a, "acct-b": b } }) });
    const both = owner([mailGrant("acct-a"), mailGrant("acct-b")]);
    await run(h, "acct-a", 4, both);
    await run(h, "acct-b", 4, both);
    const hotel = (await h.call("list_bookings", { limit: 50, status: "all", kind: "lodging" }, both)).items[0];
    await h.call("save_booking", { id: hotel.id, expectedRevision: hotel.revision, notes: "Ask for a quiet room" }, both);
    const lisbonTrip = hotel.tripId;
    await h.call("save_idea", { tripId: lisbonTrip, title: "Fado evening" }, both);
    const scope = (await h.call("create_scope", { actorId: "chat:x", sources: ["account:acct-a", "manual"], operations: ["read"] }, both)).scopeRef;
    const deleted = await h.call("delete_source_data", { source: "account:acct-a" }, both);
    expect(deleted).toMatchObject({ status: "deleted", bookings: 2, evidence: 2, keptNotes: 1 });
    const bookings = (await h.call("list_bookings", { limit: 50, status: "all", kind: "all" }, both)).items;
    expect(bookings.map((booking: { title: string }) => booking.title)).toEqual(["Train Coast Line 11"]);
    const trip = await h.call("get_trip", { id: lisbonTrip }, both);
    expect(trip.trip.notes).toContain("Kept from Riverside House: Ask for a quiet room");
    expect(trip.ideaCount).toBe(1);
    expect(instance().mailIndex.counts("acct-a")).toEqual({ kept: 0, skipped: 0, removed: 0 });
    expect(instance().scopes.get(scope)!.sources).toEqual(["manual"]);
    const sources = await h.call("list_sources", {}, both);
    expect(sources.accounts.find((item: { account: string }) => item.account === "acct-a")).toMatchObject({ paused: true, records: 0 });
    await expect(h.call("delete_source_data", { source: "manual" }, both)).rejects.toThrow(/yours/);
  });

  it("A paused or disconnected app remains readable to its owner, and removing one instance's data does not affect another", async () => {
    const h = await harness({ capability: fakeConnectors({ gmail: { "acct-a": gmailAccount([mail(fx.LISBON_FLIGHT)]) } }) });
    await run(h, "acct-a", 4);
    await h.call("pause_source", { account: "acct-a", paused: true });
    expect((await h.call("list_trips", { limit: 50, when: "all" }, owner([]))).items).toHaveLength(1);
    // A second, separate instance (another app's data) is unaffected by removing this one.
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "ri-travel-other-"));
    try {
      const other = await openTravel(otherDir, randomUUID());
      other.repo.insertTrip({ title: "Kyoto", titleSource: "manual", destinations: ["Kyoto"], startDate: null, endDate: null, datesSource: "unset", homeZone: null, travelers: [], notes: null, sourceKey: "manual" });
      fs.rmSync(h.dir, { recursive: true, force: true });
      expect(other.repo.trips().map((trip) => trip.title)).toEqual(["Kyoto"]);
      other.close();
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });
});

describe("more Gmail cases", () => {
  it("Receive changed flight email: links the new source to the same booking and shows old and new times", async () => {
    const changed: FakeMail = { id: "flight-change", subject: "Schedule change for your Riverline Air booking", from: fx.LISBON_FLIGHT.from, receivedAt: "2026-10-20T10:00:00Z", text: fx.LISBON_FLIGHT.text.replace("Booking confirmed", "Your flight has been rescheduled.").replace("Mon, Nov 9, 2026  17:55", "Mon, Nov 9, 2026  18:40").replace("Tue, Nov 10, 2026  08:40", "Tue, Nov 10, 2026  09:25") };
    const a = gmailAccount([mail(fx.LISBON_FLIGHT)]);
    a.messages.set(changed.id, changed);
    const h = await harness({ capability: fakeConnectors({ gmail: { "acct-a": a } }) });
    await run(h, "acct-a", 4);
    a.history.push([{ messagesAdded: [{ message: { id: changed.id } }] }]);
    await run(h, "acct-a", 1);
    const [flight] = (await h.call("list_bookings", { limit: 50, status: "all", kind: "flight" })).items;
    const detail = await h.call("get_booking", { id: flight.id });
    expect(detail.booking.segments[0].start).toMatchObject({ local: "2026-11-09T18:40", zoneLabel: "MST" });
    expect(detail.booking.sources.map((source: { role: string }) => source.role)).toEqual(["created", "changed"]);
    const update = detail.changes.find((change: { kind: string }) => change.kind === "updated");
    expect(update.fields).toEqual([
      { field: "segments.0.startLocal", label: "Departure time", before: "2026-11-09 17:55", after: "2026-11-09 18:40" },
      { field: "segments.0.endLocal", label: "Arrival time", before: "2026-11-10 08:40", after: "2026-11-10 09:25" },
    ]);
    expect(update.source.title).toBe(changed.subject);
  });

  it("checks new mail headers before reading a body, and reads HTML-only confirmations", async () => {
    const html: FakeMail = { id: "html-1", subject: "Your table at Mesa is confirmed", from: fx.LISBON_DINNER.from, receivedAt: fx.LISBON_DINNER.receivedAt, html: `<html><body>${fx.LISBON_DINNER.text.split("\n").map((line) => `<p>${line}</p>`).join("")}</body></html>` };
    const lunch: FakeMail = { id: "lunch-1", subject: "Lunch on Friday?", from: "Jo Lee <jo@example.test>", receivedAt: "2026-10-16T09:00:00Z", text: "Are you free on Friday?" };
    const a = gmailAccount([]);
    a.messages.set(html.id, html);
    a.messages.set(lunch.id, lunch);
    const capability = fakeConnectors({ gmail: { "acct-a": a } });
    const h = await harness({ capability });
    await run(h, "acct-a", 4);
    a.history.push([{ messagesAdded: [{ message: { id: lunch.id } }, { message: { id: html.id } }] }]);
    await run(h, "acct-a", 1);
    const reads = capability.calls.filter((call) => call.name === "gmail.read_message").map((call) => call.input.messageId);
    const headers = capability.calls.filter((call) => call.name === "gmail.get_message").map((call) => call.input.messageId);
    expect(headers).toEqual(["lunch-1", "html-1"]);
    expect(reads).toEqual(["html-1"]);
    const [dinner] = (await h.call("list_bookings", { limit: 50, status: "all", kind: "all" })).items;
    expect(dinner).toMatchObject({ title: "Dinner at Mesa", reference: "MS-1834" });
    expect(instance().mailIndex.outcome("acct-a", "lunch-1")).toBe("skipped");
  });
});
