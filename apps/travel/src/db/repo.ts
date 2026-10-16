/**
 * Row access for Travel records. Synchronous SQLite work that callers wrap in
 * transactions. Scope filtering happens here, in SQL, before any list, count
 * or search result is assembled.
 */
import { randomUUID } from "node:crypto";
import { allows, type AccessScope, type SqlDatabase, type SqlValue } from "@ri/app-kit/data";
import { effectiveBooking, type BookingRow, type EffectiveBooking, type OverrideRow, type SegmentRow, type StayRow } from "../domain/booking.js";
import type { BookingDraft, BookingKind, BookingStatus, IdeaKind, ReviewKind } from "../domain/model.js";
import { providerKey, normalizeReference } from "../domain/match.js";

export const json = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
};
const str = (value: unknown) => (value === null || value === undefined ? null : String(value));
const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export interface TripRow {
  id: string; createdAt: string; updatedAt: string; revision: number;
  title: string; titleSource: "derived" | "manual"; destinations: string[];
  startDate: string | null; endDate: string | null; datesSource: "derived" | "manual" | "unset";
  homeZone: string | null; travelers: string[]; notes: string | null; archivedAt: string | null;
  sourceKey: string; fictional: boolean;
}
export interface EvidenceRow {
  id: string; createdAt: string; updatedAt: string;
  sourceKey: string; origin: "gmail" | "file" | "paste" | "manual" | "fixture";
  account: string | null; externalId: string | null; threadId: string | null; messageIdHeader: string | null;
  inviteUid: string | null; inviteSequence: number | null;
  title: string; sender: string | null; senderDomain: string | null; receivedAt: string | null; observedAt: string;
  digest: string; textBlob: string | null; fileBlob: string | null; fileName: string | null; mimeType: string | null; excerpt: string | null;
  parseVersion: number; parseStatus: "parsed" | "partial" | "unreadable" | "pending_attachment" | "pending_ai" | "ai_failed" | "ignored";
  parseMethod: string | null; parseNote: string | null; attachments: { attachmentId: string | null; filename: string; mimeType: string; size: number }[];
  forwarded: boolean; availability: "available" | "unavailable"; unavailableAt: string | null; fictional: boolean;
}
export interface LinkRow { id: string; createdAt: string; bookingId: string; evidenceId: string; role: "created" | "duplicate" | "changed" | "canceled" | "linked"; contributes: boolean; snapshot: unknown }
/** One changed field. A trip move also records the trip IDs, so each reader sees those trips under their own projection. */
export interface ChangeField { field: string; label: string; before: string; after: string; beforeId?: string | null; afterId?: string | null }
export interface ChangeRow { id: string; createdAt: string; bookingId: string; evidenceId: string | null; kind: string; fields: ChangeField[]; actor: string; sourceKey: string; note: string | null }
export interface ReviewRow {
  id: string; createdAt: string; updatedAt: string; revision: number; kind: ReviewKind;
  bookingId: string | null; tripId: string | null; evidenceIds: string[]; reason: string;
  previous: Record<string, unknown> | null; proposed: Record<string, unknown> | null; candidates: string[];
  decision: string | null; decidedAt: string | null; decidedBy: string | null; sourceKey: string; fingerprint: string; fictional: boolean;
}
export interface IdeaRow {
  id: string; createdAt: string; updatedAt: string; revision: number; tripId: string; kind: IdeaKind; title: string; note: string | null; url: string | null;
  priceMinor: number | null; currency: string | null; observedAt: string | null; location: string | null; conditions: string | null; sourceLabel: string | null;
  sourceKey: string; removedAt: string | null; fictional: boolean;
}
export interface FollowUpRow {
  id: string; createdAt: string; updatedAt: string; revision: number; subjectType: "trip" | "booking" | "idea" | "review"; subjectId: string;
  operationId: string; title: string; dueAt: string | null; taskId: string | null; state: "pending" | "created" | "needs_permission" | "failed";
  availability: "unknown" | "available" | "missing"; checkedAt: string | null; lastError: string | null; sourceKey: string; actor: string;
}
export interface CalendarEventRow {
  id: string; account: string; calendarId: string; occurrenceKey: string; summary: string | null; location: string | null;
  startValue: string | null; endValue: string | null; allDay: boolean; startZone: string | null; status: string | null; cancelled: boolean; transparent: boolean; response: string | null; sourceKey: string; updatedAt: string;
}

const tripRow = (r: Record<string, unknown>): TripRow => ({
  id: String(r.id), createdAt: String(r.created_at), updatedAt: String(r.updated_at), revision: Number(r.revision),
  title: String(r.title), titleSource: String(r.title_source) as TripRow["titleSource"], destinations: json(r.destinations, []),
  startDate: str(r.start_date), endDate: str(r.end_date), datesSource: String(r.dates_source) as TripRow["datesSource"],
  homeZone: str(r.home_zone), travelers: json(r.travelers, []), notes: str(r.notes), archivedAt: str(r.archived_at),
  sourceKey: String(r.source_key), fictional: Number(r.fictional) === 1,
});
const bookingRow = (r: Record<string, unknown>): BookingRow => ({
  id: String(r.id), createdAt: String(r.created_at), updatedAt: String(r.updated_at), revision: Number(r.revision),
  tripId: str(r.trip_id), kind: String(r.kind) as BookingKind, title: String(r.title), provider: str(r.provider), providerCode: str(r.provider_code),
  reference: str(r.reference), detail: str(r.detail), travelers: json(r.travelers, []), status: String(r.status) as BookingStatus, notes: str(r.notes),
  method: String(r.method) as BookingRow["method"], sourceKey: String(r.source_key), sourceKeys: json(r.source_keys, []), fictional: Number(r.fictional) === 1,
});
const segmentRow = (r: Record<string, unknown>): SegmentRow => ({
  id: String(r.id), sequence: Number(r.sequence), number: str(r.number), originLabel: str(r.origin_label), originCode: str(r.origin_code),
  destinationLabel: str(r.destination_label), destinationCode: str(r.destination_code), startLocal: String(r.start_local), startZone: str(r.start_zone),
  startOffset: num(r.start_offset), endLocal: str(r.end_local), endZone: str(r.end_zone), endOffset: num(r.end_offset), address: str(r.address), endAddress: str(r.end_address),
});
const stayRow = (r: Record<string, unknown>): StayRow => ({
  id: String(r.id), propertyName: String(r.property_name), address: str(r.address), checkInDate: String(r.check_in_date), checkOutDate: String(r.check_out_date),
  checkInTime: str(r.check_in_time), checkOutTime: str(r.check_out_time), zone: str(r.zone),
});
const overrideRow = (r: Record<string, unknown>): OverrideRow => ({
  id: String(r.id), field: String(r.field), value: json(r.value, null), original: json(r.original, null), actor: String(r.actor), stale: Number(r.stale) === 1, createdAt: String(r.created_at), updatedAt: String(r.updated_at),
});
export const evidenceRow = (r: Record<string, unknown>): EvidenceRow => ({
  id: String(r.id), createdAt: String(r.created_at), updatedAt: String(r.updated_at), sourceKey: String(r.source_key), origin: String(r.origin) as EvidenceRow["origin"],
  account: str(r.account), externalId: str(r.external_id), threadId: str(r.thread_id), messageIdHeader: str(r.message_id_header), inviteUid: str(r.invite_uid), inviteSequence: num(r.invite_sequence),
  title: String(r.title), sender: str(r.sender), senderDomain: str(r.sender_domain), receivedAt: str(r.received_at), observedAt: String(r.observed_at),
  digest: String(r.digest), textBlob: str(r.text_blob), fileBlob: str(r.file_blob), fileName: str(r.file_name), mimeType: str(r.mime_type), excerpt: str(r.excerpt),
  parseVersion: Number(r.parse_version), parseStatus: String(r.parse_status) as EvidenceRow["parseStatus"], parseMethod: str(r.parse_method), parseNote: str(r.parse_note),
  attachments: json(r.attachments, []), forwarded: Number(r.forwarded) === 1, availability: String(r.availability) as EvidenceRow["availability"], unavailableAt: str(r.unavailable_at), fictional: Number(r.fictional) === 1,
});
const linkRow = (r: Record<string, unknown>): LinkRow => ({ id: String(r.id), createdAt: String(r.created_at), bookingId: String(r.booking_id), evidenceId: String(r.evidence_id), role: String(r.role) as LinkRow["role"], contributes: Number(r.contributes) === 1, snapshot: json(r.snapshot, null) });
const changeRow = (r: Record<string, unknown>): ChangeRow => ({ id: String(r.id), createdAt: String(r.created_at), bookingId: String(r.booking_id), evidenceId: str(r.evidence_id), kind: String(r.kind), fields: json(r.fields, []), actor: String(r.actor), sourceKey: String(r.source_key), note: str(r.note) });
const reviewRow = (r: Record<string, unknown>): ReviewRow => ({
  id: String(r.id), createdAt: String(r.created_at), updatedAt: String(r.updated_at), revision: Number(r.revision), kind: String(r.kind) as ReviewKind,
  bookingId: str(r.booking_id), tripId: str(r.trip_id), evidenceIds: json(r.evidence_ids, []), reason: String(r.reason), previous: json(r.previous, null), proposed: json(r.proposed, null),
  candidates: json(r.candidates, []), decision: str(r.decision), decidedAt: str(r.decided_at), decidedBy: str(r.decided_by), sourceKey: String(r.source_key), fingerprint: String(r.fingerprint), fictional: Number(r.fictional) === 1,
});
const ideaRow = (r: Record<string, unknown>): IdeaRow => ({
  id: String(r.id), createdAt: String(r.created_at), updatedAt: String(r.updated_at), revision: Number(r.revision), tripId: String(r.trip_id), kind: String(r.kind) as IdeaKind,
  title: String(r.title), note: str(r.note), url: str(r.url), priceMinor: num(r.price_minor), currency: str(r.currency), observedAt: str(r.observed_at), location: str(r.location),
  conditions: str(r.conditions), sourceLabel: str(r.source_label), sourceKey: String(r.source_key), removedAt: str(r.removed_at), fictional: Number(r.fictional) === 1,
});
const followUpRow = (r: Record<string, unknown>): FollowUpRow => ({
  id: String(r.id), createdAt: String(r.created_at), updatedAt: String(r.updated_at), revision: Number(r.revision), subjectType: String(r.subject_type) as FollowUpRow["subjectType"],
  subjectId: String(r.subject_id), operationId: String(r.operation_id), title: String(r.title), dueAt: str(r.due_at), taskId: str(r.task_id), state: String(r.state) as FollowUpRow["state"],
  availability: String(r.availability) as FollowUpRow["availability"], checkedAt: str(r.checked_at), lastError: str(r.last_error), sourceKey: String(r.source_key), actor: String(r.actor),
});
const calendarRow = (r: Record<string, unknown>): CalendarEventRow => ({
  id: String(r.id), account: String(r.account), calendarId: String(r.calendar_id), occurrenceKey: String(r.occurrence_key), summary: str(r.summary), location: str(r.location),
  startValue: str(r.start_value), endValue: str(r.end_value), allDay: Number(r.all_day) === 1, startZone: str(r.start_zone), status: str(r.status), cancelled: Number(r.cancelled) === 1,
  transparent: Number(r.transparent) === 1, response: str(r.response), sourceKey: String(r.source_key), updatedAt: String(r.updated_at),
});

/** Sources allowed for a scoped reader, as a JSON parameter, or null for the owner. */
export function scopeSources(scope: AccessScope): string | null {
  return scope.kind === "owner" ? null : JSON.stringify([...scope.sources]);
}
/** SQL condition: every contributing source of the booking aliased `b` is allowed. */
const BOOKING_VISIBLE = "NOT EXISTS (SELECT 1 FROM json_each(b.source_keys) j WHERE j.value NOT IN (SELECT value FROM json_each(?)))";

export function createRepo(db: SqlDatabase, now: () => Date) {
  const iso = () => now().toISOString();
  const run = (sql: string, ...params: SqlValue[]) => db.prepare(sql).run(...params);
  const get = (sql: string, ...params: SqlValue[]) => db.prepare(sql).get(...params);
  const all = (sql: string, ...params: SqlValue[]) => db.prepare(sql).all(...params);

  function loadEffective(rows: BookingRow[]): EffectiveBooking[] {
    if (!rows.length) return [];
    const ids = JSON.stringify(rows.map((row) => row.id));
    const segments = new Map<string, SegmentRow[]>();
    for (const r of all("SELECT * FROM segments WHERE booking_id IN (SELECT value FROM json_each(?)) ORDER BY sequence", ids)) {
      const list = segments.get(String(r.booking_id)) ?? [];
      list.push(segmentRow(r));
      segments.set(String(r.booking_id), list);
    }
    const stays = new Map<string, StayRow>();
    for (const r of all("SELECT * FROM stays WHERE booking_id IN (SELECT value FROM json_each(?))", ids)) stays.set(String(r.booking_id), stayRow(r));
    const overrides = new Map<string, OverrideRow[]>();
    for (const r of all("SELECT * FROM booking_overrides WHERE booking_id IN (SELECT value FROM json_each(?)) ORDER BY created_at, rowid", ids)) {
      const list = overrides.get(String(r.booking_id)) ?? [];
      list.push(overrideRow(r));
      overrides.set(String(r.booking_id), list);
    }
    return rows.map((row) => effectiveBooking(row, segments.get(row.id) ?? [], stays.get(row.id) ?? null, overrides.get(row.id) ?? []));
  }

  const repo = {
    iso,
    dataRevision(): number {
      return Number(get("SELECT value FROM travel_meta WHERE id = 'data_revision'")?.value ?? 0);
    },

    // ─── Trips ───────────────────────────────────────────────────────────
    trip(id: string): TripRow | null {
      const r = get("SELECT * FROM trips WHERE id = ?", id);
      return r ? tripRow(r) : null;
    },
    trips(): TripRow[] {
      return all("SELECT * FROM trips ORDER BY COALESCE(start_date, '9999') ASC, created_at ASC LIMIT 2000").map(tripRow);
    },
    insertTrip(input: { title: string; titleSource: TripRow["titleSource"]; destinations: string[]; startDate: string | null; endDate: string | null; datesSource: TripRow["datesSource"]; homeZone: string | null; travelers: string[]; notes: string | null; sourceKey: string; fictional?: boolean }): TripRow {
      const id = randomUUID(), time = iso();
      run("INSERT INTO trips (id, created_at, updated_at, revision, title, title_source, destinations, start_date, end_date, dates_source, home_zone, travelers, notes, archived_at, source_key, fictional) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
        id, time, time, input.title, input.titleSource, JSON.stringify(input.destinations), input.startDate, input.endDate, input.datesSource, input.homeZone, JSON.stringify(input.travelers), input.notes, input.sourceKey, input.fictional ? 1 : 0);
      return repo.trip(id)!;
    },
    updateTrip(id: string, patch: Partial<Pick<TripRow, "title" | "titleSource" | "destinations" | "startDate" | "endDate" | "datesSource" | "homeZone" | "travelers" | "notes" | "archivedAt">>) {
      const columns: Record<string, string> = { title: "title", titleSource: "title_source", destinations: "destinations", startDate: "start_date", endDate: "end_date", datesSource: "dates_source", homeZone: "home_zone", travelers: "travelers", notes: "notes", archivedAt: "archived_at" };
      const sets: string[] = [], params: SqlValue[] = [];
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        sets.push(`${columns[key]} = ?`);
        params.push(Array.isArray(value) ? JSON.stringify(value) : (value as SqlValue));
      }
      if (!sets.length) return;
      run(`UPDATE trips SET ${sets.join(", ")}, revision = revision + 1, updated_at = ? WHERE id = ?`, ...params, iso(), id);
    },
    deleteTrip(id: string) {
      run("DELETE FROM trips WHERE id = ?", id);
    },

    // ─── Bookings ────────────────────────────────────────────────────────
    bookingRow(id: string): BookingRow | null {
      const r = get("SELECT * FROM bookings WHERE id = ?", id);
      return r ? bookingRow(r) : null;
    },
    /** Stored values without corrections: the row, its segments and its stay. */
    parts(id: string): { row: BookingRow; segments: SegmentRow[]; stay: StayRow | null } | null {
      const row = repo.bookingRow(id);
      if (!row) return null;
      const stay = get("SELECT * FROM stays WHERE booking_id = ?", id);
      return { row, segments: all("SELECT * FROM segments WHERE booking_id = ? ORDER BY sequence", id).map(segmentRow), stay: stay ? stayRow(stay) : null };
    },
    booking(id: string): EffectiveBooking | null {
      const row = repo.bookingRow(id);
      return row ? loadEffective([row])[0] : null;
    },
    /** Bookings the scope may see, optionally for one trip or with no trip. */
    bookings(scope: AccessScope | null, filter: { tripId?: string | null; ids?: string[] } = {}): EffectiveBooking[] {
      const where: string[] = [], params: SqlValue[] = [];
      const sources = scope ? scopeSources(scope) : null;
      if (sources) { where.push(BOOKING_VISIBLE); params.push(sources); }
      if (filter.tripId === null) where.push("b.trip_id IS NULL");
      else if (filter.tripId !== undefined) { where.push("b.trip_id = ?"); params.push(filter.tripId); }
      if (filter.ids) { where.push("b.id IN (SELECT value FROM json_each(?))"); params.push(JSON.stringify(filter.ids)); }
      const rows = all(`SELECT b.* FROM bookings b ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY COALESCE(b.first_date, '9999'), b.created_at, b.id LIMIT 5000`, ...params).map(bookingRow);
      return loadEffective(rows);
    },
    /** Booking IDs matching a full-text query, within the scope. */
    searchBookingIds(scope: AccessScope, query: string): string[] {
      const terms = query.normalize("NFKC").replace(/["*^():]/g, " ").split(/\s+/).filter(Boolean).slice(0, 8);
      if (!terms.length) return [];
      const match = terms.map((term) => `"${term}"*`).join(" ");
      const sources = scopeSources(scope);
      const rows = sources
        ? all(`SELECT f.booking_id FROM bookings_fts f JOIN bookings b ON b.id = f.booking_id WHERE bookings_fts MATCH ? AND ${BOOKING_VISIBLE} LIMIT 500`, match, sources)
        : all("SELECT booking_id FROM bookings_fts WHERE bookings_fts MATCH ? LIMIT 500", match);
      return rows.map((row) => String(row.booking_id));
    },
    insertBooking(draft: BookingDraft, meta: { tripId: string | null; method: BookingRow["method"]; sourceKey: string; fictional?: boolean }): string {
      const id = randomUUID(), time = iso();
      run("INSERT INTO bookings (id, created_at, updated_at, revision, trip_id, kind, title, provider, provider_code, provider_key, reference, reference_key, detail, travelers, status, notes, method, source_key, source_keys, first_date, last_date, fictional) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
        id, time, time, meta.tripId, draft.kind, draft.title?.trim() || defaultTitle(draft), draft.provider ?? null, draft.providerCode ?? null, providerKey(draft.provider), draft.reference ?? null, normalizeReference(draft.reference),
        draft.detail ?? null, JSON.stringify(draft.travelers ?? []), draft.status ?? "confirmed", draft.notes ?? null, meta.method, meta.sourceKey, JSON.stringify([meta.sourceKey]), meta.fictional ? 1 : 0);
      repo.replaceParts(id, draft);
      return id;
    },
    /** Replace a booking's segments and stay from a draft. */
    replaceParts(id: string, draft: BookingDraft) {
      const time = iso();
      run("DELETE FROM segments WHERE booking_id = ?", id);
      run("DELETE FROM stays WHERE booking_id = ?", id);
      (draft.segments ?? []).forEach((segment, sequence) => {
        run("INSERT INTO segments (id, created_at, updated_at, booking_id, sequence, number, origin_label, origin_code, destination_label, destination_code, start_local, start_zone, start_offset, end_local, end_zone, end_offset, address, end_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          randomUUID(), time, time, id, sequence, segment.number ?? null, segment.originLabel ?? null, segment.originCode?.toUpperCase() ?? null, segment.destinationLabel ?? null, segment.destinationCode?.toUpperCase() ?? null,
          segment.startLocal, segment.startZone ?? null, segment.startOffset ?? null, segment.endLocal ?? null, segment.endZone ?? null, segment.endOffset ?? null, segment.address ?? null, segment.endAddress ?? null);
      });
      if (draft.stay)
        run("INSERT INTO stays (id, created_at, updated_at, booking_id, property_name, address, check_in_date, check_out_date, check_in_time, check_out_time, zone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          randomUUID(), time, time, id, draft.stay.propertyName, draft.stay.address ?? null, draft.stay.checkInDate, draft.stay.checkOutDate, draft.stay.checkInTime ?? null, draft.stay.checkOutTime ?? null, draft.stay.zone ?? null);
      repo.refreshDerived(id);
    },
    /** Write stored values at field paths, as a source or the manual form states them. */
    setBase(id: string, values: Map<string, unknown>) {
      const time = iso();
      const top: Record<string, string> = { title: "title", provider: "provider", reference: "reference", status: "status", travelers: "travelers" };
      for (const [path, value] of values) {
        if (top[path]) {
          run(`UPDATE bookings SET ${top[path]} = ?, updated_at = ? WHERE id = ?`, Array.isArray(value) ? JSON.stringify(value) : (value as SqlValue) ?? null, time, id);
          if (path === "provider") run("UPDATE bookings SET provider_key = ? WHERE id = ?", providerKey(value as string | null), id);
          if (path === "reference") run("UPDATE bookings SET reference_key = ? WHERE id = ?", normalizeReference(value as string | null), id);
          continue;
        }
        const stay = /^stay\.(\w+)$/.exec(path);
        if (stay) {
          const column = { propertyName: "property_name", address: "address", checkInDate: "check_in_date", checkOutDate: "check_out_date", checkInTime: "check_in_time", checkOutTime: "check_out_time", zone: "zone" }[stay[1]];
          if (column) run(`UPDATE stays SET ${column} = ?, updated_at = ? WHERE booking_id = ?`, (value as SqlValue) ?? null, time, id);
          continue;
        }
        const segment = /^segments\.(\d+)\.(\w+)$/.exec(path);
        if (segment) {
          const column = { number: "number", originLabel: "origin_label", originCode: "origin_code", destinationLabel: "destination_label", destinationCode: "destination_code", startLocal: "start_local", startZone: "start_zone", endLocal: "end_local", endZone: "end_zone", address: "address", endAddress: "end_address" }[segment[2]];
          if (column) run(`UPDATE segments SET ${column} = ?, updated_at = ? WHERE booking_id = ? AND sequence = ?`, (value as SqlValue) ?? null, time, id, Number(segment[1]));
        }
      }
      // A known zone replaces an offset an older source stated.
      run("UPDATE segments SET start_offset = NULL WHERE booking_id = ? AND start_zone IS NOT NULL", id);
      run("UPDATE segments SET end_offset = NULL WHERE booking_id = ? AND end_zone IS NOT NULL", id);
      repo.refreshDerived(id);
    },
    updateBooking(id: string, patch: { tripId?: string | null; notes?: string | null; detail?: string | null; providerCode?: string | null }) {
      const sets: string[] = [], params: SqlValue[] = [];
      if (patch.tripId !== undefined) { sets.push("trip_id = ?"); params.push(patch.tripId); }
      if (patch.notes !== undefined) { sets.push("notes = ?"); params.push(patch.notes); }
      if (patch.detail !== undefined) { sets.push("detail = ?"); params.push(patch.detail); }
      if (patch.providerCode !== undefined) { sets.push("provider_code = ?"); params.push(patch.providerCode); }
      if (!sets.length) return;
      run(`UPDATE bookings SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, ...params, iso(), id);
    },
    bumpBooking(id: string) {
      run("UPDATE bookings SET revision = revision + 1, updated_at = ? WHERE id = ?", iso(), id);
    },
    addSourceKey(id: string, sourceKey: string) {
      const row = repo.bookingRow(id);
      if (!row || row.sourceKeys.includes(sourceKey)) return;
      run("UPDATE bookings SET source_keys = ? WHERE id = ?", JSON.stringify([...row.sourceKeys, sourceKey].sort()), id);
    },
    setSourceKeys(id: string, keys: string[]) {
      run("UPDATE bookings SET source_keys = ? WHERE id = ?", JSON.stringify([...new Set(keys)].sort()), id);
    },
    /** Keep first/last dates and the search row in step with effective values. */
    refreshDerived(id: string) {
      const booking = repo.booking(id);
      if (!booking) return;
      run("UPDATE bookings SET first_date = ?, last_date = ? WHERE id = ?", booking.firstDate, booking.lastDate, id);
      run("DELETE FROM bookings_fts WHERE booking_id = ?", id);
      const body = [
        booking.title, booking.provider, booking.reference, booking.detail, booking.travelers.join(" "), booking.kind,
        ...booking.segments.flatMap((segment) => [segment.number, segment.origin.label, segment.origin.code, segment.destination.label, segment.destination.code, segment.address]),
        booking.stay?.propertyName, booking.stay?.address,
      ].filter(Boolean).join(" ");
      run("INSERT INTO bookings_fts (booking_id, body) VALUES (?, ?)", id, body);
    },
    deleteBooking(id: string) {
      run("DELETE FROM bookings_fts WHERE booking_id = ?", id);
      run("DELETE FROM bookings WHERE id = ?", id);
    },

    // ─── Corrections ────────────────────────────────────────────────────
    overrides(bookingId: string): OverrideRow[] {
      return all("SELECT * FROM booking_overrides WHERE booking_id = ? ORDER BY created_at, rowid", bookingId).map(overrideRow);
    },
    setOverride(bookingId: string, field: string, value: unknown, original: unknown, actor: string) {
      const time = iso();
      run("INSERT INTO booking_overrides (id, created_at, updated_at, booking_id, field, value, original, actor, stale) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(booking_id, field) DO UPDATE SET value = excluded.value, actor = excluded.actor, stale = 0, updated_at = excluded.updated_at",
        randomUUID(), time, time, bookingId, field, JSON.stringify(value ?? null), JSON.stringify(original ?? null), actor);
      repo.refreshDerived(bookingId);
    },
    /** A newer source changed the value a correction replaced. */
    markOverride(bookingId: string, field: string, patch: { stale?: boolean; original?: unknown }) {
      if (patch.stale !== undefined) run("UPDATE booking_overrides SET stale = ?, updated_at = ? WHERE booking_id = ? AND field = ?", patch.stale ? 1 : 0, iso(), bookingId, field);
      if (patch.original !== undefined) run("UPDATE booking_overrides SET original = ?, updated_at = ? WHERE booking_id = ? AND field = ?", JSON.stringify(patch.original), iso(), bookingId, field);
    },
    clearOverride(bookingId: string, field: string) {
      run("DELETE FROM booking_overrides WHERE booking_id = ? AND field = ?", bookingId, field);
      repo.refreshDerived(bookingId);
    },

    // ─── Evidence ───────────────────────────────────────────────────────
    evidence(id: string): EvidenceRow | null {
      const r = get("SELECT * FROM evidence WHERE id = ?", id);
      return r ? evidenceRow(r) : null;
    },
    evidenceByExternal(sourceKey: string, externalId: string): EvidenceRow | null {
      const r = get("SELECT * FROM evidence WHERE source_key = ? AND external_id = ?", sourceKey, externalId);
      return r ? evidenceRow(r) : null;
    },
    evidenceByDigest(sourceKey: string, digest: string): EvidenceRow | null {
      const r = get("SELECT * FROM evidence WHERE source_key = ? AND digest = ? ORDER BY created_at LIMIT 1", sourceKey, digest);
      return r ? evidenceRow(r) : null;
    },
    evidenceByStatus(statuses: EvidenceRow["parseStatus"][], sourceKeys: string[] | null, limit: number): EvidenceRow[] {
      return (sourceKeys
        ? all("SELECT * FROM evidence WHERE parse_status IN (SELECT value FROM json_each(?)) AND source_key IN (SELECT value FROM json_each(?)) AND availability = 'available' ORDER BY created_at LIMIT ?", JSON.stringify(statuses), JSON.stringify(sourceKeys), limit)
        : all("SELECT * FROM evidence WHERE parse_status IN (SELECT value FROM json_each(?)) AND availability = 'available' ORDER BY created_at LIMIT ?", JSON.stringify(statuses), limit)).map(evidenceRow);
    },
    insertEvidence(input: Omit<EvidenceRow, "id" | "createdAt" | "updatedAt" | "availability" | "unavailableAt">): EvidenceRow {
      const id = randomUUID(), time = iso();
      run(`INSERT INTO evidence (id, created_at, updated_at, source_key, origin, account, external_id, thread_id, message_id_header, invite_uid, invite_sequence, title, sender, sender_domain, received_at, observed_at, digest, text_blob, file_blob, file_name, mime_type, excerpt, parse_version, parse_status, parse_method, parse_note, attachments, forwarded, availability, unavailable_at, fictional)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', NULL, ?)`,
        id, time, time, input.sourceKey, input.origin, input.account, input.externalId, input.threadId, input.messageIdHeader, input.inviteUid, input.inviteSequence, input.title.slice(0, 300), input.sender, input.senderDomain,
        input.receivedAt, input.observedAt, input.digest, input.textBlob, input.fileBlob, input.fileName, input.mimeType, input.excerpt, input.parseVersion, input.parseStatus, input.parseMethod, input.parseNote,
        JSON.stringify(input.attachments), input.forwarded ? 1 : 0, input.fictional ? 1 : 0);
      return repo.evidence(id)!;
    },
    updateEvidence(id: string, patch: Partial<Pick<EvidenceRow, "parseStatus" | "parseMethod" | "parseNote" | "textBlob" | "excerpt" | "parseVersion" | "availability" | "unavailableAt">>) {
      const columns: Record<string, string> = { parseStatus: "parse_status", parseMethod: "parse_method", parseNote: "parse_note", textBlob: "text_blob", excerpt: "excerpt", parseVersion: "parse_version", availability: "availability", unavailableAt: "unavailable_at" };
      const sets: string[] = [], params: SqlValue[] = [];
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        sets.push(`${columns[key]} = ?`);
        params.push(value as SqlValue);
      }
      if (sets.length) run(`UPDATE evidence SET ${sets.join(", ")}, revision = revision + 1, updated_at = ? WHERE id = ?`, ...params, iso(), id);
    },
    /** Evidence with the same invitation UID or the same thread, linked to bookings. */
    bookingsBySourceIdentity(evidence: EvidenceRow): string[] {
      const ids = new Set<string>();
      if (evidence.inviteUid)
        for (const r of all("SELECT DISTINCT s.booking_id FROM booking_sources s JOIN evidence e ON e.id = s.evidence_id WHERE e.invite_uid = ? AND e.source_key = ? AND e.id != ?", evidence.inviteUid, evidence.sourceKey, evidence.id)) ids.add(String(r.booking_id));
      return [...ids];
    },
    bookingsInThread(evidence: EvidenceRow): string[] {
      if (!evidence.threadId || !evidence.account) return [];
      return all("SELECT DISTINCT s.booking_id FROM booking_sources s JOIN evidence e ON e.id = s.evidence_id WHERE e.thread_id = ? AND e.account = ? AND e.id != ?", evidence.threadId, evidence.account, evidence.id).map((r) => String(r.booking_id));
    },
    deleteEvidence(id: string) {
      run("DELETE FROM evidence WHERE id = ?", id);
    },
    evidenceForSource(sourceKey: string): EvidenceRow[] {
      return all("SELECT * FROM evidence WHERE source_key = ?", sourceKey).map(evidenceRow);
    },

    // ─── Links and change history ───────────────────────────────────────
    link(bookingId: string, evidenceId: string, role: LinkRow["role"], contributes: boolean, snapshot: unknown) {
      const time = iso();
      run("INSERT INTO booking_sources (id, created_at, updated_at, booking_id, evidence_id, role, contributes, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(booking_id, evidence_id) DO NOTHING",
        randomUUID(), time, time, bookingId, evidenceId, role, contributes ? 1 : 0, JSON.stringify(snapshot ?? null));
    },
    links(bookingId: string): (LinkRow & { evidence: EvidenceRow })[] {
      return all("SELECT s.*, e.id AS e_id FROM booking_sources s JOIN evidence e ON e.id = s.evidence_id WHERE s.booking_id = ? ORDER BY s.created_at, s.rowid", bookingId)
        .map((r) => ({ ...linkRow(r), evidence: repo.evidence(String(r.e_id))! }));
    },
    linksForEvidence(evidenceId: string): LinkRow[] {
      return all("SELECT * FROM booking_sources WHERE evidence_id = ?", evidenceId).map(linkRow);
    },
    addChange(input: { bookingId: string; evidenceId: string | null; kind: string; fields: ChangeRow["fields"]; actor: string; sourceKey: string; note?: string | null }) {
      const time = iso();
      run("INSERT INTO booking_changes (id, created_at, updated_at, booking_id, evidence_id, kind, fields, actor, source_key, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        randomUUID(), time, time, input.bookingId, input.evidenceId, input.kind, JSON.stringify(input.fields), input.actor, input.sourceKey, input.note ?? null);
    },
    changes(bookingId: string): ChangeRow[] {
      return all("SELECT * FROM booking_changes WHERE booking_id = ? ORDER BY created_at, rowid LIMIT 200", bookingId).map(changeRow);
    },

    // ─── Review ─────────────────────────────────────────────────────────
    review(id: string): ReviewRow | null {
      const r = get("SELECT * FROM review_items WHERE id = ?", id);
      return r ? reviewRow(r) : null;
    },
    reviews(filter: { open?: boolean; bookingId?: string; tripId?: string; limit?: number } = {}): ReviewRow[] {
      const where: string[] = [], params: SqlValue[] = [];
      if (filter.open) where.push("decision IS NULL");
      if (filter.bookingId) { where.push("booking_id = ?"); params.push(filter.bookingId); }
      if (filter.tripId) { where.push("(trip_id = ? OR booking_id IN (SELECT id FROM bookings WHERE trip_id = ?) OR EXISTS (SELECT 1 FROM json_each(review_items.candidates) c WHERE c.value = ?))"); params.push(filter.tripId, filter.tripId, filter.tripId); }
      // Changes to recorded bookings first, then placement, then extraction checks.
      return all(`SELECT * FROM review_items ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY CASE kind WHEN 'change' THEN 0 WHEN 'cancellation' THEN 1 WHEN 'identity' THEN 2 WHEN 'assign' THEN 3 WHEN 'extraction' THEN 4 ELSE 5 END, created_at, rowid LIMIT ?`, ...params, filter.limit ?? 1000).map(reviewRow);
    },
    /** Insert once per fingerprint. Returns the existing item for a repeat. */
    insertReview(input: Omit<ReviewRow, "id" | "createdAt" | "updatedAt" | "revision" | "decision" | "decidedAt" | "decidedBy">): ReviewRow {
      const existing = get("SELECT * FROM review_items WHERE fingerprint = ?", input.fingerprint);
      if (existing) return reviewRow(existing);
      const id = randomUUID(), time = iso();
      run("INSERT INTO review_items (id, created_at, updated_at, revision, kind, booking_id, trip_id, evidence_ids, reason, previous, proposed, candidates, decision, decided_at, decided_by, source_key, fingerprint, fictional) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)",
        id, time, time, input.kind, input.bookingId, input.tripId, JSON.stringify(input.evidenceIds), input.reason.slice(0, 600), input.previous ? JSON.stringify(input.previous) : null,
        input.proposed ? JSON.stringify(input.proposed) : null, JSON.stringify(input.candidates), input.sourceKey, input.fingerprint, input.fictional ? 1 : 0);
      return repo.review(id)!;
    },
    decideReview(id: string, decision: string, actor: string) {
      run("UPDATE review_items SET decision = ?, decided_at = ?, decided_by = ?, revision = revision + 1, updated_at = ? WHERE id = ?", decision, iso(), actor, iso(), id);
    },
    /** Close open review items about a booking when a decision elsewhere settles them. */
    supersedeReviews(bookingId: string, kinds: ReviewKind[], actor: string) {
      run("UPDATE review_items SET decision = 'dismiss', decided_at = ?, decided_by = ?, revision = revision + 1, updated_at = ? WHERE booking_id = ? AND decision IS NULL AND kind IN (SELECT value FROM json_each(?))", iso(), actor, iso(), bookingId, JSON.stringify(kinds));
    },

    // ─── Gap dismissals ─────────────────────────────────────────────────
    dismissals(tripId: string) {
      return all("SELECT gap_key, fingerprint, updated_at FROM gap_dismissals WHERE trip_id = ?", tripId).map((r) => ({ key: String(r.gap_key), fingerprint: String(r.fingerprint), at: String(r.updated_at) }));
    },
    dismissGap(tripId: string, key: string, fingerprint: string, actor: string, note: string | null) {
      const time = iso();
      run("INSERT INTO gap_dismissals (id, created_at, updated_at, trip_id, gap_key, fingerprint, actor, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(trip_id, gap_key) DO UPDATE SET fingerprint = excluded.fingerprint, actor = excluded.actor, note = excluded.note, updated_at = excluded.updated_at",
        randomUUID(), time, time, tripId, key, fingerprint, actor, note);
    },
    restoreGap(tripId: string, key: string) {
      run("DELETE FROM gap_dismissals WHERE trip_id = ? AND gap_key = ?", tripId, key);
    },

    // ─── Ideas ──────────────────────────────────────────────────────────
    idea(id: string): IdeaRow | null {
      const r = get("SELECT * FROM ideas WHERE id = ?", id);
      return r ? ideaRow(r) : null;
    },
    ideas(scope: AccessScope | null, filter: { tripId?: string; ids?: string[]; includeRemoved?: boolean } = {}): IdeaRow[] {
      const where: string[] = [], params: SqlValue[] = [];
      if (!filter.includeRemoved) where.push("removed_at IS NULL");
      if (filter.tripId) { where.push("trip_id = ?"); params.push(filter.tripId); }
      if (filter.ids) { where.push("id IN (SELECT value FROM json_each(?))"); params.push(JSON.stringify(filter.ids)); }
      const sources = scope ? scopeSources(scope) : null;
      if (sources) { where.push("source_key IN (SELECT value FROM json_each(?))"); params.push(sources); }
      return all(`SELECT * FROM ideas ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at, id LIMIT 2000`, ...params).map(ideaRow);
    },
    insertIdea(input: Omit<IdeaRow, "id" | "createdAt" | "updatedAt" | "revision" | "removedAt">): IdeaRow {
      const id = randomUUID(), time = iso();
      run("INSERT INTO ideas (id, created_at, updated_at, revision, trip_id, kind, title, note, url, price_minor, currency, observed_at, location, conditions, source_label, source_key, removed_at, fictional) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
        id, time, time, input.tripId, input.kind, input.title, input.note, input.url, input.priceMinor, input.currency, input.observedAt, input.location, input.conditions, input.sourceLabel, input.sourceKey, input.fictional ? 1 : 0);
      return repo.idea(id)!;
    },
    updateIdea(id: string, patch: Partial<Omit<IdeaRow, "id" | "createdAt" | "updatedAt" | "revision" | "sourceKey" | "fictional">>) {
      const columns: Record<string, string> = { tripId: "trip_id", kind: "kind", title: "title", note: "note", url: "url", priceMinor: "price_minor", currency: "currency", observedAt: "observed_at", location: "location", conditions: "conditions", sourceLabel: "source_label", removedAt: "removed_at" };
      const sets: string[] = [], params: SqlValue[] = [];
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || !columns[key]) continue;
        sets.push(`${columns[key]} = ?`);
        params.push(value as SqlValue);
      }
      if (sets.length) run(`UPDATE ideas SET ${sets.join(", ")}, revision = revision + 1, updated_at = ? WHERE id = ?`, ...params, iso(), id);
    },

    // ─── Follow-ups ─────────────────────────────────────────────────────
    followUp(id: string): FollowUpRow | null {
      const r = get("SELECT * FROM follow_ups WHERE id = ?", id);
      return r ? followUpRow(r) : null;
    },
    followUpByOperation(operationId: string): FollowUpRow | null {
      const r = get("SELECT * FROM follow_ups WHERE operation_id = ?", operationId);
      return r ? followUpRow(r) : null;
    },
    followUps(filter: { subjectType?: string; subjectId?: string; sourceKeys?: string[] | null } = {}): FollowUpRow[] {
      const where: string[] = [], params: SqlValue[] = [];
      if (filter.subjectType) { where.push("subject_type = ?"); params.push(filter.subjectType); }
      if (filter.subjectId) { where.push("subject_id = ?"); params.push(filter.subjectId); }
      if (filter.sourceKeys) { where.push("source_key IN (SELECT value FROM json_each(?))"); params.push(JSON.stringify(filter.sourceKeys)); }
      return all(`SELECT * FROM follow_ups ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id LIMIT 500`, ...params).map(followUpRow);
    },
    insertFollowUp(input: Pick<FollowUpRow, "subjectType" | "subjectId" | "operationId" | "title" | "dueAt" | "sourceKey" | "actor">): FollowUpRow {
      const id = randomUUID(), time = iso();
      run("INSERT INTO follow_ups (id, created_at, updated_at, revision, subject_type, subject_id, operation_id, title, due_at, task_id, state, availability, checked_at, last_error, source_key, actor) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, NULL, 'pending', 'unknown', NULL, NULL, ?, ?)",
        id, time, time, input.subjectType, input.subjectId, input.operationId, input.title, input.dueAt, input.sourceKey, input.actor);
      return repo.followUp(id)!;
    },
    updateFollowUp(id: string, patch: Partial<Pick<FollowUpRow, "taskId" | "state" | "availability" | "checkedAt" | "lastError">>) {
      const columns: Record<string, string> = { taskId: "task_id", state: "state", availability: "availability", checkedAt: "checked_at", lastError: "last_error" };
      const sets: string[] = [], params: SqlValue[] = [];
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        sets.push(`${columns[key]} = ?`);
        params.push(value as SqlValue);
      }
      if (sets.length) run(`UPDATE follow_ups SET ${sets.join(", ")}, revision = revision + 1, updated_at = ? WHERE id = ?`, ...params, iso(), id);
    },

    // ─── Calendar ───────────────────────────────────────────────────────
    upsertCalendarEvent(input: Omit<CalendarEventRow, "id" | "updatedAt">) {
      const time = iso();
      run(`INSERT INTO calendar_events (id, created_at, updated_at, account, calendar_id, occurrence_key, summary, location, start_value, end_value, all_day, start_zone, status, cancelled, transparent, response, source_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account, calendar_id, occurrence_key) DO UPDATE SET revision = calendar_events.revision + 1, summary = excluded.summary, location = excluded.location, start_value = COALESCE(excluded.start_value, start_value), end_value = COALESCE(excluded.end_value, end_value), all_day = excluded.all_day, start_zone = excluded.start_zone, status = excluded.status, cancelled = excluded.cancelled, transparent = excluded.transparent, response = excluded.response, updated_at = excluded.updated_at`,
        randomUUID(), time, time, input.account, input.calendarId, input.occurrenceKey, input.summary, input.location, input.startValue, input.endValue, input.allDay ? 1 : 0, input.startZone, input.status, input.cancelled ? 1 : 0, input.transparent ? 1 : 0, input.response, input.sourceKey);
    },
    /** Events overlapping [from, to) by ISO date prefix comparison, for allowed sources. */
    calendarEvents(from: string, to: string, sourceKeys: string[] | null): CalendarEventRow[] {
      const params: SqlValue[] = [to, from];
      let filter = "";
      if (sourceKeys) { filter = " AND source_key IN (SELECT value FROM json_each(?))"; params.push(JSON.stringify(sourceKeys)); }
      return all(`SELECT * FROM calendar_events WHERE start_value < ? AND COALESCE(end_value, start_value) >= ? AND cancelled = 0${filter} ORDER BY start_value LIMIT 500`, ...params).map(calendarRow);
    },
    calendarCount(account: string): number {
      return Number(get("SELECT COUNT(*) AS count FROM calendar_events WHERE account = ? AND cancelled = 0", account)?.count ?? 0);
    },
    deleteCalendarSource(sourceKey: string) {
      run("DELETE FROM calendar_events WHERE source_key = ?", sourceKey);
    },

    // ─── Import previews ────────────────────────────────────────────────
    preview(id: string) {
      const r = get("SELECT * FROM import_previews WHERE id = ?", id);
      return r ? { id: String(r.id), createdAt: String(r.created_at), expiresAt: String(r.expires_at), actor: String(r.actor), kind: String(r.kind) as "file" | "paste", fileName: str(r.file_name), mimeType: str(r.mime_type), sourceDigest: String(r.source_digest), digest: String(r.digest), fileBlob: str(r.file_blob), textBlob: str(r.text_blob), parse: json<unknown>(r.parse, null), appliedAt: str(r.applied_at), result: json<unknown>(r.result, null) } : null;
    },
    insertPreview(input: { actor: string; kind: "file" | "paste"; fileName: string | null; mimeType: string | null; sourceDigest: string; digest: string; fileBlob: string | null; textBlob: string | null; parse: unknown; expiresAt: string }) {
      const id = randomUUID(), time = iso();
      run("INSERT INTO import_previews (id, created_at, updated_at, expires_at, actor, kind, file_name, mime_type, source_digest, digest, file_blob, text_blob, parse, applied_at, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
        id, time, time, input.expiresAt, input.actor, input.kind, input.fileName, input.mimeType, input.sourceDigest, input.digest, input.fileBlob, input.textBlob, JSON.stringify(input.parse));
      return id;
    },
    markPreviewApplied(id: string, result: unknown) {
      run("UPDATE import_previews SET applied_at = ?, result = ?, revision = revision + 1, updated_at = ? WHERE id = ?", iso(), JSON.stringify(result), iso(), id);
    },
    prunePreviews() {
      run("DELETE FROM import_previews WHERE expires_at < ? AND applied_at IS NULL", iso());
    },
    run, get, all,
  };
  return repo;
}
export type Repo = ReturnType<typeof createRepo>;

function defaultTitle(draft: BookingDraft): string {
  if (draft.kind === "lodging") return draft.stay?.propertyName ?? "Stay";
  const segment = draft.segments?.[0];
  if (draft.kind === "flight") return segment?.number ? `Flight ${segment.number}` : "Flight";
  if (draft.kind === "train") return segment?.number ? `Train ${segment.number}` : "Train";
  if (draft.kind === "car") return draft.provider ? (/\b(rental|hire|rent)\b/i.test(draft.provider) ? draft.provider : `${draft.provider} car rental`) : "Car rental";
  return draft.provider ?? "Reservation";
}

/** True when a booking is visible to the scope: every contributing source allowed. */
export function bookingVisible(scope: AccessScope, booking: { sourceKeys: string[] }): boolean {
  return scope.kind === "owner" || booking.sourceKeys.every((key) => allows(scope, key));
}
