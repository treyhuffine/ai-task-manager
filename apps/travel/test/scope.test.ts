import { afterEach, describe, expect, it } from "vitest";
import { chat, cleanup, fakeConnectors, gmailAccount, harness, job, mailGrant, owner, type FakeMail } from "./helpers.js";
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
