import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, type SqlDatabase } from "@ri/app-kit/data";
import { openAppDatabase } from "@ri/app-kit/sdk";
import { MIGRATIONS } from "../src/db/migrations.js";
import { MULTIPLE_TRIPS_REASON, POSSIBLE_DUPLICATE_REASON } from "../src/domain/model.js";
import { chat, cleanup, fakeConnectors, gmailAccount, harness, job, mailGrant, owner, type Caller, type FakeMail } from "./helpers.js";
import * as fx from "../src/fixtures/messages.js";

afterEach(cleanup);
const mail = (message: fx.FixtureMessage): FakeMail => ({ id: message.id, subject: message.subject, from: message.from, receivedAt: message.receivedAt, text: message.text });

/** Account A holds Lisbon mail, account B holds Portland mail, plus a manual idea and booking. */
async function world() {
  const gmail = { "acct-a": gmailAccount([mail(fx.LISBON_FLIGHT), mail(fx.LISBON_HOTEL)]), "acct-b": gmailAccount([mail(fx.PORTLAND_TRAIN), mail(fx.PORTLAND_HOTEL)]) };
  const capability = fakeConnectors({ gmail });
  const h = await harness({ capability });
  const ownerCaller = owner([mailGrant("acct-a"), mailGrant("acct-b")]);
  for (const account of ["acct-a", "acct-b"]) for (let step = 0; step < 4; step++) await h.call("continue_import", { source: `account:${account}`, kind: "mail" }, ownerCaller);
  const trips = (await h.call("list_trips", { limit: 50, when: "all" }, ownerCaller)).items;
  const lisbon = trips.find((trip: { title: string }) => trip.title === "Lisbon");
  const portland = trips.find((trip: { title: string }) => trip.title === "Portland");
  await h.call("save_trip", { id: lisbon.id, expectedRevision: lisbon.revision, notes: "Private note about Lisbon" }, ownerCaller);
  const idea = await h.call("save_idea", { tripId: lisbon.id, title: "Fado evening", priceMinor: 4800, currency: "USD" }, ownerCaller);
  const manual = await h.call("save_booking", { tripId: lisbon.id, draft: { kind: "activity", title: "Tile workshop", travelers: ["Alex Rivera"], segments: [{ startLocal: "2026-11-12T10:00", startZone: "Europe/Lisbon", address: "Rua da Madalena, Lisbon" }] } }, ownerCaller);
  const bookings = (await h.call("list_bookings", { limit: 50, status: "all", kind: "all" }, ownerCaller)).items;
  const scopeA = (await h.call("create_scope", { actorId: "chat:one", sources: ["account:acct-a"], operations: ["read"] }, ownerCaller)).scopeRef;
  const scopeB = (await h.call("create_scope", { actorId: "chat:two", sources: ["account:acct-b", "manual"], operations: ["read", "write"] }, ownerCaller)).scopeRef;
  return { h, ownerCaller, lisbon, portland, idea: idea.record, manual: manual.record, bookings, scopeA, scopeB, capability };
}

describe("app data scopes", () => {
  it("gives the owner everything and two chats only their own sources, with no leakage through lists, search, counts, context or details", async () => {
    const w = await world();
    const { h } = w;
    const one = chat("one", w.scopeA), two = chat("two", w.scopeB);
    const titles = (items: { title: string }[]) => items.map((item) => item.title).sort();
    expect(titles(w.bookings)).toEqual(["Alder Street Inn", "Flight RA 204", "Riverside House", "Tile workshop", "Train Coast Line 11"]);

    // Chat one: account A only.
    expect(titles((await h.call("list_trips", { limit: 50, when: "all" }, one)).items)).toEqual(["Lisbon"]);
    const oneTrip = await h.call("get_trip", { id: w.lisbon.id }, one);
    expect(oneTrip.trip).toMatchObject({ projection: "full", bookingCount: 2, ideaCount: 0, notes: "Private note about Lisbon" });
    expect(titles(oneTrip.bookings)).toEqual(["Flight RA 204", "Riverside House"]);
    expect(titles((await h.call("list_bookings", { limit: 50, status: "all", kind: "all" }, one)).items)).toEqual(["Flight RA 204", "Riverside House"]);
    expect((await h.call("list_bookings", { limit: 50, status: "all", kind: "all", query: "Portland" }, one)).items).toEqual([]);
    expect((await h.call("list_bookings", { limit: 50, status: "all", kind: "all", query: "workshop" }, one)).items).toEqual([]);
    expect((await h.call("list_ideas", { tripId: w.lisbon.id, limit: 50 }, one)).items).toEqual([]);
    await expect(h.call("get_trip", { id: w.portland.id }, one)).rejects.toMatchObject({ code: "not_found" });
    const hidden = w.bookings.find((booking: { title: string }) => booking.title === "Alder Street Inn");
    await expect(h.call("get_booking", { id: hidden.id }, one)).rejects.toMatchObject({ code: "not_found" });
    await expect(h.call("compare_ideas", { ids: [w.idea.id, w.idea.id] }, one)).rejects.toMatchObject({ code: "not_found" });

    // Chat two: account B and manual entries. The Lisbon trip came from account A, so it is projected from the manual booking only.
    const twoTrips = (await h.call("list_trips", { limit: 50, when: "all" }, two)).items;
    expect(twoTrips.map((trip: { id: string }) => trip.id).sort()).toEqual([w.lisbon.id, w.portland.id].sort());
    const projected = await h.call("get_trip", { id: w.lisbon.id }, two);
    expect(projected.trip).toMatchObject({ projection: "partial", bookingCount: 1, notes: null, ideaCount: 1 });
    // Named from the shared booking's own address, not from the account A trip.
    expect(projected.trip.title).toBe("Lisbon");
    expect(projected.trip.destinations).toEqual(["Lisbon"]);
    expect(titles(projected.bookings)).toEqual(["Tile workshop"]);
    expect(JSON.stringify(projected)).not.toContain("Riverside House");
    expect(JSON.stringify(projected)).not.toContain("RA 204");
    expect(JSON.stringify(projected)).not.toContain("Private note");

    // Context re-resolves selections under the caller's scope and cites only what it may see.
    const flight = w.bookings.find((booking: { title: string }) => booking.title === "Flight RA 204");
    const state = { section: "trip" as const, tripId: w.lisbon.id, selected: [{ type: "booking" as const, id: flight.id }, { type: "booking" as const, id: hidden.id }] };
    const contextOne = await h.call("describe_view_context", { path: `/trips/${w.lisbon.id}`, query: {}, state }, one);
    expect(contextOne.modelContent).toContain(`[booking ${flight.id}, revision`);
    expect(contextOne.modelContent).toContain("1 selected record is not available to this chat.");
    expect(contextOne.modelContent).not.toContain("Alder Street");
    expect(contextOne.modelContent).not.toContain("Tile workshop");
    expect(contextOne.recordRefs.map((ref: { recordId: string }) => ref.recordId)).not.toContain(hidden.id);
    expect(Buffer.byteLength(contextOne.modelContent)).toBeLessThanOrEqual(16384);
    const contextTwo = await h.call("describe_view_context", { path: `/trips/${w.lisbon.id}`, query: {}, state }, two);
    expect(contextTwo.modelContent).not.toContain("RA 204");
    expect(contextTwo.modelContent).not.toContain("Private note");
    expect(contextTwo.modelContent).toContain("1 selected record is not available to this chat.");
    expect(contextTwo.modelContent).toContain("Alder Street Inn");
    const ownerContext = await h.call("describe_view_context", { path: `/trips/${w.lisbon.id}`, query: {}, state }, w.ownerCaller);
    expect(ownerContext.modelContent).toContain("Tile workshop");
    expect(ownerContext.dataRevision).not.toBe(contextOne.dataRevision);

    // Owner-only management and exports are not available to chats.
    await expect(h.call("export_trip", { id: w.lisbon.id, format: "json" }, one)).rejects.toMatchObject({ code: "forbidden" });
    await expect(h.call("list_sources", {}, one)).rejects.toMatchObject({ code: "forbidden" });
    await expect(h.call("review_change", { id: "x", expectedRevision: 1, decision: "dismiss" }, two)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("enforces read-only scopes, allows writes inside a write scope and keeps a narrower chat's revision stable", async () => {
    const w = await world();
    const { h } = w;
    const one = chat("one", w.scopeA), two = chat("two", w.scopeB);
    const flight = w.bookings.find((booking: { title: string }) => booking.title === "Flight RA 204");
    await expect(h.call("save_booking", { id: flight.id, expectedRevision: flight.revision, notes: "x" }, one)).rejects.toThrow(/may read but not change/);
    const idea = await h.call("save_idea", { tripId: w.lisbon.id, title: "Chat idea" }, two).catch((error) => error);
    // The Lisbon trip itself came from account A, which chat two cannot change.
    expect(idea.code).toBe("forbidden");
    const ok = await h.call("save_idea", { tripId: w.portland.id, title: "Powell's Books" }, two);
    expect(ok.status).toBe("saved");
    await expect(h.call("save_booking", { id: flight.id, expectedRevision: flight.revision, notes: "x" }, two)).rejects.toMatchObject({ code: "not_found" });
    const before = (await h.call("list_trips", { limit: 50, when: "all" }, one)).revision;
    await h.call("save_idea", { tripId: w.portland.id, title: "Another idea" }, two);
    expect((await h.call("list_trips", { limit: 50, when: "all" }, one)).revision).toBe(before);
  });

  it("denies a revoked scope, a chat with no scope and a scope made for another chat", async () => {
    const w = await world();
    const { h } = w;
    await expect(h.call("list_trips", { limit: 50, when: "all" }, chat("three", null))).rejects.toMatchObject({ code: "forbidden" });
    await expect(h.call("list_trips", { limit: 50, when: "all" }, chat("three", w.scopeA))).rejects.toMatchObject({ code: "forbidden" });
    await expect(h.call("describe_view_context", { path: "/", query: {} }, chat("three", null))).rejects.toMatchObject({ code: "forbidden" });
    await h.call("revoke_scope", { scopeRef: w.scopeA }, w.ownerCaller);
    await expect(h.call("list_trips", { limit: 50, when: "all" }, chat("one", w.scopeA))).rejects.toMatchObject({ code: "revoked" });
    const scopes = await h.call("list_scopes", {}, w.ownerCaller);
    expect(scopes.items.find((item: { id: string }) => item.id === w.scopeA).revoked).toBe(true);
    await expect(h.call("create_scope", { actorId: "chat:x", sources: ["account:unknown"], operations: ["read"] }, w.ownerCaller)).rejects.toThrow(/Choose sources/);
    await expect(h.call("create_scope", { actorId: "owner-ui:owner", sources: ["manual"], operations: ["read"] }, w.ownerCaller)).rejects.toThrow();
  });

  it("limits a job to its own automatic accounts", async () => {
    const gmail = { "acct-a": gmailAccount([mail(fx.LISBON_FLIGHT)]), "acct-b": gmailAccount([mail(fx.PORTLAND_TRAIN)]) };
    const capability = fakeConnectors({ gmail });
    const h = await harness({ capability });
    for (let step = 0; step < 4; step++) await h.call("run_background_step", {}, job(["acct-a"]));
    expect(capability.calls.length).toBeGreaterThan(0);
    expect(capability.calls.every((call) => call.account === "acct-a")).toBe(true);
    const trips = await h.call("list_trips", { limit: 50, when: "all" }, owner());
    expect(trips.items.map((trip: { title: string }) => trip.title)).toEqual(["Lisbon"]);
    // A job reads no records: its grant covers its account's ingestion only.
    await expect(h.call("list_trips", { limit: 50, when: "all" }, job(["acct-a"]))).rejects.toMatchObject({ code: "forbidden" });
  });

  it("opens the access view with the host-bound actor and lists shareable sources", async () => {
    const w = await world();
    const opened = await w.h.call("open_view", { path: "/access", query: { hostActor: "chat:new" } }, w.ownerCaller);
    expect(opened.scope).toEqual({ actions: ["create_scope"], bindings: { actorId: "chat:new" } });
    expect(opened.data.section).toBe("access");
    expect(opened.data.access.sources.map((source: { key: string }) => source.key).sort()).toEqual(["account:acct-a", "account:acct-b", "imports", "manual"]);
    const chatView = await w.h.call("open_view", { path: "/access", query: { hostActor: "chat:new" } }, chat("one", w.scopeA));
    expect(chatView.data.section).toBe("sources");
    expect(chatView.data.access).toBeNull();
  });
});

describe("Ask Ri and What is missing", () => {
  it("Ask Ri cites the selected booking, stages text without sending, and cannot resolve another account's reservation", async () => {
    const w = await world();
    const one = chat("one", w.scopeA);
    const hotel = w.bookings.find((booking: { title: string }) => booking.title === "Riverside House");
    const other = w.bookings.find((booking: { title: string }) => booking.title === "Train Coast Line 11");
    const context = await w.h.call("describe_view_context", { path: `/trips/${w.lisbon.id}`, query: {}, state: { section: "trip", tripId: w.lisbon.id, selected: [{ type: "booking", id: hotel.id }, { type: "booking", id: other.id }], revisions: { [hotel.id]: hotel.revision } } }, one);
    expect(context.modelContent).toContain(`[booking ${hotel.id}, revision ${hotel.revision}] Riverside House (lodging, confirmed)`);
    expect(context.modelContent).toContain("Confirmation RH-4821");
    expect(context.modelContent).toContain("Source: confirmation email");
    expect(context.modelContent).not.toContain("Coast Line");
    expect(context.modelContent).toContain("1 selected record is not available to this chat.");
    expect(context.recordRefs.map((ref: { recordId: string }) => ref.recordId)).toContain(hotel.id);
    // No action stages or sends chat text. Staging is a host intent from the view, covered by the packaged view test.
    const { definition } = await import("../src/actions.js");
    expect(definition.actions.some((action) => /send|message|email/.test(action.name))).toBe(false);
  });

  it("What is missing?: context describes absent lodging as No booking recorded and conflicting times", async () => {
    const w = await world();
    // The trip runs to December 7, but the hotel checks out on the 6th.
    await w.h.call("save_trip", { id: w.portland.id, expectedRevision: w.portland.revision, startDate: "2026-12-04", endDate: "2026-12-07" }, w.ownerCaller);
    const context = await w.h.call("describe_view_context", { path: `/trips/${w.portland.id}`, query: {}, state: { section: "trip", tripId: w.portland.id } }, w.ownerCaller);
    expect(context.modelContent).toContain("Coverage: 1 night with no booking recorded.");
    expect(context.modelContent).toContain("No booking recorded for the night of Sunday, December 6.");
    expect(context.modelContent).toContain("This is a prompt to check.");
    const day = await w.h.call("describe_view_context", { path: `/trips/${w.portland.id}`, query: {}, state: { section: "trip", tripId: w.portland.id, day: "2026-12-06" } }, w.ownerCaller);
    expect(day.modelContent).toContain("Selected day: Sunday, December 6.");
    expect(day.modelContent).toContain("Alder Street Inn");
    expect(day.modelContent).not.toContain("Coast Line 11:");
  });
});

const asPaste = (message: fx.FixtureMessage, text = message.text) => `Subject: ${message.subject}\nFrom: ${message.from}\n\n${text}`;
const PRIVATE_TITLE = "Surprise for Sam";
type Trip = { id: string; title: string; revision: number; dateLabel: string };
type Booking = { id: string; title: string; revision: number; tripId: string | null; tripTitle: string | null };

/** The world above, with the account A trip given a name that only account A readers may see. */
async function privateWorld() {
  const w = await world();
  const current = (await w.h.call("get_trip", { id: w.lisbon.id }, w.ownerCaller)).trip;
  await w.h.call("save_trip", { id: w.lisbon.id, expectedRevision: current.revision, title: PRIVATE_TITLE }, w.ownerCaller);
  return w;
}
async function importAs(h: Awaited<ReturnType<typeof harness>>, caller: Caller, text: string) {
  const preview = await h.call("preview_import", { kind: "paste", text }, caller);
  const applied = await h.call("apply_import", { previewId: preview.previewId, digest: preview.digest }, caller);
  return { preview, applied };
}

describe("trip names under the caller's projection", () => {
  it("names a shared booking's trip from the same projection as get_trip in lists, details, writes, history and context, and leaves the owner's view unchanged", async () => {
    const w = await privateWorld();
    const { h } = w;
    const two = chat("two", w.scopeB);
    const tile = w.manual as Booking;
    const projected = (await h.call("get_trip", { id: w.lisbon.id }, two)).trip;
    expect(projected).toMatchObject({ projection: "partial", title: "Lisbon" });

    const listed = await h.call("list_bookings", { limit: 50, status: "all", kind: "all" }, two);
    expect(listed.items.find((booking: Booking) => booking.id === tile.id).tripTitle).toBe("Lisbon");
    const inTrip = await h.call("list_bookings", { tripId: w.lisbon.id, limit: 50, status: "all", kind: "all" }, two);
    expect(inTrip.items.map((booking: Booking) => booking.tripTitle)).toEqual(["Lisbon"]);
    const detail = await h.call("get_booking", { id: tile.id }, two);
    expect(detail.booking.tripTitle).toBe("Lisbon");
    const written = await h.call("save_booking", { id: tile.id, expectedRevision: detail.booking.revision, notes: "Bring an apron" }, two);
    expect(written.record.tripTitle).toBe("Lisbon");
    const contexts = [];
    for (const path of [`/bookings/${tile.id}`, `/trips/${w.lisbon.id}`, "/"])
      contexts.push(await h.call("describe_view_context", { path, query: {}, state: { selected: [{ type: "booking", id: tile.id }] } }, two));
    expect(contexts[1].modelContent).toContain("Lisbon");

    // Moving the booking out records the move. Each reader sees the trips in it under their own projection.
    const own = await h.call("save_trip", { title: "Workshops", startDate: "2026-11-12", endDate: "2026-11-12" }, two);
    const moved = await h.call("save_booking", { id: tile.id, expectedRevision: written.record.revision, tripId: own.record.id }, two);
    expect(moved.record.tripTitle).toBe("Workshops");
    const history = await h.call("get_booking", { id: tile.id }, two);
    const lisbonNow = (await h.call("get_trip", { id: w.lisbon.id }, two)).trip;
    expect(history.changes.find((change: { kind: string }) => change.kind === "moved").fields[0]).toMatchObject({ field: "trip", before: lisbonNow.title, after: "Workshops" });

    for (const result of [listed, inTrip, detail, written, moved, history, ...contexts]) expect(JSON.stringify(result)).not.toContain(PRIVATE_TITLE);

    // The owner still sees the trip's own name, in the record and in the history.
    const ownerHistory = await h.call("get_booking", { id: tile.id }, w.ownerCaller);
    expect(ownerHistory.changes.find((change: { kind: string }) => change.kind === "moved").fields[0]).toMatchObject({ before: PRIVATE_TITLE, after: "Workshops" });
    await h.call("save_booking", { id: tile.id, expectedRevision: ownerHistory.booking.revision, tripId: w.lisbon.id }, w.ownerCaller);
    const ownerList = await h.call("list_bookings", { tripId: w.lisbon.id, limit: 50, status: "all", kind: "all" }, w.ownerCaller);
    expect(new Set(ownerList.items.map((booking: Booking) => booking.tripTitle))).toEqual(new Set([PRIVATE_TITLE]));
    expect((await h.call("get_booking", { id: tile.id }, w.ownerCaller)).booking.tripTitle).toBe(PRIVATE_TITLE);
  });

  it("names trips in review items, import previews and import results from the caller's projection", async () => {
    const w = await privateWorld();
    const { h } = w;
    const scopeRef = (await h.call("create_scope", { actorId: "chat:three", sources: ["manual", "imports"], operations: ["read", "write"] }, w.ownerCaller)).scopeRef;
    const three = chat("three", scopeRef);

    // The owner pastes a dinner. It fits only the account A trip, which chat three sees through the shared workshop booking.
    const first = await importAs(h, w.ownerCaller, asPaste(fx.LISBON_DINNER));
    expect(first.preview.items[0].placement).toBe(`Adds to ${PRIVATE_TITLE}.`);
    const dinner = first.applied.outcomes[0].bookingId as string;
    expect((await h.call("get_booking", { id: dinner }, three)).booking.tripTitle).toBe("Lisbon");

    // A correction, then a newer confirmation that disagrees with it, waits in Review.
    const before = (await h.call("get_booking", { id: dinner }, w.ownerCaller)).booking;
    await h.call("save_booking", { id: dinner, expectedRevision: before.revision, patch: { segments: [{ sequence: 0, startLocal: "2026-11-10T19:15" }] } }, w.ownerCaller);
    const revised = asPaste(fx.LISBON_DINNER, fx.LISBON_DINNER.text.replace("19:00", "19:30"));
    await importAs(h, w.ownerCaller, revised);
    const review = (await h.call("list_review_items", { limit: 50, state: "open" }, three)).items.find((item: { bookingId: string | null }) => item.bookingId === dinner);
    expect(review).toMatchObject({ kind: "change", tripId: w.lisbon.id, tripTitle: "Lisbon" });
    const context = await h.call("describe_view_context", { path: "/review", query: {} }, three);
    const ownerReview = (await h.call("list_review_items", { limit: 50, state: "open" }, w.ownerCaller)).items.find((item: { id: string }) => item.id === review.id);
    expect(ownerReview.tripTitle).toBe(PRIVATE_TITLE);

    // The import actions take the user audience. A scoped person using them gets the same projection.
    // The account A trip is named as this person sees it, and not offered as a choice, since they may not change it. Apply still places the booking there.
    const person = { ...three, audience: "user" as const };
    const preview = await h.call("preview_import", { kind: "paste", text: asPaste(fx.LISBON_DINNER, fx.LISBON_DINNER.text.replace("19:00", "19:45")) }, person);
    expect(preview.items[0]).toMatchObject({ match: { bookingId: dinner }, suggestedTripId: null, suggestedTripTitle: null, placement: "Updates Dinner at Mesa in Lisbon." });
    const second = await h.call("preview_import", { kind: "paste", text: asPaste(fx.LISBON_DINNER, fx.LISBON_DINNER.text.replace("MS-1834", "MS-2001").replace("Tuesday, November 10", "Thursday, November 12")) }, person);
    expect(second.items[0]).toMatchObject({ match: null, suggestedTripId: null, suggestedTripTitle: null, placement: "Adds to Lisbon." });
    const placed = await h.call("apply_import", { previewId: second.previewId, digest: second.digest }, person);
    expect(placed.outcomes[0]).toMatchObject({ action: "created", tripId: w.lisbon.id });
    expect(placed.openTripId).toBe(w.lisbon.id);
    // A confirmation of the account A hotel matches a booking this caller cannot see, so its result names nothing from it.
    const corrected = (await h.call("list_bookings", { limit: 50, status: "all", kind: "all", query: "Riverside" }, w.ownerCaller)).items[0];
    await h.call("save_booking", { id: corrected.id, expectedRevision: corrected.revision, patch: { title: "Riverside House for Sam" } }, w.ownerCaller);
    const hotel = await importAs(h, person, asPaste(fx.LISBON_HOTEL));
    expect(hotel.applied.outcomes[0]).toMatchObject({ bookingId: null, tripId: null });

    for (const result of [review, context, preview, second, placed, hotel]) {
      expect(JSON.stringify(result)).not.toContain(PRIVATE_TITLE);
      expect(JSON.stringify(result)).not.toContain("for Sam");
    }
  });

  it("lists trip choices in Review by the caller's projection, with no other trip's name in the reason", async () => {
    const w = await privateWorld();
    const { h } = w;
    await h.call("save_trip", { title: "Conference", startDate: "2026-11-10", endDate: "2026-11-12" }, w.ownerCaller);
    const scopeRef = (await h.call("create_scope", { actorId: "chat:three", sources: ["manual", "imports"], operations: ["read", "write"] }, w.ownerCaller)).scopeRef;
    const three = chat("three", scopeRef);
    const imported = await importAs(h, w.ownerCaller, asPaste(fx.LISBON_DINNER));
    expect(imported.preview.items[0].placement).toBe("Fits more than one trip. Choose one.");
    expect(imported.applied.outcomes[0]).toMatchObject({ action: "created", tripId: null });
    const item = (await h.call("list_review_items", { limit: 50, state: "open" }, three)).items.find((entry: { kind: string }) => entry.kind === "assign");
    const projected = (await h.call("get_trip", { id: w.lisbon.id }, three)).trip as Trip;
    expect(projected.dateLabel).not.toContain("November 9");
    expect(item.candidates.find((candidate: { id: string }) => candidate.id === w.lisbon.id)).toMatchObject({ title: projected.title, detail: projected.dateLabel });
    expect(item.candidates.map((candidate: { title: string }) => candidate.title)).toContain("Conference");
    expect(item.reason).toBe("It fits more than one trip. Choose one.");
    const context = await h.call("describe_view_context", { path: "/review", query: {} }, three);
    for (const result of [item, context]) {
      expect(JSON.stringify(result)).not.toContain(PRIVATE_TITLE);
      expect(JSON.stringify(result)).not.toContain("November 9");
    }
    // The owner sees the full trip.
    const ownerItem = (await h.call("list_review_items", { limit: 50, state: "open" }, w.ownerCaller)).items.find((entry: { id: string }) => entry.id === item.id);
    expect(ownerItem.candidates.find((candidate: { id: string }) => candidate.id === w.lisbon.id)).toMatchObject({ title: PRIVATE_TITLE, detail: "November 9 to 14, 2026" });
  });
});

describe("replayed writes after access changes", () => {
  /** A chat that may read and write account A and manual entries saves a booking into the account A trip. */
  async function savedByBroadChat() {
    const w = await privateWorld();
    const { h } = w;
    const broad = (await h.call("create_scope", { actorId: "chat:four", sources: ["account:acct-a", "manual"], operations: ["read", "write"] }, w.ownerCaller)).scopeRef;
    const id = randomUUID();
    const input = { tripId: w.lisbon.id, draft: { kind: "activity", title: "Cooking class", travelers: ["Alex Rivera"], segments: [{ startLocal: "2026-11-13T11:00", startZone: "Europe/Lisbon", address: "Rua da Madalena, Lisbon" }] } };
    const saved = await h.call("save_booking", input, chat("four", broad), { id });
    expect(saved.record.tripTitle).toBe(PRIVATE_TITLE);
    const count = async () => (await h.call("list_bookings", { limit: 50, status: "all", kind: "all", query: "Cooking" }, w.ownerCaller)).items.length;
    expect(await count()).toBe(1);
    return { ...w, broad, id, input, count };
  }

  it("refuses to replay a saved write once the chat's scope is replaced by a narrower one", async () => {
    const w = await savedByBroadChat();
    const narrow = (await w.h.call("create_scope", { actorId: "chat:four", sources: ["manual"], operations: ["read", "write"] }, w.ownerCaller)).scopeRef;
    await w.h.call("revoke_scope", { scopeRef: w.broad }, w.ownerCaller);
    const replay = await w.h.call("save_booking", w.input, chat("four", narrow), { id: w.id }).catch((error) => error);
    expect(replay).toMatchObject({ code: "conflict" });
    expect(JSON.stringify(replay)).not.toContain(PRIVATE_TITLE);
    expect(await w.count()).toBe(1);
  });

  it("refuses to replay a saved write once the same scope narrows in place, and after it is revoked", async () => {
    const w = await savedByBroadChat();
    // Deleting account A's data removes it from every scope that shared it, under the same scope reference.
    await w.h.call("delete_source_data", { source: "account:acct-a" }, w.ownerCaller);
    const replay = await w.h.call("save_booking", w.input, chat("four", w.broad), { id: w.id }).catch((error) => error);
    expect(replay).toMatchObject({ code: "conflict" });
    expect(JSON.stringify(replay)).not.toContain(PRIVATE_TITLE);
    expect(await w.count()).toBe(1);
    await w.h.call("revoke_scope", { scopeRef: w.broad }, w.ownerCaller);
    await expect(w.h.call("save_booking", w.input, chat("four", w.broad), { id: w.id })).rejects.toMatchObject({ code: "revoked" });
    expect(await w.count()).toBe(1);
  });

  it("still returns the first result to the same caller with unchanged access", async () => {
    const w = await savedByBroadChat();
    const again = await w.h.call("save_booking", w.input, chat("four", w.broad), { id: w.id });
    expect(again.record.tripTitle).toBe(PRIVATE_TITLE);
    expect(await w.count()).toBe(1);
  });
});

describe("stored review reasons", () => {
  it("rewrites first-release reasons that named other trips or bookings, and leaves every other reason alone", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ri-travel-migrate-"));
    const store = await openAppDatabase(path.join(dir, "records.db"));
    try {
      const db = store.db as unknown as SqlDatabase;
      migrate(db, MIGRATIONS.slice(0, 2));
      const insert = db.prepare("INSERT INTO review_items (id, created_at, updated_at, revision, kind, evidence_ids, reason, candidates, source_key, fingerprint, fictional) VALUES (?, '2026-10-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z', 1, ?, '[]', ?, '[]', 'imports', ?, 0)");
      insert.run("r1", "assign", `It fits more than one trip: ${PRIVATE_TITLE} and Conference. Choose one.`, "f1");
      insert.run("r2", "identity", "This message could describe 2 recorded bookings (Riverside House for Alex Rivera, Riverside House for Sam Okafor). Choose the one it belongs to, or keep it separate.", "f2");
      insert.run("r3", "assign", "This confirmation was forwarded, so confirm who is traveling and which trip it belongs to.", "f3");
      migrate(db, MIGRATIONS);
      const rows = db.prepare("SELECT id, reason, revision FROM review_items ORDER BY id").all() as { id: string; reason: string; revision: number }[];
      expect(rows.map((row) => ({ ...row }))).toEqual([
        { id: "r1", reason: MULTIPLE_TRIPS_REASON, revision: 2 },
        { id: "r2", reason: POSSIBLE_DUPLICATE_REASON, revision: 2 },
        { id: "r3", reason: "This confirmation was forwarded, so confirm who is traveling and which trip it belongs to.", revision: 1 },
      ]);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
