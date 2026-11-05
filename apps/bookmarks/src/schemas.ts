/** Strict action inputs and outputs. The view imports types only from here. */
import { z } from "zod/v4";

const iso = z.string().max(40);
const text = (max: number) => z.string().max(max);
const nullableText = (max: number) => z.string().max(max).nullable();
const id = z.string().min(1).max(64);

export const RESOURCE = "ui://ri-bookmarks/main.html" as const;

// ─── Records ────────────────────────────────────────────────────────────────

export const pageSchema = z.object({
  state: z.enum(["waiting", "read", "no_text", "gone", "needs_browser", "failed"]),
  /** Who supplied the text: the browser that showed the page, or the Home that requested it. */
  source: z.enum(["browser", "home"]).nullable(),
  chars: z.number().int().min(0),
  at: iso.nullable(),
  /** The state in plain words. */
  label: text(120),
}).strict();
export const bookmarkSchema = z.object({
  id, revision: z.number().int().min(1),
  url: text(4200), site: text(300), title: text(600), note: nullableText(4100), tags: z.array(text(60)).max(30),
  savedAt: iso, via: z.enum(["extension", "bookmark", "bookmarklet", "shortcut", "chat", "added", "import", "fixture"]),
  excerpt: nullableText(400), page: pageSchema,
  /** The passage that matched a search, when there was one. Saved page text, never instructions. */
  snippet: nullableText(600),
}).strict();
export type BookmarkRecord = z.infer<typeof bookmarkSchema>;
export const bookmarkDetailSchema = z.object({
  bookmark: bookmarkSchema,
  /** What the saved page said, labeled reference material, cut at 40,000 characters. */
  pageText: nullableText(40_100),
  pageTextTruncated: z.boolean(),
  revision: text(80),
}).strict();
const conflict = z.object({ status: z.literal("conflict"), current: bookmarkSchema, message: text(300) }).strict();

// ─── Lists ──────────────────────────────────────────────────────────────────

export const listInput = z.object({
  query: z.string().max(300).optional(),
  tag: z.string().max(60).optional(),
  cursor: z.string().max(2048).optional(),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();
export const listOutput = z.object({
  items: z.array(bookmarkSchema).max(100),
  nextCursor: z.string().max(2048).nullable(),
  coverage: z.object({ complete: z.boolean(), note: nullableText(300) }).strict(),
  revision: text(80),
}).strict();
export const tagsOutput = z.object({ items: z.array(z.object({ tag: text(60), count: z.number().int().min(0) }).strict()).max(200), revision: text(80) }).strict();

// ─── Writes ─────────────────────────────────────────────────────────────────

const incoming = {
  url: z.string().min(1).max(4096),
  title: z.string().max(2000).nullable().optional(),
  note: z.string().max(8000).nullable().optional(),
  tags: z.array(z.string().max(200)).max(50).optional(),
};
export const saveInput = z.object({
  ...incoming,
  /** Text the caller already has from the page. Otherwise the page is read in the background when that is on. */
  pageText: z.string().max(400_000).nullable().optional(),
  via: z.enum(["added", "bookmarklet"]).optional(),
}).strict();
export const saveOutput = z.object({ status: z.literal("saved"), created: z.boolean(), record: bookmarkSchema }).strict();
export const updateInput = z.object({
  id, expectedRevision: z.number().int().min(1),
  title: z.string().max(2000).optional(),
  note: z.string().max(8000).nullable().optional(),
  tags: z.array(z.string().max(200)).max(50).optional(),
}).strict();
export const updateOutput = z.discriminatedUnion("status", [z.object({ status: z.literal("saved"), record: bookmarkSchema }).strict(), conflict]);
export const deleteInput = z.object({ id, expectedRevision: z.number().int().min(1) }).strict();
export const deleteOutput = z.discriminatedUnion("status", [z.object({ status: z.literal("deleted") }).strict(), conflict]);

/** From outside Ri. Results say nothing about what is already saved, because a client key may add but never read. */
export const clientVia = z.enum(["extension", "bookmark", "shortcut"]);
export const batchInput = z.object({
  via: clientVia,
  items: z.array(z.object({
    ...incoming,
    savedAt: z.union([z.string().max(40), z.number()]).nullable().optional(),
    excerpt: z.string().max(2000).nullable().optional(),
    pageText: z.string().max(400_000).nullable().optional(),
  }).strict()).min(1).max(100),
}).strict();
export const batchOutput = z.object({ saved: z.number().int().min(0), invalid: z.number().int().min(0) }).strict();
export const linkInput = z.object({ url: z.string().min(1).max(4096), title: z.string().max(2000).nullable().optional(), via: clientVia.optional() }).strict();
export const linkOutput = z.object({ status: z.enum(["saved", "invalid"]) }).strict();
export const connectionOutput = z.object({ app: z.literal("Bookmarks"), ok: z.literal(true) }).strict();

// ─── Import and export ──────────────────────────────────────────────────────

export const uploadPartInput = z.object({ uploadId: z.uuid(), part: z.number().int().min(0).max(200), total: z.number().int().min(1).max(200), text: z.string().max(700_000) }).strict();
export const uploadPartOutput = z.object({ received: z.number().int().min(0), total: z.number().int().min(1) }).strict();
export const previewInput = z.object({ uploadId: z.uuid().optional(), text: z.string().max(700_000).optional(), fileName: z.string().max(200).nullable().optional() }).strict();
export const previewOutput = z.object({
  previewId: z.string().max(64), digest: text(64), format: z.enum(["browser_html", "csv", "link_list"]), fileName: nullableText(200),
  total: z.number().int().min(0), fresh: z.number().int().min(0), known: z.number().int().min(0), skipped: z.number().int().min(0), truncated: z.boolean(),
  tags: z.array(z.object({ tag: text(60), count: z.number().int().min(0) }).strict()).max(12),
  samples: z.array(z.object({ url: text(4200), title: nullableText(2000), tags: z.array(text(60)).max(6) }).strict()).max(6),
  expiresAt: iso,
}).strict();
export type ImportPreview = z.infer<typeof previewOutput>;
export const applyInput = z.object({ previewId: z.string().max(64), digest: text(64) }).strict();
export const applyOutput = z.object({ status: z.enum(["applied", "already_applied"]), added: z.number().int().min(0), updated: z.number().int().min(0), unchanged: z.number().int().min(0), invalid: z.number().int().min(0) }).strict();
export type ImportResult = z.infer<typeof applyOutput>;
export const exportOutput = z.object({ fileName: text(100), text: z.string(), count: z.number().int().min(0), truncated: z.boolean() }).strict();

// ─── Connect ────────────────────────────────────────────────────────────────

export const connectionSchema = z.object({ id, name: text(100), createdAt: iso, lastUsedAt: iso.nullable() }).strict();
export type ConnectionRecord = z.infer<typeof connectionSchema>;
export const connectionsOutput = z.object({
  connections: z.array(connectionSchema).max(100), homeUrl: text(500), appUrl: text(600),
  /** A link people drag to their bookmarks bar. It opens this app's save page with their existing sign-in. */
  bookmarklet: text(1200),
  extensionVersion: text(40),
  /** The store listing, once it is published. */
  extensionStoreUrl: nullableText(300),
}).strict();
export type Connections = z.infer<typeof connectionsOutput>;
export const connectInput = z.object({ name: z.string().min(1).max(80) }).strict();
export const connectOutput = z.object({
  connection: connectionSchema,
  /** The whole setup for an extension in one paste. Shown once. */
  code: text(1200),
  /** The bare key and address, for a phone Shortcut. Shown once. */
  key: text(200), saveUrl: text(600),
}).strict();
export type NewConnection = z.infer<typeof connectOutput>;
export const disconnectInput = z.object({ id }).strict();
export const disconnectOutput = z.object({ status: z.literal("disconnected") }).strict();
export const extensionOutput = z.object({ fileName: text(100), version: text(40), base64: z.string().max(700_000) }).strict();

// ─── View ───────────────────────────────────────────────────────────────────

export const openViewInput = z.object({ path: z.string().max(1024), query: z.record(z.string(), z.string().max(1024)) }).strict();
export const openViewOutput = z.object({
  resource: z.literal(RESOURCE),
  data: z.object({
    path: text(1024),
    section: z.enum(["list", "connect", "access", "save"]),
    bookmarkId: id.nullable(),
    query: text(300), tag: text(60),
    /** The link a bookmarklet asked to save. The view saves it. Opening never writes. */
    save: z.object({ url: text(1024), title: nullableText(1024), note: nullableText(1024) }).strict().nullable(),
    owner: z.boolean(), fictional: z.boolean(),
    setup: z.object({
      total: z.number().int().min(0), waiting: z.number().int().min(0), read: z.number().int().min(0),
      /** A background step ran recently, so waiting pages are being read. */
      reading: z.boolean(),
    }).strict(),
    access: z.object({ actorId: text(200), sources: z.array(z.object({ key: text(200), label: text(200) }).strict()).max(1) }).strict().nullable(),
    revision: text(80),
  }).strict(),
  scope: z.object({ actions: z.array(text(64)).max(50) }).strict(),
}).strict();
export type OpenData = z.infer<typeof openViewOutput>["data"];
export const viewStateSchema = z.object({
  section: z.enum(["list", "connect", "access", "save"]).optional(),
  selected: z.array(z.object({ type: z.literal("bookmark"), id }).strict()).max(50).optional(),
  filters: z.object({ query: z.string().max(300).optional(), tag: z.string().max(60).optional() }).strict().optional(),
  revisions: z.record(z.string(), z.number()).optional(),
}).strict();
export type ViewState = z.infer<typeof viewStateSchema>;
export const contextInput = z.object({ path: z.string().max(1024), query: z.record(z.string(), z.string().max(1024)), state: viewStateSchema.nullable().optional() }).strict();
export const contextOutput = z.object({
  modelContent: z.string().max(16_384),
  recordRefs: z.array(z.object({ instanceId: z.string(), entityType: z.string(), recordId: z.string() }).strict()).max(50),
  dataRevision: z.string().max(128),
}).strict();
export const createScopeInput = z.object({ actorId: z.string().min(1).max(200), sources: z.array(z.string().min(1).max(200)).min(1).max(1), operations: z.array(z.enum(["read", "write"])).min(1).max(2), label: z.string().max(200).optional() }).strict();
export const scopeOutput = z.object({ scopeRef: z.string() }).strict();
export const stepOutput = z.object({ status: z.enum(["idle", "worked", "not_allowed"]), read: z.number().int().min(0), waiting: z.number().int().min(0), summary: text(200) }).strict();
