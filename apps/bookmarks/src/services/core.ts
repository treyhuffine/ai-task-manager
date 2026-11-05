/**
 * The Bookmarks instance: storage and every read and write of a record. Opening
 * it applies migrations and nothing else. No timers, no reading.
 */
import path from "node:path";
import { z } from "zod/v4";
import { AppError } from "@ri/app-kit/contract";
import { openAppDatabase, type AppInvocation } from "@ri/app-kit/sdk";
import { actorOf, allows, createScopeStore, createSettings, migrate, newId, scopeFingerprint, transaction, type AccessScope, type Operation, type SqlDatabase, type SqlValue } from "@ri/app-kit/data";
import { MIGRATIONS } from "../db/migrations.js";
import { clipText, excerptOf, MAX_EXCERPT } from "../domain/page.js";
import { cleanTags, parseLink, parseSavedAt } from "../domain/url.js";

/** The one source. Everything saved is shared or not as a whole. */
export const SAVED_SOURCE = "saved";

export type Via = "extension" | "bookmark" | "bookmarklet" | "shortcut" | "chat" | "added" | "import" | "fixture";
export type PageState = "waiting" | "read" | "no_text" | "gone" | "needs_browser" | "failed";
export type TitleSource = "link" | "page" | "given" | "edited";

export interface BookmarkRow {
  seq: number; id: string; createdAt: string; updatedAt: string; revision: number;
  url: string; urlKey: string; site: string; title: string; titleSource: TitleSource;
  note: string | null; tags: string[]; savedAt: string; via: Via; excerpt: string | null;
  pageState: PageState; pageSource: "browser" | "home" | null; pageChars: number; pageAt: string | null;
  pageAttempts: number; pageNextAt: string | null; fictional: boolean;
}
const rowOf = (row: Record<string, unknown>): BookmarkRow => ({
  seq: Number(row.seq), id: String(row.id), createdAt: String(row.created_at), updatedAt: String(row.updated_at), revision: Number(row.revision),
  url: String(row.url), urlKey: String(row.url_key), site: String(row.site), title: String(row.title), titleSource: row.title_source as TitleSource,
  note: row.note === null ? null : String(row.note), tags: JSON.parse(String(row.tags)), savedAt: String(row.saved_at), via: row.via as Via,
  excerpt: row.excerpt === null ? null : String(row.excerpt), pageState: row.page_state as PageState, pageSource: row.page_source as BookmarkRow["pageSource"],
  pageChars: Number(row.page_chars), pageAt: row.page_at === null ? null : String(row.page_at), pageAttempts: Number(row.page_attempts),
  pageNextAt: row.page_next_at === null ? null : String(row.page_next_at), fictional: Number(row.fictional) === 1,
});
/** List rows never carry the page text. */
const COLUMNS = "b.seq, b.id, b.created_at, b.updated_at, b.revision, b.url, b.url_key, b.site, b.title, b.title_source, b.note, b.tags, b.saved_at, b.via, b.excerpt, b.page_state, b.page_source, b.page_chars, b.page_at, b.page_attempts, b.page_next_at, b.fictional";

const PAGES_PER_SITE = 3;

/** A title the person chose outranks one a save supplied, which outranks the page's, which outranks the link. The first given title stays. */
const TITLE_RANK: Record<TitleSource, number> = { link: 0, page: 1, given: 2, edited: 3 };

export interface SaveLink {
  url: string;
  title?: string | null;
  note?: string | null;
  tags?: readonly string[];
  savedAt?: string | number | null;
  excerpt?: string | null;
  /** The page's text, read by the browser that showed it. */
  pageText?: string | null;
}
export type SaveOutcome = { status: "created" | "updated" | "unchanged"; id: string } | { status: "invalid" };

export interface OpenOptions { now?: () => Date }
export async function openBookmarks(dataDir: string, instanceId: string, options: OpenOptions = {}) {
  const store = await openAppDatabase(path.join(dataDir, "records.db"));
  const db = store.db as unknown as SqlDatabase;
  migrate(db, MIGRATIONS);
  return createBookmarks(store, db, instanceId, options);
}

/** A safe FTS5 query from typed text: each word a quoted prefix term, all required. Input is never interpreted. */
export function ftsQuery(text: string | null | undefined): string | null {
  const words = (text ?? "").normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 12);
  return words.length ? words.map((word) => `"${word}"*`).join(" ") : null;
}

export function createBookmarks(store: Awaited<ReturnType<typeof openAppDatabase>>, db: SqlDatabase, instanceId: string, options: OpenOptions = {}) {
  const now = options.now ?? (() => new Date());
  const stamp = () => now().toISOString();
  const settings = createSettings(db);
  const scopes = createScopeStore(db, () => instanceId);
  // A retried write returns its first result only while the caller keeps the access it had.
  store.useAuthority((invocation) => {
    const scope = scopes.resolve(invocation, "write");
    return scope.kind === "owner" ? "owner" : `${scopeFingerprint(scope)}:${[...scope.operations].sort().join(",")}`;
  });

  const run = (sql: string, ...params: SqlValue[]) => db.prepare(sql).run(...params);
  const one = (sql: string, ...params: SqlValue[]) => db.prepare(sql).get(...params);
  const all = (sql: string, ...params: SqlValue[]) => db.prepare(sql).all(...params);

  function bookmark(id: string): BookmarkRow | null {
    const row = one(`SELECT ${COLUMNS} FROM bookmarks b WHERE b.id = ?`, id);
    return row ? rowOf(row) : null;
  }
  function byKey(key: string): BookmarkRow | null {
    const row = one(`SELECT ${COLUMNS} FROM bookmarks b WHERE b.url_key = ?`, key);
    return row ? rowOf(row) : null;
  }
  function pageText(seq: number): string | null {
    const row = one("SELECT body FROM bookmarks_fts WHERE rowid = ?", seq);
    return row && row.body ? String(row.body) : null;
  }
  function setTags(id: string, tags: readonly string[]) {
    const time = stamp();
    run("DELETE FROM bookmark_tags WHERE bookmark_id = ?", id);
    for (const tag of tags) run("INSERT INTO bookmark_tags (bookmark_id, tag, created_at, updated_at) VALUES (?, ?, ?, ?)", id, tag, time, time);
  }
  /** Rewrite a record's search row. Pass the body only when it changes. */
  function index(row: Pick<BookmarkRow, "seq" | "title" | "url" | "note" | "tags">, body?: string) {
    const text = body ?? pageText(row.seq) ?? "";
    run("DELETE FROM bookmarks_fts WHERE rowid = ?", row.seq);
    run("INSERT INTO bookmarks_fts (rowid, title, link, note, tags, body) VALUES (?, ?, ?, ?, ?, ?)", row.seq, row.title, row.url, row.note ?? "", row.tags.join(" "), text);
  }

  /** One link into the records. Repeats merge and never make a second record. Call inside a transaction. */
  function saveOne(input: SaveLink, via: Via, options: { fictional?: boolean } = {}): SaveOutcome {
    const link = parseLink(input.url);
    if (!link) return { status: "invalid" };
    const time = stamp();
    const given = input.title?.replace(/\s+/g, " ").trim().slice(0, 500) || null;
    const note = input.note?.trim().slice(0, 4000) || null;
    const tags = cleanTags(input.tags ?? []);
    const savedAt = parseSavedAt(input.savedAt);
    const text = input.pageText ? clipText(input.pageText.replace(/\u0000/g, "").trim()) : null;
    const excerpt = input.excerpt?.replace(/\s+/g, " ").trim().slice(0, MAX_EXCERPT) || (text ? excerptOf(text) : null);
    const existing = byKey(link.key);
    if (!existing) {
      const id = newId();
      const result = run(
        `INSERT INTO bookmarks (id, created_at, updated_at, revision, url, url_key, site, title, title_source, note, tags, saved_at, via, excerpt, page_state, page_source, page_chars, page_at, page_attempts, page_next_at, fictional)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        id, time, time, link.url, link.key, link.site, given ?? link.site, given ? "given" : "link", note, JSON.stringify(tags), savedAt ?? time, via, excerpt,
        text ? "read" : "waiting", text ? "browser" : null, text?.length ?? 0, text ? time : null, text ? null : time, options.fictional ? 1 : 0,
      );
      setTags(id, tags);
      index({ seq: Number(result.lastInsertRowid), title: given ?? link.site, url: link.url, note, tags }, text ?? "");
      return { status: "created", id };
    }
    const nextTags = cleanTags([...existing.tags, ...tags]);
    const useTitle = given && TITLE_RANK.given > TITLE_RANK[existing.titleSource];
    const nextTitle = useTitle ? given : existing.title;
    const nextNote = existing.note ?? note;
    const nextSavedAt = savedAt && savedAt < existing.savedAt ? savedAt : existing.savedAt;
    // Saving again is a reason to try a page that could not be read before.
    const retry = !text && ["gone", "failed", "needs_browser"].includes(existing.pageState);
    const changed = useTitle || nextNote !== existing.note || nextTags.length !== existing.tags.length || nextSavedAt !== existing.savedAt || !!text || retry || (!existing.excerpt && !!excerpt);
    if (!changed) return { status: "unchanged", id: existing.id };
    run(
      `UPDATE bookmarks SET updated_at = ?, revision = revision + 1, title = ?, title_source = ?, note = ?, tags = ?, saved_at = ?, excerpt = ?,
         page_state = ?, page_source = ?, page_chars = ?, page_at = ?, page_attempts = ?, page_next_at = ? WHERE id = ?`,
      time, nextTitle, useTitle ? "given" : existing.titleSource, nextNote, JSON.stringify(nextTags), nextSavedAt, (text ? excerpt : existing.excerpt ?? excerpt),
      text ? "read" : retry ? "waiting" : existing.pageState, text ? "browser" : existing.pageSource, text ? text.length : existing.pageChars, text ? time : existing.pageAt,
      text || retry ? 0 : existing.pageAttempts, text ? null : retry ? time : existing.pageNextAt, existing.id,
    );
    setTags(existing.id, nextTags);
    index({ seq: existing.seq, title: nextTitle, url: existing.url, note: nextNote, tags: nextTags }, text ?? undefined);
    return { status: "updated", id: existing.id };
  }

  /** Change what a person edits. Merges nothing: the values given are the values kept. */
  function edit(row: BookmarkRow, patch: { title?: string; note?: string | null; tags?: readonly string[] }): BookmarkRow {
    const title = patch.title !== undefined ? patch.title.replace(/\s+/g, " ").trim().slice(0, 500) || row.site : row.title;
    const note = patch.note !== undefined ? patch.note?.trim().slice(0, 4000) || null : row.note;
    const tags = patch.tags !== undefined ? cleanTags(patch.tags) : row.tags;
    run("UPDATE bookmarks SET updated_at = ?, revision = revision + 1, title = ?, title_source = ?, note = ?, tags = ? WHERE id = ?",
      stamp(), title, title !== row.title ? "edited" : row.titleSource, note, JSON.stringify(tags), row.id);
    if (patch.tags !== undefined) setTags(row.id, tags);
    index({ seq: row.seq, title, url: row.url, note, tags });
    return bookmark(row.id)!;
  }

  function remove(row: BookmarkRow) {
    run("DELETE FROM bookmarks_fts WHERE rowid = ?", row.seq);
    run("DELETE FROM bookmarks WHERE id = ?", row.id);
  }

  /** Newest first, by the date each was saved. */
  function newest(input: { tag?: string | null; after?: { savedAt: string; id: string } | null; limit: number }): BookmarkRow[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (input.tag) { where.push("EXISTS (SELECT 1 FROM bookmark_tags t WHERE t.bookmark_id = b.id AND t.tag = ?)"); params.push(input.tag); }
    if (input.after) { where.push("(b.saved_at < ? OR (b.saved_at = ? AND b.id < ?))"); params.push(input.after.savedAt, input.after.savedAt, input.after.id); }
    return all(`SELECT ${COLUMNS} FROM bookmarks b ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY b.saved_at DESC, b.id DESC LIMIT ?`, ...params, input.limit).map(rowOf);
  }

  /** Best match first. A title or tag counts for more than a word deep in the page. */
  function search(input: { query: string; tag?: string | null; offset: number; limit: number }): { row: BookmarkRow; snippet: string | null }[] {
    const match = ftsQuery(input.query);
    if (!match) return [];
    const tag = input.tag ? "AND EXISTS (SELECT 1 FROM bookmark_tags t WHERE t.bookmark_id = b.id AND t.tag = ?)" : "";
    const params: SqlValue[] = [match, ...(input.tag ? [input.tag] : []), input.limit, input.offset];
    return all(
      `SELECT ${COLUMNS}, snippet(bookmarks_fts, 4, '', '', '…', 28) AS snippet
       FROM bookmarks_fts JOIN bookmarks b ON b.seq = bookmarks_fts.rowid
       WHERE bookmarks_fts MATCH ? ${tag}
       ORDER BY bm25(bookmarks_fts, 10.0, 3.0, 6.0, 8.0, 1.0), b.saved_at DESC LIMIT ? OFFSET ?`,
      ...params,
    ).map((row) => ({ row: rowOf(row), snippet: row.snippet ? String(row.snippet).replace(/\s+/g, " ").trim() || null : null }));
  }

  function tagCounts(limit: number): { tag: string; count: number }[] {
    return all("SELECT tag, COUNT(*) AS count FROM bookmark_tags GROUP BY tag ORDER BY count DESC, tag ASC LIMIT ?", limit).map((row) => ({ tag: String(row.tag), count: Number(row.count) }));
  }
  function counts() {
    const row = one("SELECT COUNT(*) AS total, COALESCE(SUM(page_state = 'waiting'), 0) AS waiting, COALESCE(SUM(page_state = 'read'), 0) AS read FROM bookmarks")!;
    return { total: Number(row.total), waiting: Number(row.waiting), read: Number(row.read) };
  }
  /**
   * Links due to be read, oldest wait first: each site's first before any site's
   * second, and never more than a few from one site in a step. So a library that
   * is mostly one site still moves, and can't crowd out the rest.
   */
  function dueForReading(limit: number): BookmarkRow[] {
    return all(
      `SELECT ${COLUMNS} FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY site ORDER BY page_next_at, seq) AS site_turn FROM bookmarks WHERE page_state = 'waiting' AND page_next_at <= ?) b
       WHERE b.site_turn <= ? ORDER BY b.site_turn, b.page_next_at, b.seq LIMIT ?`,
      stamp(), PAGES_PER_SITE, limit,
    ).map(rowOf);
  }
  /** Record what reading a page found. The title moves only if nothing better named it. */
  function recordPage(id: string, result: { state: Exclude<PageState, "waiting"> | "waiting"; title?: string | null; excerpt?: string | null; text?: string | null; attempts?: number; nextAt?: string | null }) {
    transaction(db, () => {
      const row = bookmark(id);
      if (!row) return;
      // A person's browser may have supplied the text while this read was in flight. Keep theirs.
      if (row.pageState !== "waiting") return;
      const time = stamp();
      const title = result.title && TITLE_RANK.page >= TITLE_RANK[row.titleSource] ? result.title : row.title;
      // The revision guards what a person edits. Reading the page only conflicts with them if it changes the title.
      run(
        `UPDATE bookmarks SET updated_at = ?, revision = revision + ?, title = ?, title_source = ?, excerpt = ?, page_state = ?, page_source = ?, page_chars = ?, page_at = ?, page_attempts = ?, page_next_at = ? WHERE id = ?`,
        time, title !== row.title ? 1 : 0, title, title !== row.title ? "page" : row.titleSource, result.excerpt ?? row.excerpt, result.state, result.text ? "home" : row.pageSource,
        result.text?.length ?? row.pageChars, time, result.attempts ?? row.pageAttempts, result.nextAt ?? null, id,
      );
      if (result.text || title !== row.title) index({ seq: row.seq, title, url: row.url, note: row.note, tags: row.tags }, result.text ?? undefined);
    });
  }
  /** Note an attempt before it starts, so a read that takes the whole step down isn't due again straight away. */
  function setAttempt(id: string, attempts: number, nextAt: string | null) {
    run("UPDATE bookmarks SET page_attempts = ?, page_next_at = ? WHERE id = ? AND page_state = 'waiting'", attempts, nextAt, id);
  }
  /** Give up on a page whose attempts all ended without an answer. */
  function failExhausted(maxAttempts: number) {
    run("UPDATE bookmarks SET page_state = 'failed', page_next_at = NULL, page_at = ?, updated_at = ? WHERE page_state = 'waiting' AND page_attempts >= ? AND page_next_at <= ?", stamp(), stamp(), maxAttempts, stamp());
  }
  function dataRevision(): number {
    return Number(one("SELECT value FROM bookmarks_meta WHERE id = 'data_revision'")?.value ?? 0);
  }

  const bookmarks = {
    instanceId, store, db, settings, scopes, now, stamp, run, one, all,
    bookmark, byKey, pageText, saveOne, edit, remove, newest, search, tagCounts, counts, dueForReading, recordPage, setAttempt, failExhausted, dataRevision,
    lastStepAt: () => settings.get("reading.lastStepAt", z.string().nullable(), null),
    markStep: () => settings.set("reading.lastStepAt", stamp()),
    fixtureSeeded: () => settings.get("fixture.seeded", z.boolean(), false),
    markFixtureSeeded: () => settings.set("fixture.seeded", true),
    /** The data this caller may use. Everything saved is one source, shared or not. */
    resolve(invocation: Pick<AppInvocation, "principal" | "access">, operation: Operation): AccessScope {
      const scope = scopes.resolve(invocation, operation);
      if (!allows(scope, SAVED_SOURCE)) throw new AppError("forbidden", "The owner has not shared Bookmarks with this caller");
      return scope;
    },
    actor: (invocation: Pick<AppInvocation, "principal">) => actorOf(invocation),
    close: () => store.close(),
  };
  return bookmarks;
}
export type Bookmarks = ReturnType<typeof createBookmarks>;
